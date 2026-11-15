/**
 * Builds the corpus, trains the classifier on the training split and writes the model.
 *   npm run train
 * Output: models/classifier.json (also copied into the web app for the browser demo).
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { serialize, train, unmask } from "../packages/core/src/index";
import { attack, benign, Rng, type Row } from "./corpus-parts";

export function buildTrain(n = 4000, seed = 11): Row[] {
  const r = new Rng(seed);
  const rows: Row[] = [];
  for (let i = 0; i < n; i++) rows.push(attack(r), benign(r));
  // De-duplicate: templates repeat, and duplicates would overweight a few phrasings.
  const seen = new Set<string>();
  return rows.filter((x) => (seen.has(x.text) ? false : (seen.add(x.text), true)));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const rows = buildTrain();
  const t0 = performance.now();
  const model = train(rows.map((x) => ({ text: unmask(x.text).text, label: x.label })));
  const json = serialize(model);
  mkdirSync("models", { recursive: true });
  mkdirSync("data", { recursive: true });
  writeFileSync("models/classifier.json", JSON.stringify(json));
  writeFileSync("data/train.jsonl", rows.map((x) => JSON.stringify(x)).join("\n") + "\n");
  console.log(`trained on ${rows.length} rows (${rows.filter((x) => x.label).length} attacks) in ${Math.round(performance.now() - t0)} ms; ${json.idx.length} non-zero weights`);
}
