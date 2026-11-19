import { useEffect, useState } from "react";

type Cfg = "rules" | "classifier" | "airlock";
type M = { attacks: number; benign: number; precision: number | null; recall: number | null; f1: number | null; fpr: number | null; attacksBlocked: number | null };
type Dataset = { id: string; name: string; home: string; licence: string; note: string; rowsTotal: number; rowsInSplit: number; attacks: number; benign: number; results: Record<Cfg, M> };
type Run = { generatedAt: string; commit: string; split: string; datasets: Dataset[]; pooled: Record<Cfg, M>; latencyMs: { p50: number; p95: number; p99: number }; unavailable: { name: string; error: string }[] };
type Bench = { current: Run; baseline: Run | null };

const METRICS = [
  { k: "precision", t: "Precision", up: true },
  { k: "recall", t: "Recall", up: true },
  { k: "f1", t: "F1", up: true },
  { k: "fpr", t: "False alarms", up: false },
] as const;
const pct = (v: number | null | undefined) => (v === null || v === undefined ? "n/a" : `${(v * 100).toFixed(1)}%`);

/** "before → after", coloured by whether it got better. */
function Delta({ before, after, up }: { before: number | null | undefined; after: number | null; up: boolean }) {
  if (after === null) return <span className="text-faint">n/a</span>;
  const better = before === null || before === undefined || after === before ? null : (after > before) === up;
  return (
    <span className="whitespace-nowrap">
      {before !== null && before !== undefined && <span className="text-faint">{pct(before)} → </span>}
      <span className={`font-bold ${better === null ? "" : better ? "text-[var(--go)]" : "text-[var(--stop)]"}`}>{pct(after)}</span>
    </span>
  );
}

/** One dataset, printed like a screening slip: what went through, what it caught. */
function Slip({ d, before }: { d: Dataset; before?: Dataset }) {
  const a = d.results.airlock;
  return (
    <article className="panel overflow-hidden">
      <header className="sign flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-4 py-2 font-mono text-[11px] uppercase tracking-[0.14em]">
        <span>{d.id}</span>
        <span className="font-normal opacity-80">
          {d.attacks.toLocaleString()} attacks · {d.benign.toLocaleString()} benign
        </span>
      </header>
      <div className="p-4">
        <h3 className="font-bold">
          <a href={d.home} target="_blank" rel="noreferrer" className="underline decoration-line underline-offset-4 hover:decoration-[var(--ink)]">
            {d.name}
          </a>
        </h3>
        <p className="mt-1 text-xs text-faint">Licence: {d.licence}</p>
        <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 font-mono text-[13px]">
          {METRICS.map((m) => (
            <div key={m.k} className="flex items-baseline justify-between gap-2 border-b border-dashed border-line pb-1">
              <dt className="font-sans text-xs text-muted">{m.t}</dt>
              <dd>
                <Delta before={before?.results.airlock[m.k]} after={a[m.k]} up={m.up} />
              </dd>
            </div>
          ))}
        </dl>
        <p className="mt-3 text-[13px] leading-relaxed text-muted">{d.note}</p>
      </div>
    </article>
  );
}

