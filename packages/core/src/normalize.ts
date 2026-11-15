/**
 * Unmasking. Attackers hide instructions from filters with invisible characters, look-alike
 * letters from other alphabets, s p a c e d   o u t words, l33t spelling and encodings. Every
 * detector runs on the unmasked text, and each trick found is itself evidence.
 */

import type { Span } from "./types";

/** Zero-width and other invisible formatting characters. */
const INVISIBLE = /[​-‍⁠⁡-⁤﻿­᠎]/g;
/** Bidirectional overrides: can make text display in a different order than it is read. */
const BIDI = /[‪-‮⁦-⁩]/g;
/** Unicode "tag" characters: an invisible copy of ASCII, used for "ASCII smuggling". */
const TAGS = /[\u{E0000}-\u{E007F}]/gu;

/** Cyrillic and Greek letters that look like Latin ones. */
const CONFUSABLE: Record<string, string> = {
  а: "a", в: "b", е: "e", к: "k", м: "m", н: "h", о: "o", р: "p", с: "c", т: "t", у: "y", х: "x", і: "i", ј: "j", ѕ: "s", ԁ: "d", ԛ: "q", ԝ: "w", ү: "y", һ: "h",
  А: "A", В: "B", Е: "E", К: "K", М: "M", Н: "H", О: "O", Р: "P", С: "C", Т: "T", Х: "X", І: "I", Ј: "J", Ѕ: "S",
  α: "a", ε: "e", ι: "i", ο: "o", ρ: "p", τ: "t", υ: "u", ν: "v", κ: "k", χ: "x",
  Α: "A", Β: "B", Ε: "E", Ζ: "Z", Η: "H", Ι: "I", Κ: "K", Μ: "M", Ν: "N", Ο: "O", Ρ: "P", Τ: "T", Υ: "Y", Χ: "X",
};
const LEET: Record<string, string> = { "0": "o", "1": "i", "3": "e", "4": "a", "5": "s", "7": "t", "@": "a", $: "s" };

export type Trick = { kind: "invisible" | "bidi" | "tags" | "homoglyph" | "spaced" | "leet"; count: number; span?: Span; decoded?: string };

export type Unmasked = {
  /** Lower-case, de-obfuscated text that detectors match against. */
  text: string;
  tricks: Trick[];
  /** Text recovered from Unicode tag characters (invisible to people, readable to models). */
  smuggled: string;
};

export function unmask(input: string): Unmasked {
  const tricks: Trick[] = [];
  let s = input;

  // ASCII smuggling: tag characters map one-to-one onto ASCII.
  let smuggled = "";
  const tags = [...s.matchAll(TAGS)];
  if (tags.length) {
    smuggled = tags.map((m) => String.fromCharCode(m[0].codePointAt(0)! - 0xe0000)).join("").replace(/[^\x20-\x7e]/g, "");
    tricks.push({ kind: "tags", count: tags.length, span: { start: tags[0].index!, end: tags.at(-1)!.index! + 2 }, decoded: smuggled });
    s = s.replace(TAGS, "");
  }
  const invisible = s.match(INVISIBLE)?.length ?? 0;
  if (invisible) {
    const first = input.search(INVISIBLE);
    tricks.push({ kind: "invisible", count: invisible, span: first >= 0 ? { start: first, end: first + 1 } : undefined });
    s = s.replace(INVISIBLE, "");
  }
  const bidi = s.match(BIDI)?.length ?? 0;
  if (bidi) {
    tricks.push({ kind: "bidi", count: bidi });
    s = s.replace(BIDI, "");
  }

  s = s.normalize("NFKC");
  // Look-alike letters only count as a trick inside words that also contain Latin letters:
  // a whole sentence in Russian or Greek is just a sentence.
  let homoglyphs = 0;
  s = s.replace(/[\p{L}\p{M}]+/gu, (word) => {
    if (!/[a-z]/i.test(word)) return word;
    let swapped = 0;
    const out = [...word].map((ch) => (CONFUSABLE[ch] ? (swapped++, CONFUSABLE[ch]) : ch)).join("");
    homoglyphs += swapped;
    return out;
  });
  if (homoglyphs) tricks.push({ kind: "homoglyph", count: homoglyphs });

  s = s.toLowerCase();

  // "i g n o r e  a l l" → "ignore all": three or more single letters with one separator
  // between them form a word; a wider gap between runs is the space between words.
  let spaced = 0;
  s = s.replace(/(?<![a-z])(?:[a-z][ ._*-]){2,}[a-z](?![a-z])/g, (run) => {
    spaced++;
    return run.replace(/[ ._*-]/g, "");
  });
  if (spaced) tricks.push({ kind: "spaced", count: spaced });

  // l33t inside words that are mostly letters ("1gn0re", "pr0mpt"), never in plain numbers.
  let leet = 0;
  s = s.replace(/[a-z0-9@$]{3,}/g, (w) => {
    const digits = (w.match(/[0-9@$]/g) ?? []).length;
    const letters = w.length - digits;
    // Leave numbers with units alone ("5g", "4k", "2fa", "10am", "3rd").
    if (!digits || letters < 2 || w.length > 15 || /^\d+(k|g|gb|mb|kb|tb|fa|th|st|nd|rd|am|pm|px|ms|kg|km|cm|mm|hz|mp|x|s)$/.test(w)) return w;
    leet += digits;
    return [...w].map((c) => LEET[c] ?? c).join("");
  });
  if (leet >= 2) tricks.push({ kind: "leet", count: leet });

  s = s.replace(/\s+/g, " ").trim();
  return { text: smuggled ? `${s} ${smuggled.toLowerCase()}` : s, tricks, smuggled };
}

