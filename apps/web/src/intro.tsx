import { useEffect, useMemo, useRef, useState } from "react";
import { checkRequest, checkResponse, decodeLayers, explain, findSensitive, gullibleReply, inspect, NORTHWIND_SYSTEM, unmask, Vault, type Action, type ChatMessage, type Finding } from "@airlock/core";
import { useModel, usePolicy } from "./lib";
import { PRESETS, ROAMING_ARTICLE, preset } from "./presets";
import { CATEGORY_NAME, Findings, Gate, Xray } from "./xray";

const SEEN_KEY = "airlock-briefed";

/** Whether to open on the briefing: the first visit only, remembered in this browser. */
export function useBriefing(): [boolean, (show: boolean) => void] {
  const [show, setShow] = useState(() => {
    try {
      return localStorage.getItem(SEEN_KEY) !== "1";
    } catch {
      return true;
    }
  });
  const set = (v: boolean) => {
    setShow(v);
    if (!v)
      try {
        localStorage.setItem(SEEN_KEY, "1");
      } catch {
        /* private window: show it again next time */
      }
  };
  return [show, set];
}

/** Closes on Escape and keeps keyboard focus inside while open. */
function useDialog(onClose: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLElement>("[data-autofocus]")?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
      if (e.key !== "Tab" || !ref.current) return;
      const f = [...ref.current.querySelectorAll<HTMLElement>("button:not(:disabled), a[href], input, textarea, [tabindex='0']")];
      if (!f.length) return;
      const wrapTo = e.shiftKey ? (document.activeElement === f[0] ? f.at(-1) : null) : document.activeElement === f.at(-1) ? f[0] : null;
      if (wrapTo) {
        e.preventDefault();
        wrapTo.focus();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      before?.focus?.({ preventScroll: true });
    };
  }, [onClose]);
  return ref;
}

/** The two doors of the airlock, with a message cycling through them: the logo of the idea. */
function Doors() {
  return (
    <svg viewBox="0 0 320 70" className="h-auto w-full max-w-md" aria-hidden>
      <rect x="1" y="6" width="318" height="32" rx="16" fill="var(--panel-2)" stroke="var(--line)" strokeWidth="1.5" />
      <rect className="door door-in" x="104" y="1" width="6" height="42" rx="3" fill="var(--go)" />
      <rect className="door door-out" x="210" y="1" width="6" height="42" rx="3" fill="var(--go)" />
      <circle className="packet" cx="20" cy="22" r="6" />
      {(
        [
          [54, "the world"],
          [160, "the scanner"],
          [266, "the model"],
        ] as const
      ).map(([x, t]) => (
        <text key={t} x={x} y="62" textAnchor="middle" fontSize="11" fill="var(--faint)" fontFamily="var(--font-mono)">
          {t}
        </text>
      ))}
    </svg>
  );
}

/**
 * The idea, on the first screen: the problem, the one idea and why it's different, over the live
 * split screen, with the demo one click away.
 */
export function Briefing({ onTry, onHow, onClose }: { onTry: () => void; onHow: () => void; onClose: () => void }) {
  const ref = useDialog(onClose);
  return (
    <div className="briefing fixed inset-0 z-40 grid place-items-center overflow-y-auto bg-[color-mix(in_oklab,var(--bg)_82%,transparent)] p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="briefing-title">
      <div ref={ref} className="panel briefing-card w-full max-w-2xl p-6 shadow-[var(--shadow)] sm:p-8">
        <p className="font-mono text-[11.5px] uppercase tracking-[0.18em] text-faint">Airlock · a firewall for LLM apps</p>
        <h1 id="briefing-title" className="mt-2 text-[clamp(1.7rem,4.6vw,2.5rem)] font-extrabold leading-[1.08] tracking-tight">
          Nothing reaches the model without passing <span className="text-go">the airlock.</span>
        </h1>
        <div className="mt-4">
          <Doors />
        </div>
        <dl className="mt-4 grid gap-4 text-[14.5px] leading-relaxed sm:grid-cols-3">
          <div>
            <dt className="font-bold">The problem</dt>
            <dd className="mt-1 text-muted">Chatbots obey whatever they read: your message, a help article, a web page. One hidden line can make them leak their instructions or a customer's card number.</dd>
          </div>
          <div>
            <dt className="font-bold">The idea</dt>
            <dd className="mt-1 text-muted">Put two doors in front of the model. Every message is scanned on the way in, every answer on the way out, and anything dangerous is stopped, redacted or flagged.</dd>
          </div>
          <div>
            <dt className="font-bold">Why it's different</dt>
            <dd className="mt-1 text-muted">It sees through the tricks keyword filters miss: base64, invisible Unicode text, look-alike letters, orders planted in documents and images that carry data away.</dd>
          </div>
        </dl>
        <p className="mt-4 text-[13.5px] text-muted">Behind this card the same chat runs twice: once straight to the model, once through Airlock. Watch an attack work on one side and fail on the other.</p>
        <div className="mt-5 flex flex-wrap gap-2">
          <button data-autofocus className="btn btn-sign h-11 px-5 text-[15px]" onClick={onTry}>
            Watch an attack get stopped →
          </button>
          <button className="btn h-11 px-4 text-[15px]" onClick={onHow}>
            How it works
          </button>
        </div>
        <button className="mt-4 text-[13px] text-faint underline-offset-4 hover:text-ink hover:underline" onClick={onClose}>
          Skip to the split screen <kbd className="ml-1 rounded border border-line px-1 font-mono text-[11px]">Esc</kbd>
        </button>
      </div>
    </div>
  );
}

