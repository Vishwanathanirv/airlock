import type { ReactNode } from "react";
import { SEVERITY_RANK, type Action, type Category, type Finding } from "@airlock/core";

/** Baggage-scanner false colour, by what was found. */
export const TINT: Record<Category, "x-attack" | "x-data" | "x-hidden" | "x-out"> = {
  injection: "x-attack",
  jailbreak: "x-attack",
  "prompt-leak": "x-attack",
  encoded: "x-attack",
  "hidden-text": "x-hidden",
  secret: "x-data",
  pii: "x-data",
  exfiltration: "x-out",
};

export const CATEGORY_NAME: Record<Category, string> = {
  injection: "Prompt injection",
  jailbreak: "Jailbreak",
  "prompt-leak": "System prompt extraction",
  encoded: "Encoded instructions",
  "hidden-text": "Hidden text",
  exfiltration: "Data exfiltration",
  secret: "Secret",
  pii: "Personal data",
};

const INVISIBLE = /[​-‍⁠⁡-⁤﻿­᠎‪-‮⁦-⁩]/;
const isTag = (cp: number) => cp >= 0xe0000 && cp <= 0xe007f;

/**
 * Shows text the way the scanner sees it: findings tinted by kind, invisible characters made
 * visible, and text smuggled in Unicode tag characters spelled out.
 */
export function Xray({ text, findings, className = "" }: { text: string; findings: Finding[]; className?: string }) {
  // Strongest finding per character position.
  const cls: (string | undefined)[] = [];
  const titles: (string | undefined)[] = [];
  for (const f of [...findings].sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity])) {
    if (!f.span) continue;
    for (let i = f.span.start; i < Math.min(text.length, f.span.end); i++) {
      cls[i] = TINT[f.category];
      titles[i] = `${CATEGORY_NAME[f.category]}: ${f.why}`;
    }
  }
  const out: ReactNode[] = [];
  let i = 0;
  let key = 0;
  while (i < text.length) {
    const cp = text.codePointAt(i)!;
    if (isTag(cp)) {
      let decoded = "";
      while (i < text.length && isTag(text.codePointAt(i)!)) {
        decoded += String.fromCharCode(text.codePointAt(i)! - 0xe0000);
        i += 2;
      }
      out.push(
        <span key={key++} className="x-hidden px-0.5 italic" title="Invisible tag characters, decoded">
          ⟨invisible: {decoded}⟩
        </span>,
      );
      continue;
    }
    const ch = String.fromCodePoint(cp);
    if (INVISIBLE.test(ch)) {
      out.push(
        <span key={key++} className="x-hidden mx-px inline-block w-[0.6ch] text-center text-[10px]" title={`Invisible character U+${cp.toString(16).toUpperCase().padStart(4, "0")}`}>
          ◦
        </span>,
      );
      i += ch.length;
      continue;
    }
    // Group a run of characters with the same tint.
    let j = i;
    let run = "";
    while (j < text.length && cls[j] === cls[i]) {
      const c = text.codePointAt(j)!;
      const s = String.fromCodePoint(c);
      if (isTag(c) || INVISIBLE.test(s)) break;
      run += s;
      j += s.length;
    }
    out.push(
      <span key={key++} className={cls[i]} title={titles[i]}>
        {run}
      </span>,
    );
    i = j;
  }
  return <div className={`xray px-4 py-3 ${className}`}>{out.length ? out : <span className="opacity-50">Nothing on the belt.</span>}</div>;
}

const GATE: Record<Action, { label: string; tone: string; note: string }> = {
  allow: { label: "Clear", tone: "var(--go)", note: "Nothing suspicious." },
  flag: { label: "Flagged", tone: "var(--hold)", note: "Let through, marked for review." },
  redact: { label: "Redacted", tone: "var(--x-data)", note: "Sensitive data swapped for placeholders." },
  block: { label: "Stopped", tone: "var(--stop)", note: "Not let through." },
};

/** The verdict as a lit gate sign. */
export function Gate({ action, size = "md", hypothetical = false }: { action: Action; size?: "sm" | "md"; /** Airlock is off: say what it would have done. */ hypothetical?: boolean }) {
  const g = GATE[action];
  const label = hypothetical ? { allow: "Would pass", flag: "Would flag", redact: "Would redact", block: "Would stop" }[action] : g.label;
  return (
    <span className={`inline-flex items-center gap-2 rounded-[5px] bg-sign font-bold text-white ${size === "sm" ? "px-2 py-0.5 text-[13px]" : "px-3 py-1.5 text-[15px]"}`} title={g.note}>
      <span className="h-2.5 w-2.5 rounded-full" style={{ background: g.tone, boxShadow: `0 0 8px ${g.tone}` }} aria-hidden />
      {label}
    </span>
  );
}

export function Legend() {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1.5 text-[13px] text-muted">
      {(
        [
          ["x-attack", "Attack"],
          ["x-data", "Secret or personal data"],
          ["x-hidden", "Hidden or disguised"],
          ["x-out", "Data leaving"],
        ] as const
      ).map(([c, t]) => (
        <span key={c} className="inline-flex items-center gap-1.5">
          <span className={`${c} inline-block h-3 w-5`} aria-hidden />
          {t}
        </span>
      ))}
    </div>
  );
}

export function Findings({ findings, empty = "Nothing found." }: { findings: Finding[]; empty?: string }) {
  if (!findings.length) return <p className="text-sm text-muted">{empty}</p>;
  return (
    <ul className="space-y-2.5">
      {findings.map((f, i) => (
        <li key={i} className="grid grid-cols-[auto_1fr] gap-x-3">
          <span className={`${TINT[f.category]} mt-1.5 inline-block h-3 w-3`} aria-hidden />
          <div>
            <div className="text-[15px] font-semibold">
              {CATEGORY_NAME[f.category]}
              <span className="ml-2 text-[13px] font-normal text-faint">
                {f.severity}, {f.detector}
              </span>
            </div>
            <p className="mt-0.5 text-[14px] leading-snug text-muted">{f.why}</p>
            {f.evidence && f.category !== "hidden-text" && <p className="mt-1 font-mono text-[12.5px] text-faint">“{f.evidence.length > 110 ? `${f.evidence.slice(0, 107)}…` : f.evidence}”</p>}
          </div>
        </li>
      ))}
    </ul>
  );
}