export type Decoded = { encoding: "base64" | "hex" | "rot13" | "url"; span: Span; text: string };

const COMMON = /\b(the|and|you|your|to|of|is|ignore|instructions|system|prompt|all|previous|reveal|please|now|this|that|with|for)\b/g;
const englishness = (t: string) => (t.toLowerCase().match(COMMON)?.length ?? 0) / Math.max(1, t.split(/\s+/).length);
const printable = (t: string) => t.length > 0 && (t.match(/[\x20-\x7e\n\r\t]/g)?.length ?? 0) / t.length > 0.95;

function b64decode(s: string): string | null {
  try {
    const bin = typeof atob === "function" ? atob(s) : Buffer.from(s, "base64").toString("binary");
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

const rot13 = (s: string) => s.replace(/[a-z]/gi, (c) => String.fromCharCode(((c.toLowerCase().charCodeAt(0) - 97 + 13) % 26) + (c <= "Z" ? 65 : 97)));

/**
 * Finds text hidden in an encoding and decodes it, so the decoded words are scanned like any
 * others. Only keeps a decoding when the result is readable text, which keeps hashes, ids and
 * images from being mistaken for hidden messages.
 */
export function decodeLayers(input: string): Decoded[] {
  const out: Decoded[] = [];
  for (const m of input.matchAll(/[A-Za-z0-9+/]{16,}={0,2}/g)) {
    if (!/[a-z]/.test(m[0]) || !/[A-Z]/.test(m[0])) continue;
    const t = b64decode(m[0]);
    if (t && printable(t) && /[a-z]{3,}/i.test(t) && t.split(/\s+/).length >= 3) out.push({ encoding: "base64", span: { start: m.index!, end: m.index! + m[0].length }, text: t });
  }
  for (const m of input.matchAll(/(?:[0-9a-f]{2}){12,}/gi)) {
    const t = m[0].match(/../g)!.map((h) => String.fromCharCode(parseInt(h, 16))).join("");
    if (printable(t) && t.split(/\s+/).length >= 3) out.push({ encoding: "hex", span: { start: m.index!, end: m.index! + m[0].length }, text: t });
  }
  for (const m of input.matchAll(/(?:%[0-9a-f]{2}[^%\s]{0,3}){6,}/gi)) {
    try {
      const t = decodeURIComponent(m[0]);
      if (t !== m[0] && printable(t)) out.push({ encoding: "url", span: { start: m.index!, end: m.index! + m[0].length }, text: t });
    } catch {
      /* not URL encoding */
    }
  }
  // ROT13: a sentence that reads as English only after rotating it.
  for (const m of input.matchAll(/[A-Za-z][A-Za-z ,.'!?]{24,}/g)) {
    const r = rot13(m[0]);
    if (englishness(r) > 0.25 && englishness(m[0]) < 0.05) out.push({ encoding: "rot13", span: { start: m.index!, end: m.index! + m[0].length }, text: r });
  }
  return out;
}