const STAGES = [
  { t: "Unmask", q: "What does the model really see?" },
  { t: "Decode", q: "Is anything hidden in an encoding?" },
  { t: "Detect", q: "Does it read like an attack?" },
  { t: "Redact", q: "Is there data the model shouldn't get?" },
  { t: "Decide", q: "What does the policy say?" },
  { t: "Answer", q: "Is the reply safe to show?" },
] as const;

const RANK: Record<Action, number> = { allow: 0, flag: 1, redact: 2, block: 3 };

/**
 * How it works, as a walk through the real pipeline: every stage below is the shipping engine
 * running on the text you choose, not a recording.
 */
export function HowItWorks({ onClose, onSend }: { onClose: () => void; onSend: (m: { user: string; article?: string }) => void }) {
  const ref = useDialog(onClose);
  const { model } = useModel();
  const policy = usePolicy();
  const [pick, setPick] = useState("Hidden in base64");
  const [own, setOwn] = useState("");
  const [lookAt, setLookAt] = useState<"message" | "article" | null>(null);
  const [step, setStep] = useState(0);
  const p = preset(pick);
  const user = pick === "own" ? own : p.user;
  const article = pick === "own" ? ROAMING_ARTICLE : (p.article ?? ROAMING_ARTICLE);

  const run = useMemo(() => {
    const m = model ?? undefined;
    const inUser = inspect(user, "user", policy, m);
    const inArticle = inspect(article, "context", policy, m);
    // Look where the trouble is, unless the visitor chose.
    const side = lookAt ?? (inArticle.findings.length > inUser.findings.length ? "article" : "message");
    const text = side === "article" ? article : user;
    const verdict = side === "article" ? inArticle : inUser;
    const u = unmask(text);
    const layers = decodeLayers(text);
    const grams = m && u.text ? explain(m, u.text, 5) : [];
    const sensitive = findSensitive(text).filter((x) => policy.actions[x.category] === "redact");
    const redacted = sensitive.length ? new Vault().redact(text, sensitive) : text;
    const messages: ChatMessage[] = [
      { role: "system", content: NORTHWIND_SYSTEM },
      { role: "user", content: article, source: "context" },
      { role: "user", content: user },
    ];
    const req = checkRequest(messages, { policy, model: m });
    const raw = req.action === "block" ? null : gullibleReply(req.forward);
    const out = raw === null ? null : checkResponse(raw, req, policy);
    return { side, text, verdict, u, layers, grams, sensitive, redacted, req, raw, out };
  }, [user, article, policy, model, lookAt]);

  const is = (f: Finding, ...c: Finding["category"][]) => c.includes(f.category);
  const hidden = run.verdict.findings.filter((f) => is(f, "hidden-text"));
  const attacks = run.verdict.findings.filter((f) => is(f, "injection", "jailbreak", "prompt-leak", "encoded") && f.detector !== "classifier");
  const lit = [hidden.length > 0, run.layers.length > 0, attacks.length > 0 || run.verdict.injectionScore >= policy.flagAt, run.sensitive.length > 0, run.req.action !== "allow", (run.out?.action ?? "allow") !== "allow"];
  const final = run.req.action === "block" ? "block" : run.out && RANK[run.out.action] > RANK[run.req.action] ? run.out.action : run.req.action;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).tagName === "INPUT" || (e.target as HTMLElement).tagName === "TEXTAREA") return;
      if (e.key === "ArrowRight") setStep((s) => Math.min(STAGES.length - 1, s + 1));
      if (e.key === "ArrowLeft") setStep((s) => Math.max(0, s - 1));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const score = run.verdict.injectionScore;
  return (
    <div className="fixed inset-0 z-40 grid place-items-center overflow-y-auto bg-[color-mix(in_oklab,var(--bg)_86%,transparent)] p-2 backdrop-blur-sm sm:p-4" role="dialog" aria-modal="true" aria-labelledby="how-title">
      <div ref={ref} className="panel w-full max-w-4xl p-4 shadow-[var(--shadow)] sm:p-6">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="font-mono text-[11.5px] uppercase tracking-[0.18em] text-faint">How it works · the real engine, live</p>
            <h2 id="how-title" className="mt-1 text-[1.5rem] font-extrabold tracking-tight">
              Follow one message through the airlock
            </h2>
          </div>
          <button className="btn h-8 px-3 text-[13px]" onClick={onClose} aria-label="Close how it works">
            Close
          </button>
        </div>

        {/* What to send through */}
        <div className="mt-4 flex gap-1.5 overflow-x-auto pb-1 [scrollbar-width:thin]" role="radiogroup" aria-label="Message to follow">
          {[...PRESETS.map((x) => x.name), "own"].map((n) => (
            <button
              key={n}
              role="radio"
              aria-checked={pick === n}
              onClick={() => {
                setPick(n);
                setLookAt(null);
              }}
              className={`h-8 shrink-0 rounded-full border px-3 text-[13px] font-semibold ${pick === n ? "border-ink bg-sign text-sign-ink" : "border-line text-muted hover:text-ink"}`}
            >
              {n === "own" ? "Write your own" : n}
            </button>
          ))}
        </div>
        {pick === "own" && <input data-autofocus className="field mt-2" placeholder="Type anything, or an attack of your own" value={own} onChange={(e) => setOwn(e.target.value)} aria-label="Your message" />}
        <div className="mt-2 flex flex-wrap items-center gap-2 text-[13px] text-muted">
          Looking at
          {(["message", "article"] as const).map((k) => (
            <button key={k} onClick={() => setLookAt(k)} aria-pressed={run.side === k} className={`rounded-md px-2 py-0.5 font-semibold ${run.side === k ? "bg-panel-2 text-ink" : "hover:text-ink"}`}>
              {k === "message" ? "what the user typed" : "the help article Nova reads"}
            </button>
          ))}
        </div>

        {/* The pipeline: six chambers, lit where something was found */}
        <ol className="mt-4 grid grid-cols-3 gap-1.5 sm:grid-cols-6" aria-label="Stages">
          {STAGES.map((s, i) => (
            <li key={s.t}>
              <button
                onClick={() => setStep(i)}
                aria-current={step === i ? "step" : undefined}
                className={`w-full rounded-[10px] border px-2 py-2 text-left transition-colors ${step === i ? "border-ink bg-panel-2" : "border-line hover:border-faint"}`}
              >
                <span className="flex items-center gap-1.5 text-[12px] font-mono text-faint">
                  <span className="h-2 w-2 rounded-full" style={{ background: lit[i] ? (i >= 4 ? "var(--hold)" : "var(--x-attack)") : "var(--go)" }} aria-hidden />
                  {i + 1}
                </span>
                <span className="block text-[14px] font-bold">{s.t}</span>
                <span className="sr-only">{lit[i] ? ", found something" : ", clear"}</span>
              </button>
            </li>
          ))}
        </ol>

        <section className="mt-4 min-h-[16rem]" aria-live="polite">
          <h3 className="text-[1.05rem] font-bold">
            {step + 1}. {STAGES[step].q}
          </h3>

          {step === 0 && (
            <div className="mt-2 space-y-3">
              <p className="text-[14px] text-muted">People and models read text differently. Airlock first makes invisible characters visible, spells out text hidden in Unicode tags and folds look-alike letters back to plain English, so nothing is judged on how it looks.</p>
              <Xray text={run.text || " "} findings={hidden} className="max-h-48 overflow-y-auto px-4 py-3" />
              {hidden.length ? <Findings findings={hidden} /> : <p className="text-sm text-go">No disguises: what you see is what the model reads.</p>}
              {run.u.smuggled && (
                <p className="text-[13.5px] text-muted">
                  Hidden text recovered: <span className="font-mono text-ink">“{run.u.smuggled}”</span>
                </p>
              )}
            </div>
          )}

          {step === 1 && (
            <div className="mt-2 space-y-3">
              <p className="text-[14px] text-muted">Attackers encode orders so keyword filters see gibberish. Airlock tries base64, hex, rot13 and URL encoding, and keeps a decoding only when the result is readable text, so ids and hashes aren't mistaken for messages.</p>
              {run.layers.length ? (
                <ul className="space-y-2">
                  {run.layers.map((d, i) => (
                    <li key={i} className="xray px-4 py-3">
                      <span className="text-faint">{d.encoding} →</span> <span className="x-attack">{d.text}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-go">No hidden encodings.</p>
              )}
            </div>
          )}

          {step === 2 && (
            <div className="mt-2 space-y-3">
              <p className="text-[14px] text-muted">Two independent checks. Hand-written rules catch known attack phrasing. A classifier, trained on generated attacks plus real jailbreak prompts from JailbreakHub, scores how much the text reads like an order aimed at the model{model ? "" : " (it is still loading)"}.</p>
              <div>
                <div className="flex items-baseline justify-between text-[13px]">
                  <span className="font-semibold">Classifier score</span>
                  <span className="font-mono">{score.toFixed(2)}</span>
                </div>
                <div className="relative mt-1 h-3 rounded-full bg-panel-2">
                  <div className="h-3 rounded-full transition-[width] duration-300" style={{ width: `${Math.max(2, score * 100)}%`, background: score >= policy.blockAt ? "var(--stop)" : score >= policy.flagAt ? "var(--hold)" : "var(--go)" }} />
                  {[policy.flagAt, policy.blockAt].map((v, i) => (
                    <span key={i} className="absolute -top-1 h-5 w-px bg-ink" style={{ left: `${v * 100}%` }} title={i ? `Stop at ${v}` : `Flag at ${v}`} />
                  ))}
                </div>
                <p className="mt-1 text-[12.5px] text-faint">
                  Flags at {policy.flagAt}, stops at {policy.blockAt}.
                  {run.grams.length > 0 && <> Strongest signals: {run.grams.filter((g) => g.weight > 0).slice(0, 4).map((g) => `“${g.gram}”`).join(", ") || "none"}.</>}
                </p>
              </div>
              <Findings findings={attacks} empty="No rule matched." />
            </div>
          )}

          {step === 3 && (
            <div className="mt-2 space-y-3">
              <p className="text-[14px] text-muted">Card numbers (checked with the Luhn digit), Aadhaar (Verhoeff), PAN, IBAN, emails, phone numbers and API keys are swapped for placeholders before the model sees them. The real values go back into the answer for the user, never into a link.</p>
              {run.sensitive.length ? (
                <>
                  <Xray text={run.redacted} findings={[]} className="max-h-40 overflow-y-auto px-4 py-3" />
                  <ul className="flex flex-wrap gap-1.5 text-[12.5px]">
                    {run.sensitive.map((s, i) => (
                      <li key={i} className="x-data rounded px-2 py-0.5 font-mono">
                        {s.label}: {s.evidence}
                      </li>
                    ))}
                  </ul>
                </>
              ) : (
                <p className="text-sm text-go">No personal data or secrets to lock away.</p>
              )}
            </div>
          )}

          {step === 4 && (
            <div className="mt-2 space-y-3">
              <p className="text-[14px] text-muted">Each finding maps to an action through the policy (you can change it under Policy and setup), and the strongest one wins: stop beats redact beats flag beats pass. Low-severity findings are only flagged for a person to review.</p>
              <div className="flex items-center gap-2">
                <Gate action={run.req.action} />
                <span className="text-sm text-muted">for the whole request: message and article together</span>
              </div>
              {run.verdict.findings.length > 0 && (
                <ul className="text-[13.5px] text-muted">
                  {[...new Set(run.verdict.findings.map((f) => f.category))].map((c) => (
                    <li key={c}>
                      {CATEGORY_NAME[c]} → policy says <b className="text-ink">{policy.actions[c]}</b>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {step === 5 && (
            <div className="mt-2 space-y-3">
              <p className="text-[14px] text-muted">The second door. A secret marker is planted in the system prompt; if it, or most of the prompt's wording, shows up in the answer, the prompt is leaking. Images and links to unapproved sites are stopped, because showing them would send data away.</p>
              {run.raw === null ? (
                <p className="text-sm">Stopped at the first door: the model never saw this message, so there is no answer to check.</p>
              ) : (
                <>
                  <p className="text-[13px] font-semibold">Nova's raw answer, before the user sees it</p>
                  <Xray text={run.raw} findings={run.out?.findings ?? []} className="max-h-40 overflow-y-auto px-4 py-3" />
                  <div className="flex items-center gap-2">
                    <Gate action={run.out?.action ?? "allow"} />
                  </div>
                  <Findings findings={run.out?.findings ?? []} empty="Nothing leaking in the answer." />
                </>
              )}
            </div>
          )}
        </section>

        <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-line pt-4">
          <button className="btn" onClick={() => setStep((s) => Math.max(0, s - 1))} disabled={step === 0}>
            ← Back
          </button>
          {step < STAGES.length - 1 ? (
            <button className="btn btn-sign" onClick={() => setStep((s) => s + 1)}>
              Next: {STAGES[step + 1].t} →
            </button>
          ) : (
            <span className="flex items-center gap-2 text-sm text-muted">
              Verdict <Gate action={final} />
            </span>
          )}
          <span className="flex-1" />
          <button className="btn btn-sign" disabled={!user.trim()} onClick={() => onSend({ user, article })}>
            Send it to both phones →
          </button>
        </div>
      </div>
    </div>
  );
}
