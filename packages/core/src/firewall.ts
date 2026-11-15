/**
 * The firewall itself. Requests are inspected before they reach the model (user messages,
 * retrieved documents, tool results) and responses before they reach the user (system-prompt
 * leaks, data-carrying links, secrets). Each finding maps to an action through the policy, and
 * the strongest action wins: block > redact > flag > allow.
 */

import { explain, featurize, predict, type Model } from "./classifier";
import { findSensitive, Vault } from "./dlp";
import { decodeLayers, unmask, type Trick } from "./normalize";
import { RULES } from "./rules";
import { SEVERITY_RANK, type Action, type Category, type Finding, type Severity, type Source, type Verdict } from "./types";

export type Policy = {
  /** What to do with findings of each kind (high and critical severity; lower ones are flagged). */
  actions: Record<Category, Action>;
  /** Classifier scores at or above this block; above `flagAt` they are flagged. */
  blockAt: number;
  flagAt: number;
  /** Domains the app's answers may link to or load images from. */
  allowedDomains: string[];
};

export const DEFAULT_POLICY: Policy = {
  actions: { injection: "block", jailbreak: "block", "prompt-leak": "block", "hidden-text": "flag", encoded: "block", exfiltration: "block", secret: "redact", pii: "redact" },
  blockAt: 0.85,
  flagAt: 0.6,
  allowedDomains: [],
};

const RANK: Record<Action, number> = { allow: 0, flag: 1, redact: 2, block: 3 };
const stronger = (a: Action, b: Action) => (RANK[b] > RANK[a] ? b : a);

/** Locates a phrase found in the unmasked text back in the original, for highlighting. */
function locate(original: string, phrase: string) {
  const i = original.toLowerCase().indexOf(phrase.slice(0, 40));
  return i >= 0 ? { start: i, end: Math.min(original.length, i + phrase.length) } : undefined;
}

const TRICK_INFO: Record<Trick["kind"], { severity: Severity; why: (t: Trick) => string }> = {
  tags: { severity: "critical", why: (t) => `Invisible "tag" characters spell out text people can't see but the model can read: "${t.decoded?.slice(0, 120)}".` },
  invisible: { severity: "medium", why: (t) => `${t.count} zero-width character${t.count === 1 ? "" : "s"} hidden in the text, a common way to slip words past filters.` },
  bidi: { severity: "medium", why: () => "Right-to-left override characters: the text displays in a different order than the model reads it." },
  homoglyph: { severity: "medium", why: (t) => `${t.count} look-alike letter${t.count === 1 ? "" : "s"} from another alphabet mixed into English words (e.g. Cyrillic "о" for "o").` },
  spaced: { severity: "low", why: () => "Words spelled out with spaces or dots between the letters." },
  leet: { severity: "low", why: () => "Words spelled with numbers for letters (l33t)." },
};

export function inspect(text: string, source: Source, policy: Policy = DEFAULT_POLICY, model?: Model): Verdict & { matches: ReturnType<typeof findSensitive> } {
  const t0 = performance.now();
  const findings: Finding[] = [];
  const u = unmask(text);

  for (const t of u.tricks) {
    // Spacing and l33t are only worth mentioning when they hide something; see below.
    if (t.kind === "spaced" || t.kind === "leet") continue;
    findings.push({ detector: `hidden.${t.kind}`, category: "hidden-text", severity: TRICK_INFO[t.kind].severity, span: t.span, evidence: t.decoded ?? `${t.count} character${t.count === 1 ? "" : "s"}`, why: TRICK_INFO[t.kind].why(t), confidence: 0.95 });
  }

  const runRules = (haystack: string, viaEncoding?: string) => {
    for (const r of RULES) {
      if (r.contextOnly && source === "user") continue;
      const m = haystack.match(r.pattern);
      if (!m) continue;
      findings.push({
        detector: viaEncoding ? `${r.id}+${viaEncoding}` : r.id,
        category: viaEncoding ? "encoded" : r.category,
        severity: viaEncoding ? "critical" : r.severity,
        span: viaEncoding ? undefined : locate(text, m[0]),
        evidence: m[0],
        why: viaEncoding ? `Hidden in ${viaEncoding}: ${r.why[0].toLowerCase()}${r.why.slice(1)}` : r.why,
        confidence: 0.9,
      });
    }
  };
  runRules(u.text);
  const layers = decodeLayers(text);
  for (const d of layers) {
    const before = findings.length;
    runRules(unmask(d.text).text, d.encoding);
    for (const f of findings.slice(before)) f.span = d.span;
  }

  // Obfuscation plus an attack is worse than either: someone went out of their way to hide it.
  const attack = findings.some((f) => f.category === "injection" || f.category === "jailbreak" || f.category === "prompt-leak" || f.category === "encoded");
  if (attack && u.tricks.length) {
    for (const f of findings) if (f.category === "injection" || f.category === "jailbreak" || f.category === "prompt-leak") f.severity = "critical";
    const kinds = u.tricks.map((t) => t.kind);
    if (kinds.includes("spaced") || kinds.includes("leet"))
      findings.push({ detector: `hidden.${kinds.includes("spaced") ? "spaced" : "leet"}`, category: "hidden-text", severity: "medium", evidence: "letter tricks", why: `${TRICK_INFO[kinds.includes("spaced") ? "spaced" : "leet"].why({ kind: "spaced", count: 0 })} Used here to sneak an attack past keyword filters.`, confidence: 0.85 });
  }

  let injectionScore = 0;
  if (model && source !== "output") {
    // Hidden layers are scored too: an instruction in base64 is still an instruction.
    injectionScore = Math.max(predict(model, featurize(u.text)), ...layers.map((d) => predict(model, featurize(unmask(d.text).text))));
    if (injectionScore >= policy.flagAt && !findings.some((f) => f.category === "injection" || f.category === "jailbreak" || f.category === "prompt-leak")) {
      const grams = explain(model, u.text, 4).map((g) => `"${g.gram}"`);
      findings.push({
        detector: "classifier",
        category: "injection",
        severity: injectionScore >= policy.blockAt ? "high" : "medium",
        evidence: grams.join(", "),
        why: `Reads like an instruction aimed at the model rather than a normal ${source === "user" ? "question" : "document"} (score ${injectionScore.toFixed(2)}). Strongest signals: ${grams.join(", ")}.`,
        confidence: injectionScore,
      });
    }
  }

  const matches = findSensitive(text);
  findings.push(...matches.map(({ label: _l, value: _v, ...f }) => f));

  let action: Action = "allow";
  for (const f of findings) {
    const wanted = policy.actions[f.category];
    // Low and medium severity findings are flagged for review rather than blocking, except
    // for data that should never pass through unredacted.
    const a = SEVERITY_RANK[f.severity] >= SEVERITY_RANK.high || f.category === "secret" || f.category === "pii" ? wanted : wanted === "allow" ? "allow" : "flag";
    action = stronger(action, a);
  }
  findings.sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity]);
  return { action, findings, text, injectionScore, ms: performance.now() - t0, matches };
}

