/**
 * Benchmark on real, public prompt-injection and jailbreak data (see scripts/bench-data.ts).
 *   npm run bench                    measure on the held-out test split, write the report
 *   npm run bench -- --save-baseline also freeze this run as the "before" numbers
 *   npm run bench -- --errors=dev    print mistakes on the dev split (the only split used for tuning)
 *
 * A message counts as detected when Airlock blocks it or reports an attack finding (injection,
 * jailbreak, prompt leak, encoded or hidden text, exfiltration), which the default policy flags at
 * least. Redacting personal data does not count: that is not an attack verdict. Three configurations are measured: the rules alone, the
 * classifier alone, and the full firewall. Every number is computed here from the downloaded
 * files; nothing is estimated.
 *
 * Output: apps/web/public/benchmark.json (read by the Results page) and, with --save-baseline,
 * bench/baseline.json.
 */

import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { DEFAULT_POLICY, deserialize, featurize, inspect, predict, unmask, type Category, type Model } from "../packages/core/src/index";
import { DATASETS, loadDataset, splitOf, type BenchRow, type Split } from "./bench-data";

const args = new Set(process.argv.slice(2));
const errorsSplit = [...args].find((a) => a.startsWith("--errors="))?.split("=")[1] as Split | undefined;
if (errorsSplit && errorsSplit !== "dev") {
  console.error("Only dev-split mistakes can be printed. Looking at test mistakes would leak the test set into tuning.");
  process.exit(1);
}
const split: Split = errorsSplit ?? "test";

const model: Model = deserialize(JSON.parse(readFileSync("models/classifier.json", "utf8")));

const ATTACK = new Set<Category>(["injection", "jailbreak", "prompt-leak", "hidden-text", "encoded", "exfiltration"]);
type Cfg = "rules" | "classifier" | "airlock";
const CFGS: Cfg[] = ["rules", "classifier", "airlock"];

function detect(cfg: Cfg, r: BenchRow): { hit: boolean; blocked: boolean; ms: number } {
  if (cfg === "classifier") return { hit: predict(model, featurize(unmask(r.text).text)) >= DEFAULT_POLICY.flagAt, blocked: false, ms: 0 };
  const v = inspect(r.text, r.source, DEFAULT_POLICY, cfg === "airlock" ? model : undefined);
  return { hit: v.action === "block" || v.findings.some((x) => ATTACK.has(x.category)), blocked: v.action === "block", ms: v.ms };
}

type Counts = { tp: number; fp: number; tn: number; fn: number; blockedAttacks: number; blockedBenign: number };
const ratio = (a: number, b: number) => (b ? +(a / b).toFixed(4) : null);
function metrics(c: Counts) {
  const pos = c.tp + c.fn;
  const neg = c.tn + c.fp;
  // Precision only means something when the set has both classes.
  const precision = pos && neg ? ratio(c.tp, c.tp + c.fp) : null;
  const recall = ratio(c.tp, pos);
  const f1 = precision !== null && recall !== null && precision + recall > 0 ? +((2 * precision * recall) / (precision + recall)).toFixed(4) : precision !== null && recall !== null ? 0 : null;
  return { ...c, attacks: pos, benign: neg, precision, recall, f1, fpr: ratio(c.fp, neg), attacksBlocked: ratio(c.blockedAttacks, pos), benignBlocked: ratio(c.blockedBenign, neg) };
}

const loaded = await Promise.all(DATASETS.map(loadDataset));
const unavailable = loaded.filter((l) => "error" in l).map((l) => ({ id: l.dataset.id, name: l.dataset.name, error: (l as { error: string }).error }));
for (const u of unavailable) console.error(`! ${u.name}: ${u.error}`);

const pooled: Record<Cfg, Counts> = Object.fromEntries(CFGS.map((c) => [c, { tp: 0, fp: 0, tn: 0, fn: 0, blockedAttacks: 0, blockedBenign: 0 }])) as Record<Cfg, Counts>;
const times: number[] = [];
const mistakes: { dataset: string; kind: "miss" | "false alarm"; text: string }[] = [];
const datasets = [];

