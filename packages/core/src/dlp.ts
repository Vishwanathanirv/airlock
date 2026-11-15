/**
 * Secrets and personal data. Each pattern is backed by a validator where one exists (Luhn for
 * cards, Verhoeff for Aadhaar, the PAN structure, mod-97 for IBAN), so a random 16-digit order
 * number isn't mistaken for a card. Matches can be swapped for placeholders before the text
 * reaches the model, and swapped back in the reply.
 */

import type { Category, Finding, Severity } from "./types";

export function luhn(digits: string): boolean {
  let sum = 0;
  let alt = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48;
    if (alt) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    alt = !alt;
  }
  return sum % 10 === 0;
}

// Verhoeff checksum (used by Aadhaar).
const VD = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], [1, 2, 3, 4, 0, 6, 7, 8, 9, 5], [2, 3, 4, 0, 1, 7, 8, 9, 5, 6], [3, 4, 0, 1, 2, 8, 9, 5, 6, 7], [4, 0, 1, 2, 3, 9, 5, 6, 7, 8],
  [5, 9, 8, 7, 6, 0, 4, 3, 2, 1], [6, 5, 9, 8, 7, 1, 0, 4, 3, 2], [7, 6, 5, 9, 8, 2, 1, 0, 4, 3], [8, 7, 6, 5, 9, 3, 2, 1, 0, 4], [9, 8, 7, 6, 5, 4, 3, 2, 1, 0],
];
const VP = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], [1, 5, 7, 6, 2, 8, 3, 0, 9, 4], [5, 8, 0, 3, 7, 9, 6, 1, 4, 2], [8, 9, 1, 6, 0, 4, 3, 5, 2, 7],
  [9, 4, 5, 3, 1, 2, 6, 8, 7, 0], [4, 2, 8, 6, 5, 7, 3, 9, 0, 1], [2, 7, 9, 3, 8, 0, 6, 4, 1, 5], [7, 0, 4, 6, 9, 1, 3, 2, 5, 8],
];
export function verhoeff(digits: string): boolean {
  let c = 0;
  [...digits].reverse().forEach((ch, i) => (c = VD[c][VP[i % 8][ch.charCodeAt(0) - 48]]));
  return c === 0;
}

export function ibanValid(iban: string): boolean {
  const s = iban.replace(/\s/g, "").toUpperCase();
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(s)) return false;
  const moved = (s.slice(4) + s.slice(0, 4)).replace(/[A-Z]/g, (c) => String(c.charCodeAt(0) - 55));
  let r = 0;
  for (const ch of moved) r = (r * 10 + (ch.charCodeAt(0) - 48)) % 97;
  return r === 1;
}

/** Shannon entropy in bits per character: random keys score high, words score low. */
export function entropy(s: string): number {
  const f = new Map<string, number>();
  for (const c of s) f.set(c, (f.get(c) ?? 0) + 1);
  let h = 0;
  for (const n of f.values()) h -= (n / s.length) * Math.log2(n / s.length);
  return h;
}

type Pattern = { id: string; label: string; category: Category; severity: Severity; re: RegExp; valid?: (m: string) => boolean; why: string };

const digitsOf = (s: string) => s.replace(/\D/g, "");

