import { useEffect, useState } from "react";

type Row = { n: number; rules: number | null; classifier: number | null; firewall: number | null };
type Report = {
  generatedAt: string;
  sizes: { trainRows: number; testAttacks: number; testBenign: number; disguisedAttacks: number };
  summary: { attacksCaught: number; attacksBlocked: number; disguisedCaught: number; benignFlagged: number; benignBlocked: number; heldOutBenignFlagged: number };
  byFamily: Record<string, Row>;
  byDisguise: Record<string, Row>;
  latencyMs: { p50: number; p95: number; p99: number };
  falseAlarms: string[];
  misses: string[];
};

const FAMILY: Record<string, string> = { override: "Override the instructions", leak: "Extract the system prompt", jailbreak: "Jailbreak persona", indirect: "Planted in a document", exfil: "Send data out", "never seen in training": "Hand-written, never seen in training" };
const DISGUISE: Record<string, string> = { "zero-width": "Zero-width characters", homoglyph: "Look-alike letters", spaced: "S p a c e d  out", base64: "Base64", leet: "l33t", "tag-smuggling": "Invisible tag characters" };
const pct = (v: number | null) => (v === null ? "–" : `${Math.round(v * 1000) / 10}%`);

/** Bars for rules alone, classifier alone and the full firewall, so you can see what each layer adds. */
function Compare({ title, rows, names }: { title: string; rows: Record<string, Row>; names: Record<string, string> }) {
  return (
    <section className="panel p-5">
      <h2 className="text-lg font-bold">{title}</h2>
      <div className="mt-1 flex gap-4 text-xs text-muted">
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-4 bg-faint/50" /> Rules only
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-4 bg-[var(--x-data)]" /> Classifier only
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-4 bg-ink" /> Airlock (both, plus unmasking)
        </span>
      </div>
      <div className="mt-4 space-y-4">
        {Object.entries(rows).map(([k, r]) => (
          <div key={k}>
            <div className="flex justify-between text-sm">
              <span className="font-semibold">{names[k] ?? k}</span>
              <span className="text-faint">{r.n} cases</span>
            </div>
            {(["rules", "classifier", "firewall"] as const).map((c) => (
              <div key={c} className="mt-1 grid grid-cols-[1fr_3.5rem] items-center gap-2">
                <div className="h-2.5 rounded-full bg-panel-2">
                  <div className="h-full rounded-full" style={{ width: pct(r[c]), background: c === "rules" ? "color-mix(in oklab, var(--faint) 50%, transparent)" : c === "classifier" ? "var(--x-data)" : "var(--ink)" }} />
                </div>
                <span className={`text-right font-mono text-xs ${c === "firewall" ? "font-bold" : "text-muted"}`}>{pct(r[c])}</span>
              </div>
            ))}
          </div>
        ))}
      </div>
    </section>
  );
}

export function Results() {
  const [r, setR] = useState<Report | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    fetch("/evaluation.json")
      .then((x) => (x.ok ? x.json() : Promise.reject(new Error("No evaluation report yet. Run npm run evaluate."))))
      .then(setR, (e: Error) => setError(e.message));
  }, []);
  if (error) return <p className="text-muted">{error}</p>;
  if (!r) return <p className="text-muted">Loading the report…</p>;
  const s = r.summary;
  return (
    <div>
      <h2 className="text-[1.35rem] font-bold leading-tight tracking-[-0.01em]">Measured on text it never trained on</h2>
      <p className="mt-3 max-w-3xl text-[1.02rem] leading-relaxed text-muted">
        {r.sizes.testAttacks} attacks and {r.sizes.testBenign} everyday messages kept out of training, plus every attack again in six disguises ({r.sizes.disguisedAttacks.toLocaleString()} more). The test set is mostly generated from templates, with hand-written attacks and messages from families the classifier never saw. Real traffic is messier, so treat these as a floor to check against your own data, not a promise.
      </p>

      <div className="mt-6 grid gap-px overflow-hidden rounded-[6px] border border-line bg-line sm:grid-cols-2 lg:grid-cols-5">
        {(
          [
            [pct(s.attacksCaught), "of attacks caught", `${pct(s.attacksBlocked)} blocked outright, the rest flagged`],
            [pct(s.disguisedCaught), "of disguised attacks caught", "hidden with encodings, invisible characters, look-alikes"],
            [pct(s.benignFlagged), "of everyday messages flagged", `${pct(s.benignBlocked)} blocked`],
            [`${r.latencyMs.p50} ms`, "per message (median)", `p95 ${r.latencyMs.p95} ms, in the browser or on the server`],
            [String(r.misses.length + r.falseAlarms.length), "mistakes, listed below", "misses and false alarms, not hidden"],
          ] as const
        ).map(([v, l, sub]) => (
          <div key={l} className="bg-panel p-4">
            <div className="font-mono text-2xl font-bold">{v}</div>
            <div className="mt-1 text-sm font-semibold">{l}</div>
            <div className="mt-0.5 text-xs text-faint">{sub}</div>
          </div>
        ))}
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Compare title="By kind of attack" rows={r.byFamily} names={FAMILY} />
        <Compare title="By disguise" rows={r.byDisguise} names={DISGUISE} />
      </div>
      <p className="mt-3 max-w-3xl text-sm text-muted">Neither layer is enough alone. Rules are exact but miss paraphrases; the classifier generalises but can't read base64. Unmasking first is what lets both see through disguises.</p>

      <section className="panel mt-6 p-5">
        <h2 className="text-lg font-bold">Every mistake</h2>
        <div className="mt-3 grid gap-6 md:grid-cols-2">
          <div>
            <h3 className="text-sm font-semibold">Attacks it missed ({r.misses.length})</h3>
            {r.misses.length ? (
              <ul className="mt-2 space-y-1.5 text-sm text-muted">
                {r.misses.map((m) => (
                  <li key={m}>“{m}”</li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-sm text-muted">None in this test set.</p>
            )}
          </div>
          <div>
            <h3 className="text-sm font-semibold">Everyday messages it wrongly flagged ({r.falseAlarms.length})</h3>
            {r.falseAlarms.length ? (
              <ul className="mt-2 space-y-1.5 text-sm text-muted">
                {r.falseAlarms.map((m) => (
                  <li key={m}>“{m}”</li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-sm text-muted">None in this test set.</p>
            )}
          </div>
        </div>
        <p className="mt-4 text-xs text-faint">
          Generated {new Date(r.generatedAt).toLocaleString()} from {r.sizes.trainRows.toLocaleString()} training rows. Reproduce with <code>npm run train && npm run evaluate</code>.
        </p>
      </section>
    </div>
  );
}