/** Per layer, after: how much each catches and how often it cries wolf. */
function Layers({ run }: { run: Run }) {
  const rows = [...run.datasets.map((d) => ({ id: d.id, r: d.results })), { id: "all (pooled)", r: run.pooled }];
  const bar = (v: number | null, colour: string) => (
    <div className="h-2 rounded-full bg-panel-2">
      <div className="h-full rounded-full" style={{ width: v === null ? 0 : `${Math.max(v * 100, v > 0 ? 1 : 0)}%`, background: colour }} />
    </div>
  );
  return (
    <section className="panel p-5">
      <h3 className="text-lg font-bold">What each layer adds, after</h3>
      <p className="mt-1 text-sm text-muted">
        Orange bars: share of attacks caught. Red bars: share of harmless messages flagged. <span className="font-mono">n/a</span> where a dataset has only one kind.
      </p>
      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[34rem] font-mono text-[12.5px]">
          <thead className="text-left text-faint">
            <tr>
              <th className="py-1 pr-3 font-medium">dataset</th>
              {(["rules", "classifier", "airlock"] as const).map((c) => (
                <th key={c} className="px-2 py-1 font-medium">
                  {c === "airlock" ? "Airlock (all layers)" : c === "rules" ? "rules only" : "classifier only"}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map(({ id, r }) => (
              <tr key={id} className="border-t border-line align-top">
                <td className="py-2 pr-3">{id}</td>
                {(["rules", "classifier", "airlock"] as const).map((c) => (
                  <td key={c} className="w-1/4 px-2 py-2">
                    {r[c].recall !== null && (
                      <div className="grid grid-cols-[1fr_3.6rem] items-center gap-2">
                        {bar(r[c].recall, "var(--x-attack)")}
                        <span className="text-right">{pct(r[c].recall)}</span>
                      </div>
                    )}
                    {r[c].fpr !== null && (
                      <div className="mt-1 grid grid-cols-[1fr_3.6rem] items-center gap-2">
                        {bar(r[c].fpr, "var(--x-out)")}
                        <span className="text-right text-muted">{pct(r[c].fpr)}</span>
                      </div>
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export function RealResults() {
  const [b, setB] = useState<Bench | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    fetch("/benchmark.json")
      .then((x) => (x.ok ? x.json() : Promise.reject(new Error("No benchmark report yet. Run npm run bench."))))
      .then(setB, (e: Error) => setError(e.message));
  }, []);
  if (error) return <p className="text-muted">{error}</p>;
  if (!b) return <p className="text-muted">Loading the benchmark…</p>;
  const { current: c, baseline: base } = b;
  const before = (id: string) => base?.datasets.find((d) => d.id === id);
  const p = c.pooled.airlock;
  const pb = base?.pooled.airlock;
  return (
    <div>
      <div className="flex flex-wrap items-baseline gap-3">
        <h2 className="text-[1.35rem] font-bold leading-tight tracking-[-0.01em]">Measured on real public data</h2>
        <span className="rounded-[4px] border border-[var(--go)] px-1.5 py-0.5 font-mono text-[11px] font-bold uppercase tracking-wider text-[var(--go)]">real</span>
      </div>
      <p className="mt-3 max-w-3xl text-[1.02rem] leading-relaxed text-muted">
        Prompts written by real people, from public datasets, pinned to a commit and checked by hash. Every number is computed by <code>npm run bench</code> on the held-out test half of each dataset; nothing was tuned on it. "Before" is the original classifier, trained only on synthetic text. "After" adds real training data from the other half (dev). A message counts as caught when Airlock blocks it or flags an attack.
      </p>

      <div className="mt-6 grid gap-px overflow-hidden rounded-[6px] border border-line bg-line sm:grid-cols-2 lg:grid-cols-4">
        {METRICS.map((m) => (
          <div key={m.k} className="bg-panel p-4">
            <div className="font-mono text-2xl">
              <Delta before={pb?.[m.k]} after={p[m.k]} up={m.up} />
            </div>
            <div className="mt-1 text-sm font-semibold">{m.t}, all datasets pooled</div>
            <div className="mt-0.5 text-xs text-faint">
              {(p.attacks + p.benign).toLocaleString()} test messages ({p.attacks.toLocaleString()} attacks)
            </div>
          </div>
        ))}
      </div>

      <div className="mt-6 grid gap-4 md:grid-cols-2">
        {c.datasets.map((d) => (
          <Slip key={d.id} d={d} before={before(d.id)} />
        ))}
      </div>

      <div className="mt-6">
        <Layers run={c} />
      </div>

      <section className="panel mt-6 p-5">
        <h3 className="text-lg font-bold">Read these with care</h3>
        <ul className="mt-2 list-disc space-y-1.5 pl-5 text-sm leading-relaxed text-muted">
          <li>
            Fewer false alarms cost recall. On Tensor Trust, recall fell (hijacking {pct(before("tensortrust-hijacking")?.results.airlock.recall)} → {pct(c.datasets.find((d) => d.id === "tensortrust-hijacking")?.results.airlock.recall)}). The old classifier caught those attacks mostly by flagging anything that read like an instruction. It also flagged {pct(before("alpaca")?.results.airlock.fpr)} of everyday Alpaca requests.
          </li>
          <li>JailbreakHub labels jailbreaks, not injections. Many of its "regular" prompts start with "Ignore all previous instructions. You are now…", which Airlock flags on purpose. Most of the false alarms there come from the rules for exactly that phrasing.</li>
          <li>Tensor Trust, Alpaca and BIPIA were never trained or tuned on. JailbreakHub's dev half was trained on, so its test half is the closest to in-distribution.</li>
          {c.unavailable.map((u) => (
            <li key={u.name}>
              Not measured: {u.name} ({u.error}).
            </li>
          ))}
        </ul>
        <p className="mt-4 text-xs text-faint">
          Median {c.latencyMs.p50} ms, p95 {c.latencyMs.p95} ms per message. Generated {new Date(c.generatedAt).toLocaleString()} at commit {c.commit}
          {base ? `; before: commit ${base.commit}` : ""}. Reproduce with <code>npm run bench</code>.
        </p>
      </section>
    </div>
  );
}
