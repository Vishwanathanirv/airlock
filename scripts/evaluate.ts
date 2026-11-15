/**
 * Measures the firewall on text it was not trained on.
 *   npm run evaluate
 *
 * Test set: template attacks and benign messages from a different random seed (anything that
 * also appears in training is removed), hand-written attacks and benign messages from families
 * never used in training, and every test attack again in six disguises. Reports detection by
 * attack family and disguise for the rules alone, the classifier alone and the full firewall,
 * the false-alarm rate on benign text, and latency.
 *
 * Output: apps/web/public/evaluation.json, read by the dashboard and quoted in the README.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { DEFAULT_POLICY, deserialize, featurize, inspect, predict, unmask, type Model } from "../packages/core/src/index";
import { attack, benign, DISGUISES, HELD_OUT_ATTACKS, HELD_OUT_BENIGN, Rng, type Row } from "./corpus-parts";
import { buildTrain } from "./train";

const model: Model = deserialize(JSON.parse(readFileSync("models/classifier.json", "utf8")));
const trained = new Set(buildTrain().map((r) => r.text));

const r = new Rng(9001);
const tAttacks: Row[] = [];
const tBenign: Row[] = [];
for (let i = 0; i < 3000 && (tAttacks.length < 400 || tBenign.length < 400); i++) {
  const a = attack(r);
  const b = benign(r);
  if (!trained.has(a.text) && tAttacks.length < 400 && !tAttacks.some((x) => x.text === a.text)) tAttacks.push(a);
  if (!trained.has(b.text) && tBenign.length < 400 && !tBenign.some((x) => x.text === b.text)) tBenign.push(b);
}
const heldA: Row[] = HELD_OUT_ATTACKS.map((x) => ({ ...x, label: 1 }));
const heldB: Row[] = HELD_OUT_BENIGN.map((x) => ({ ...x, label: 0 }));

type Cfg = "rules" | "classifier" | "firewall";
const source = (row: Row) => (row.family === "indirect" || /^(FAQ|Help article|Policy|Update|Returns policy|Shipping info|Product sheet|Article)/.test(row.text) ? "context" : "user");
function caught(cfg: Cfg, text: string, src: "user" | "context") {
  if (cfg === "classifier") return predict(model, featurize(unmask(text).text)) >= DEFAULT_POLICY.flagAt;
  const v = inspect(text, src, DEFAULT_POLICY, cfg === "firewall" ? model : undefined);
  return v.action === "block" || v.action === "flag";
}
const blocked = (text: string, src: "user" | "context") => inspect(text, src, DEFAULT_POLICY, model).action === "block";
const rate = (xs: boolean[]) => (xs.length ? +(xs.filter(Boolean).length / xs.length).toFixed(3) : null);

const cfgs: Cfg[] = ["rules", "classifier", "firewall"];
const byFamily: Record<string, Record<Cfg, number | null> & { n: number }> = {};
const groups: Record<string, Row[]> = {};
for (const a of [...tAttacks, ...heldA]) (groups[a.family === "held-out" ? "never seen in training" : a.family] ??= []).push(a);
for (const [fam, rows] of Object.entries(groups)) {
  byFamily[fam] = { n: rows.length } as (typeof byFamily)[string];
  for (const c of cfgs) byFamily[fam][c] = rate(rows.map((x) => caught(c, x.text, source(x))));
}

const disguisePool = [...heldA, ...tAttacks.filter((x) => x.family !== "indirect").slice(0, 80)];
const byDisguise: Record<string, Record<Cfg, number | null> & { n: number }> = {};
for (const [name, fn] of Object.entries(DISGUISES)) {
  const rows = disguisePool.map((x) => fn(x.text));
  byDisguise[name] = { n: rows.length } as (typeof byDisguise)[string];
  for (const c of cfgs) byDisguise[name][c] = rate(rows.map((t) => caught(c, t, "user")));
}

const allAttacks = [...tAttacks, ...heldA];
const allBenign = [...tBenign, ...heldB];
const summary = {
  attacksCaught: rate(allAttacks.map((x) => caught("firewall", x.text, source(x)))),
  attacksBlocked: rate(allAttacks.map((x) => blocked(x.text, source(x)))),
  disguisedCaught: rate(disguisePool.flatMap((x) => Object.values(DISGUISES).map((fn) => caught("firewall", fn(x.text), "user")))),
  benignFlagged: rate(allBenign.map((x) => caught("firewall", x.text, source(x)))),
  benignBlocked: rate(allBenign.map((x) => blocked(x.text, source(x)))),
  heldOutBenignFlagged: rate(heldB.map((x) => caught("firewall", x.text, source(x)))),
};
const falseAlarms = allBenign.filter((x) => caught("firewall", x.text, source(x))).map((x) => x.text);
const misses = allAttacks.filter((x) => !caught("firewall", x.text, source(x))).map((x) => x.text);

const sample = [...allAttacks, ...allBenign].slice(0, 600);
const times: number[] = [];
for (let k = 0; k < 3; k++) for (const x of sample) times.push(inspect(x.text, source(x), DEFAULT_POLICY, model).ms);
times.sort((a, b) => a - b);
const pct = (p: number) => +times[Math.floor((times.length - 1) * p)].toFixed(3);

const report = {
  generatedAt: new Date().toISOString(),
  sizes: { trainRows: trained.size, testAttacks: allAttacks.length, testBenign: allBenign.length, disguisedAttacks: disguisePool.length * Object.keys(DISGUISES).length },
  summary,
  byFamily,
  byDisguise,
  latencyMs: { p50: pct(0.5), p95: pct(0.95), p99: pct(0.99) },
  falseAlarms,
  misses,
};
writeFileSync("apps/web/public/evaluation.json", JSON.stringify(report, null, 2));
console.log(JSON.stringify({ ...report, falseAlarms: falseAlarms.length, misses: misses.length }, null, 2));
if (falseAlarms.length) console.log("false alarms:\n  " + falseAlarms.join("\n  "));
if (misses.length) console.log("misses:\n  " + misses.slice(0, 30).join("\n  "));
