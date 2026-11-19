/**
 * Builds the training set, trains the classifier and writes the model.
 *   npm run train
 * Output: models/classifier.json (also copied into the web app for the browser demo) and
 * data/train.jsonl (the synthetic part; the public data is re-downloaded, not committed).
 *
 * Training data:
 * - Synthetic attacks and everyday messages generated from templates (scripts/corpus-parts.ts).
 * - JailbreakHub, dev half only (MIT): real jailbreak prompts, and the "regular" prompts from the
 *   same communities as benign. Regular prompts that the hand-written rules flag as an injection
 *   ("Ignore all previous instructions. You are now...") are left out rather than taught as
 *   benign: the dataset labels jailbreaks, not injections, so those labels don't fit this task.
 * - Self-Instruct (Apache-2.0): everyday instructions, minus anything also in Alpaca.
 * The test halves, Tensor Trust, Alpaca and BIPIA are never trained on (see npm run bench).
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { inspect, serialize, train, unmask } from "../packages/core/src/index";
import { DATASETS, loadDataset, SELF_INSTRUCT_DATA, splitOf, type BenchRow } from "./bench-data";
import { attack, benign, Rng, type Row } from "./corpus-parts";

export function buildTrain(n = 4000, seed = 11): Row[] {
  const r = new Rng(seed);
  const rows: Row[] = [];
  for (let i = 0; i < n; i++) rows.push(attack(r), benign(r));
  // De-duplicate: templates repeat, and duplicates would overweight a few phrasings.
  const seen = new Set<string>();
  return rows.filter((x) => (seen.has(x.text) ? false : (seen.add(x.text), true)));
}

const RULE_ATTACK = new Set(["injection", "jailbreak", "prompt-leak", "encoded", "exfiltration"]);
export const SELF_INSTRUCT_ROWS = 12_000;

/** Deterministic sample: the rows whose hash is smallest. */
function sample<T extends { text: string }>(rows: T[], n: number): T[] {
  const h = (s: string) => {
    let x = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) x = Math.imul(x ^ s.charCodeAt(i), 0x01000193);
    return x >>> 0;
  };
  return [...rows].sort((a, b) => h(a.text) - h(b.text) || (a.text < b.text ? -1 : 1)).slice(0, n);
}

export type TrainRow = { text: string; label: 0 | 1; from: string };

/** The real-data part of the training set. `keep` picks which dev rows to use (all by default). */
export async function buildRealTrain(keep: (r: BenchRow) => boolean = () => true): Promise<{ rows: TrainRow[]; dropped: number; alpacaOverlap: number }> {
  const byId = (id: string) => DATASETS.find((d) => d.id === id)!;
  const [jbh, si, alpaca] = await Promise.all([loadDataset(byId("jailbreakhub")), loadDataset(SELF_INSTRUCT_DATA), loadDataset(byId("alpaca"))]);
  for (const l of [jbh, si, alpaca]) if ("error" in l) throw new Error(`${l.dataset.name}: ${l.error}`);
  const ok = <T,>(l: { rows: T[] } | { error: string }) => (l as { rows: T[] }).rows;

  let dropped = 0;
  const rows: TrainRow[] = [];
  for (const r of ok<BenchRow>(jbh)) {
    if (splitOf(r) !== "dev" || !keep(r)) continue;
    if (r.label === 0 && inspect(r.text, "user").findings.some((f) => RULE_ATTACK.has(f.category))) {
      dropped++;
      continue;
    }
    rows.push({ text: r.text, label: r.label, from: "jailbreakhub" });
  }
  const alpacaInstr = new Set(ok<BenchRow>(alpaca).map((r) => r.text.split("\n\n")[0].toLowerCase()));
  const siRows = ok<BenchRow>(si);
  const clean = siRows.filter((r) => !alpacaInstr.has(r.group));
  for (const r of sample(clean.filter(keep), SELF_INSTRUCT_ROWS)) rows.push({ text: r.text, label: 0, from: "self-instruct" });
  return { rows, dropped, alpacaOverlap: siRows.length - clean.length };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const synthetic = buildTrain();
  const real = await buildRealTrain();
  const all = [...synthetic.map((x) => ({ text: x.text, label: x.label })), ...real.rows];
  const t0 = performance.now();
  const model = train(all.map((x) => ({ text: unmask(x.text).text, label: x.label })));
  const json = serialize(model);
  mkdirSync("models", { recursive: true });
  mkdirSync("data", { recursive: true });
  writeFileSync("models/classifier.json", JSON.stringify(json));
  writeFileSync("data/train.jsonl", synthetic.map((x) => JSON.stringify(x)).join("\n") + "\n");
  const count = (from: string, label: 0 | 1) => real.rows.filter((r) => r.from === from && r.label === label).length;
  console.log(
    `trained on ${all.length} rows in ${Math.round(performance.now() - t0)} ms; ${json.idx.length} non-zero weights\n` +
      `  synthetic: ${synthetic.length} (${synthetic.filter((x) => x.label).length} attacks)\n` +
      `  JailbreakHub dev: ${count("jailbreakhub", 1)} jailbreaks, ${count("jailbreakhub", 0)} regular (${real.dropped} regular prompts left out because the rules flag them as injections)\n` +
      `  Self-Instruct: ${count("self-instruct", 0)} (${real.alpacaOverlap} rows dropped for overlapping Alpaca)`,
  );
}