export const PATTERNS: Pattern[] = [
  { id: "secret.private-key", label: "PRIVATE_KEY", category: "secret", severity: "critical", re: /-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY(?: BLOCK)?-----[\s\S]*?-----END (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY(?: BLOCK)?-----/g, why: "A private key. Anyone holding it can impersonate its owner." },
  { id: "secret.aws-access-key", label: "AWS_KEY", category: "secret", severity: "critical", re: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g, why: "An AWS access key id." },
  { id: "secret.github-token", label: "GITHUB_TOKEN", category: "secret", severity: "critical", re: /\b(?:gh[pousr]_[A-Za-z0-9]{36,255}|github_pat_[A-Za-z0-9_]{60,})\b/g, why: "A GitHub access token." },
  { id: "secret.openai-key", label: "API_KEY", category: "secret", severity: "critical", re: /\bsk-(?:proj-|ant-api\d\d-)?[A-Za-z0-9_-]{32,}\b/g, why: "An OpenAI or Anthropic API key." },
  { id: "secret.google-key", label: "API_KEY", category: "secret", severity: "critical", re: /\bAIza[0-9A-Za-z_-]{35}\b/g, why: "A Google API key." },
  { id: "secret.slack-token", label: "SLACK_TOKEN", category: "secret", severity: "critical", re: /\bxox[abpors]-[A-Za-z0-9-]{10,}\b/g, why: "A Slack token." },
  { id: "secret.stripe-key", label: "API_KEY", category: "secret", severity: "critical", re: /\b(?:sk|rk)_live_[A-Za-z0-9]{20,}\b/g, why: "A live Stripe secret key." },
  { id: "secret.jwt", label: "JWT", category: "secret", severity: "high", re: /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, why: "A signed session token (JWT). Whoever has it is logged in as that user." },
  {
    id: "secret.password-assignment",
    label: "PASSWORD",
    category: "secret",
    severity: "high",
    re: /\b(?:password|passwd|pwd|secret|api[_-]?key|token)\s*[:=]\s*["']?([^\s"']{8,})["']?/gi,
    valid: (m) => entropy(m.split(/[:=]/).slice(1).join("=").trim().replace(/^["']|["']$/g, "")) >= 3,
    why: "A password or key written out in the text.",
  },
  { id: "pii.card", label: "CARD", category: "pii", severity: "high", re: /\b(?:\d[ -]?){12,18}\d\b/g, valid: (m) => { const d = digitsOf(m); return d.length >= 13 && d.length <= 19 && /^[2-6]/.test(d) && luhn(d); }, why: "A payment card number (passes the Luhn check)." },
  { id: "pii.aadhaar", label: "AADHAAR", category: "pii", severity: "high", re: /\b[2-9]\d{3}[ -]?\d{4}[ -]?\d{4}\b/g, valid: (m) => verhoeff(digitsOf(m)), why: "An Aadhaar number (passes the Verhoeff check)." },
  { id: "pii.pan", label: "PAN", category: "pii", severity: "high", re: /\b[A-Z]{3}[PCHFATBLJG][A-Z]\d{4}[A-Z]\b/g, why: "An Indian PAN (tax id)." },
  { id: "pii.iban", label: "IBAN", category: "pii", severity: "high", re: /\b[A-Z]{2}\d{2}(?: ?[A-Z0-9]{4}){2,7}(?: ?[A-Z0-9]{1,4})?\b/g, valid: ibanValid, why: "A bank account number (IBAN, passes mod-97)." },
  { id: "pii.email", label: "EMAIL", category: "pii", severity: "medium", re: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, why: "An email address." },
  { id: "pii.phone-in", label: "PHONE", category: "pii", severity: "medium", re: /(?:\+91[ -]?|\b0)?\b[6-9]\d{4}[ -]?\d{5}\b/g, why: "An Indian mobile number." },
  { id: "pii.phone-intl", label: "PHONE", category: "pii", severity: "medium", re: /\+(?:[1-9]\d{0,2})[ -.]?\(?\d{2,4}\)?[ -.]?\d{3,4}[ -.]?\d{3,4}\b/g, why: "A phone number." },
];

export type Match = Finding & { label: string; value: string };

const mask = (v: string) => (v.length <= 8 ? "•".repeat(v.length) : `${v.slice(0, 4)}${"•".repeat(Math.min(12, v.length - 6))}${v.slice(-2)}`);

/** Every secret and piece of personal data in the text, longest first when they overlap. */
export function findSensitive(text: string, only?: Set<Category>): Match[] {
  const found: Match[] = [];
  for (const p of PATTERNS) {
    if (only && !only.has(p.category)) continue;
    for (const m of text.matchAll(p.re)) {
      const value = m[0];
      if (p.valid && !p.valid(value)) continue;
      found.push({ detector: p.id, category: p.category, severity: p.severity, span: { start: m.index!, end: m.index! + value.length }, evidence: mask(value), why: p.why, confidence: p.valid ? 0.97 : 0.9, label: p.label, value });
    }
  }
  // Drop matches inside a longer one (a phone number inside a card number, say).
  found.sort((a, b) => a.span!.start - b.span!.start || b.span!.end - a.span!.end);
  const kept: Match[] = [];
  for (const f of found) if (!kept.some((k) => f.span!.start < k.span!.end && f.span!.end > k.span!.start)) kept.push(f);
  return kept;
}

/**
 * Swaps sensitive values for numbered placeholders ([EMAIL_1]) and remembers them, so the
 * model never sees the real values but the user still gets them back in the reply.
 */
export class Vault {
  private byValue = new Map<string, string>();
  private byToken = new Map<string, string>();
  private counts = new Map<string, number>();

  redact(text: string, matches: Match[]): string {
    let out = "";
    let at = 0;
    for (const m of [...matches].sort((a, b) => a.span!.start - b.span!.start)) {
      out += text.slice(at, m.span!.start) + this.token(m.label, m.value);
      at = m.span!.end;
    }
    return out + text.slice(at);
  }

  private token(label: string, value: string) {
    const existing = this.byValue.get(value);
    if (existing) return existing;
    const n = (this.counts.get(label) ?? 0) + 1;
    this.counts.set(label, n);
    const t = `[${label}_${n}]`;
    this.byValue.set(value, t);
    this.byToken.set(t, value);
    return t;
  }

  /** Puts the real values back. Secrets are never restored: those stay redacted. */
  restore(text: string, keepRedacted: (label: string) => boolean = (l) => ["PRIVATE_KEY", "AWS_KEY", "GITHUB_TOKEN", "API_KEY", "SLACK_TOKEN", "JWT", "PASSWORD"].includes(l)): string {
    return text.replace(/\[([A-Z_]+)_(\d+)\]/g, (t, label: string) => (keepRedacted(label) ? t : (this.byToken.get(t) ?? t)));
  }

  get size() {
    return this.byToken.size;
  }
}