// ---------------------------------------------------------------------------------------------
// Output checks

const shingles = (s: string, n: number) => {
  const w = s.toLowerCase().match(/[a-z0-9']+/g) ?? [];
  const out = new Set<string>();
  for (let i = 0; i + n <= w.length; i++) out.add(w.slice(i, i + n).join(" "));
  return out;
};

/** Share of the system prompt's 6-word phrases that appear in the answer. */
export function promptOverlap(system: string, answer: string): number {
  const a = shingles(system, 6);
  if (!a.size) return 0;
  const b = shingles(answer, 6);
  let hit = 0;
  for (const s of a) if (b.has(s)) hit++;
  return hit / a.size;
}

const hostOf = (url: string) => {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
};
const allowed = (host: string, list: string[]) => list.some((d) => host === d || host.endsWith(`.${d}`));

export function inspectOutput(answer: string, ctx: { system?: string; canary?: string; policy?: Policy; vault?: Vault }): Verdict {
  const t0 = performance.now();
  const policy = ctx.policy ?? DEFAULT_POLICY;
  const findings: Finding[] = [];

  if (ctx.canary && answer.includes(ctx.canary)) {
    const i = answer.indexOf(ctx.canary);
    findings.push({ detector: "leak.canary", category: "prompt-leak", severity: "critical", span: { start: i, end: i + ctx.canary.length }, evidence: ctx.canary, why: "The answer contains the secret marker planted in the system prompt, so the model is repeating its hidden instructions.", confidence: 1 });
  }
  if (ctx.system) {
    const overlap = promptOverlap(ctx.system, answer);
    if (overlap >= 0.2) findings.push({ detector: "leak.overlap", category: "prompt-leak", severity: overlap >= 0.4 ? "critical" : "high", evidence: `${Math.round(overlap * 100)}% of the system prompt`, why: `The answer repeats ${Math.round(overlap * 100)}% of the system prompt's phrasing.`, confidence: Math.min(1, overlap * 2) });
  }

  for (const m of answer.matchAll(/(!?)\[([^\]]*)\]\((https?:\/\/[^)\s]+)\)|<img[^>]+src=["'](https?:\/\/[^"']+)["']/gi)) {
    const image = m[1] === "!" || Boolean(m[4]);
    const url = m[3] ?? m[4];
    const host = hostOf(url);
    if (!host || allowed(host, policy.allowedDomains)) continue;
    const query = url.split("?")[1] ?? "";
    const carriesData = query.length > 20 || /[A-Za-z0-9+/=_-]{24,}/.test(query);
    if (!image && !carriesData) continue;
    findings.push({
      detector: image ? "exfil.image" : "exfil.link",
      category: "exfiltration",
      severity: image ? "critical" : "high",
      span: { start: m.index!, end: m.index! + m[0].length },
      evidence: url.length > 90 ? `${url.slice(0, 87)}…` : url,
      why: image
        ? `An image from ${host}, which isn't an approved domain. Showing the answer would make the user's browser contact that server${carriesData ? " and hand over the data in the address" : ""}.`
        : `A link to ${host} with data packed into the address. Clicking it would send that data out.`,
      confidence: 0.95,
    });
  }

  const matches = findSensitive(answer, new Set(["secret"]));
  findings.push(...matches.map(({ label: _l, value: _v, ...f }) => f));

  let action: Action = "allow";
  for (const f of findings) action = stronger(action, policy.actions[f.category]);
  let text = answer;
  if (matches.length && action === "redact") text = new Vault().redact(answer, matches);
  if (action !== "block" && ctx.vault) text = ctx.vault.restore(text);
  return { action, findings, text, injectionScore: 0, ms: performance.now() - t0 };
}
