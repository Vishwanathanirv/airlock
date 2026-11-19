/**
 * Chooses training settings without touching the test split. Splits the dev half once more
 * (80% fit, 20% validation), trains on the fit part plus the synthetic corpus, and reports
 * validation numbers for the full firewall.
 *   npm run tune
 */

import { DEFAULT_POLICY, inspect, train, unmask, type Category, type Model } from "../packages/core/src/index";
import { DATASETS, loadDataset, SELF_INSTRUCT_DATA, splitOf, type BenchRow } from "./bench-data";
import { buildRealTrain, buildTrain } from "./train";

const h = (s: string) => {
  let x = 0x9e3779b9;
  for (let i = 0; i < s.length; i++) x = Math.imul(x ^ s.charCodeAt(i), 0x01000193);
  return x >>> 0;
};
const isVal = (r: BenchRow) => h(`val:${r.group}`) % 5 === 0;
const ATTACK = new Set<Category>(["injection", "jailbreak", "prompt-leak", "hidden-text", "encoded", "exfiltration"]);

const { rows } = await buildRealTrain((r) => !isVal(r));
const trained = new Set(rows.map((r) => r.text));
const jbh = await loadDataset(DATASETS[0]);
const si = await loadDataset(SELF_INSTRUCT_DATA);
if ("error" in jbh || "error" in si) throw new Error("data unavailable");
const valJ = jbh.rows.filter((r) => splitOf(r) === "dev" && isVal(r));
const valS = si.rows.filter((r) => isVal(r) && !trained.has(r.text)).slice(0, 3000);

const synth = buildTrain().map((x) => ({ text: x.text, label: x.label }));
for (const cfg of [{ epochs: 12, lr: 0.5, l2: 1e-5 }, { epochs: 20, lr: 0.3, l2: 1e-5 }]) {
  const model: Model = train([...synth, ...rows].map((x) => ({ text: unmask(x.text).text, label: x.label })), cfg);
  for (const [flagAt, blockAt] of [[0.6, 0.85], [0.7, 0.9]]) {
    const policy = { ...DEFAULT_POLICY, flagAt, blockAt };
    const hit = (r: BenchRow) => {
      const v = inspect(r.text, r.source, policy, model);
      return v.action === "block" || v.findings.some((f) => ATTACK.has(f.category));
    };
    const pos = valJ.filter((r) => r.label === 1);
    const neg = valJ.filter((r) => r.label === 0);
    const tp = pos.filter(hit).length;
    const fp = neg.filter(hit).length;
    const fpS = valS.filter(hit).length;
    const p = tp / (tp + fp);
    const rc = tp / pos.length;
    console.log(JSON.stringify(cfg), `flag ${flagAt}`, `JBH-val n=${valJ.length} P ${(p * 100).toFixed(1)} R ${(rc * 100).toFixed(1)} F1 ${((200 * p * rc) / (p + rc)).toFixed(1)} FPR ${((100 * fp) / neg.length).toFixed(1)}`, `| SelfInstruct-val FPR ${((100 * fpS) / valS.length).toFixed(1)} (n=${valS.length})`);
  }
}
