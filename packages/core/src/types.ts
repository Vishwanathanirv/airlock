/** Where a piece of text came from. Retrieved documents and tool output are data, not instructions. */
export type Source = "user" | "context" | "tool" | "output";

export type Category =
  | "injection" // instructions trying to override the app's own
  | "jailbreak" // trying to switch off safety rules or adopt a persona
  | "prompt-leak" // trying to get the system prompt out, or the model leaking it
  | "hidden-text" // invisible or disguised characters
  | "encoded" // instructions hidden in base64, hex, rot13 or URL encoding
  | "exfiltration" // links or images that would send data to an outside server
  | "secret" // API keys, tokens, private keys
  | "pii"; // personal data: cards, Aadhaar, PAN, emails, phone numbers

export type Severity = "low" | "medium" | "high" | "critical";

export type Span = { start: number; end: number };

export type Finding = {
  detector: string;
  category: Category;
  severity: Severity;
  /** Where in the original text, when it can be pinned down. */
  span?: Span;
  /** The matched text (secrets are masked). */
  evidence: string;
  /** Plain-English explanation for a person reviewing it. */
  why: string;
  /** 0..1, how sure the detector is. */
  confidence: number;
};

export type Action = "allow" | "flag" | "redact" | "block";

export type Verdict = {
  action: Action;
  findings: Finding[];
  /** The text to forward when it was redacted (or the original). */
  text: string;
  /** Classifier probability that the text is an injection attempt. */
  injectionScore: number;
  ms: number;
};

export const SEVERITY_RANK: Record<Severity, number> = { low: 0, medium: 1, high: 2, critical: 3 };