for (const l of loaded) {
  if ("error" in l) continue;
  const rows = l.rows.filter((r) => splitOf(r) === split);
  const byCfg = {} as Record<Cfg, ReturnType<typeof metrics>>;
  for (const cfg of CFGS) {
    const c: Counts = { tp: 0, fp: 0, tn: 0, fn: 0, blockedAttacks: 0, blockedBenign: 0 };
    for (const r of rows) {
      const d = detect(cfg, r);
      if (cfg === "airlock") times.push(d.ms);
      if (r.label === 1) {
        if (d.hit) c.tp++;
        else c.fn++;
        if (d.blocked) c.blockedAttacks++;
      } else {
        if (d.hit) c.fp++;
        else c.tn++;
        if (d.blocked) c.blockedBenign++;
      }
      if (cfg === "airlock" && errorsSplit && d.hit !== (r.label === 1)) mistakes.push({ dataset: l.dataset.id, kind: r.label ? "miss" : "false alarm", text: r.text });
    }
    for (const k of Object.keys(c) as (keyof Counts)[]) pooled[cfg][k] += c[k];
    byCfg[cfg] = metrics(c);
  }
  datasets.push({
    id: l.dataset.id,
    name: l.dataset.name,
    home: l.dataset.home,
    licence: l.dataset.licence,
    note: l.dataset.note,
    rowsTotal: l.rows.length,
    rowsInSplit: rows.length,
    attacks: rows.filter((r) => r.label === 1).length,
    benign: rows.filter((r) => r.label === 0).length,
    results: byCfg,
  });
}

times.sort((a, b) => a - b);
const pct = (p: number) => (times.length ? +times[Math.floor((times.length - 1) * p)].toFixed(3) : null);
let commit = "unknown";
try {
  commit = execSync("git rev-parse --short HEAD", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
} catch {
  /* not a git checkout */
}

const run = {
  generatedAt: new Date().toISOString(),
  commit,
  split,
  detectedMeans: "blocked, or an attack finding reported (flagged)",
  datasets,
  pooled: Object.fromEntries(CFGS.map((c) => [c, metrics(pooled[c])])),
  latencyMs: { p50: pct(0.5), p95: pct(0.95), p99: pct(0.99) },
  unavailable,
};

if (errorsSplit) {
  for (const m of mistakes) console.log(`[${m.dataset}] ${m.kind}: ${m.text.replace(/\s+/g, " ").slice(0, 300)}`);
  console.log(`\n${mistakes.length} mistakes on the dev split`);
  process.exit(0);
}

mkdirSync("bench", { recursive: true });
if (args.has("--save-baseline")) writeFileSync("bench/baseline.json", JSON.stringify(run, null, 2) + "\n");
const baseline = existsSync("bench/baseline.json") ? JSON.parse(readFileSync("bench/baseline.json", "utf8")) : null;
writeFileSync("apps/web/public/benchmark.json", JSON.stringify({ current: run, baseline }, null, 2) + "\n");

const f = (v: number | null) => (v === null ? "  n/a " : `${(v * 100).toFixed(1).padStart(5)}%`);
console.log(`split: ${split}, commit ${commit}\n`);
console.log("dataset".padEnd(26), "cfg".padEnd(10), "  n     ", "prec  ", " recall", "  F1   ", "  FPR");
for (const d of datasets)
  for (const c of CFGS) {
    const m = d.results[c];
    console.log(d.id.padEnd(26), c.padEnd(10), String(d.rowsInSplit).padStart(6), f(m.precision), f(m.recall), f(m.f1), f(m.fpr));
  }
for (const c of CFGS) {
  const m = run.pooled[c];
  console.log("POOLED".padEnd(26), c.padEnd(10), String(m.attacks + m.benign).padStart(6), f(m.precision), f(m.recall), f(m.f1), f(m.fpr));
}
console.log(`\nlatency (airlock): p50 ${run.latencyMs.p50} ms, p95 ${run.latencyMs.p95} ms, p99 ${run.latencyMs.p99} ms`);
