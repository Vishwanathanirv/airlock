/**
 * The public datasets the benchmark runs on. Every file is pinned to a commit and checked
 * against a SHA-256, so a run measures exactly the same text every time. Files are downloaded
 * on first use into .cache/bench (git-ignored) and are never committed or redistributed.
 *
 * Wanted but not reachable from the build environment: Hugging Face (deepset/prompt-injections,
 * jackhhao/jailbreak-classification, Lakera/gandalf_ignore_instructions). Those are hosted only on
 * huggingface.co; see README "Benchmark on public data".
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

export type Source = "user" | "context";
export type BenchRow = { dataset: string; text: string; label: 0 | 1; source: Source; /** Rows with the same group always land in the same split. */ group: string };
export type Split = "dev" | "test";

type File = { url: string; sha256: string };
export type Dataset = {
  id: string;
  name: string;
  home: string;
  licence: string;
  /** What the dataset is and how its rows are used here. */
  note: string;
  files: Record<string, File>;
  load: (files: Record<string, string>) => BenchRow[];
};

const GH = "https://raw.githubusercontent.com";
const JAILBREAKHUB = "4f4031bf8be187f4478c7f94f42b08714722c12e";
const TENSOR_TRUST = "747a75e096761ebc01bd3970158827326b4add23";
const ALPACA = "761dc5bfbdeeffa89b8bff5d038781a4055f796a";
const BIPIA = "a004b69ec0dd446e0afd461d98cb5e96e120a5d0";
const SELF_INSTRUCT = "0b26ccaa415992100fa32df62d41b994cf928e23";

/** RFC 4180 CSV, enough for quoted fields with commas, quotes and newlines. */
export function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  const endField = () => {
    row.push(field);
    field = "";
  };
  const endRow = () => {
    endField();
    rows.push(row);
    row = [];
  };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c !== '"') field += c;
      else if (text[i + 1] === '"') {
        field += '"';
        i++;
      } else quoted = false;
    } else if (c === '"') quoted = true;
    else if (c === ",") endField();
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      endRow();
    } else field += c;
  }
  if (field || row.length) endRow();
  const [head, ...body] = rows;
  return body.filter((r) => r.length === head.length).map((r) => Object.fromEntries(head.map((h, i) => [h, r[i]])));
}

const jsonl = (s: string) => s.split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l) as Record<string, unknown>);
const clean = (s: string) => s.replace(/\r\n/g, "\n").trim();

export const DATASETS: Dataset[] = [
  {
    id: "jailbreakhub",
    name: "JailbreakHub (in-the-wild prompts)",
    home: "https://github.com/verazuo/jailbreak_llms",
    licence: "MIT",
    note: "Prompts collected from Reddit, Discord and prompt-sharing sites, Dec 2022 to Dec 2023 (CCS 2024). Jailbreak prompts are attacks; the 'regular' prompts from the same communities are benign, and include many role-play prompts, so it is a hard false-positive test. Jailbreaks are split by the dataset's own community id, so near-copies of one jailbreak never straddle the split.",
    files: {
      jailbreak: { url: `${GH}/verazuo/jailbreak_llms/${JAILBREAKHUB}/data/prompts/jailbreak_prompts_2023_12_25.csv`, sha256: "accf97463de96c33c48453dfee9600191ff6fd5a0c43f3f11d5ebf98d1a5de55" },
      regular: { url: `${GH}/verazuo/jailbreak_llms/${JAILBREAKHUB}/data/prompts/regular_prompts_2023_12_25.csv`, sha256: "fb82e3f88fbd5d9c6edf8927b138510f339b85012cab24d41d13e1665a9c5819" },
    },
    load: (f) => {
      const jb = parseCsv(f.jailbreak).map((r) => ({ text: clean(r.prompt), group: r.community_id ? `community:${r.community_id}` : clean(r.prompt) }));
      const attacks = new Set(jb.map((r) => r.text));
      return [
        ...jb.map((r) => ({ dataset: "jailbreakhub", text: r.text, label: 1 as const, source: "user" as const, group: r.group })),
        ...parseCsv(f.regular)
          .map((r) => clean(r.prompt))
          .filter((t) => !attacks.has(t))
          .map((t) => ({ dataset: "jailbreakhub", text: t, label: 0 as const, source: "user" as const, group: t })),
      ];
    },
  },
  {
    id: "tensortrust-hijacking",
    name: "Tensor Trust hijacking robustness v1",
    home: "https://github.com/HumanCompatibleAI/tensor-trust-data",
    licence: "No licence file in the data repository (the Tensor Trust code is BSD-2-Clause). Used for measurement only; not trained on or redistributed.",
    note: "Human-written attacks from the Tensor Trust game that tried to make a model say 'Access Granted' against its instructions. Attacks only, so only recall is defined.",
    files: { data: { url: `${GH}/HumanCompatibleAI/tensor-trust-data/${TENSOR_TRUST}/benchmarks/hijacking-robustness/v1/hijacking_robustness_dataset.jsonl`, sha256: "2ad3c2343bbf43cb1924f3ec5d6f830864ce3c879e9832b01d93a991e7e2e680" } },
    load: (f) => jsonl(f.data).map((r) => ({ dataset: "tensortrust-hijacking", text: clean(String(r.attack)), label: 1, source: "user", group: clean(String(r.attack)) })),
  },
  {
    id: "tensortrust-extraction",
    name: "Tensor Trust extraction robustness v1",
    home: "https://github.com/HumanCompatibleAI/tensor-trust-data",
    licence: "No licence file in the data repository (the Tensor Trust code is BSD-2-Clause). Used for measurement only; not trained on or redistributed.",
    note: "Human-written attacks from the Tensor Trust game that tried to get the model to reveal its hidden instructions. Attacks only, so only recall is defined.",
    files: { data: { url: `${GH}/HumanCompatibleAI/tensor-trust-data/${TENSOR_TRUST}/benchmarks/extraction-robustness/v1/extraction_robustness_dataset.jsonl`, sha256: "4090f9f57b6df69cc32d7669ac991e3fd53e6e2bb616a5e6f45dac79c183ee4c" } },
    load: (f) => jsonl(f.data).map((r) => ({ dataset: "tensortrust-extraction", text: clean(String(r.attack)), label: 1, source: "user", group: clean(String(r.attack)) })),
  },
  {
    id: "alpaca",
    name: "Stanford Alpaca instructions",
    home: "https://github.com/tatsu-lab/stanford_alpaca",
    licence: "CC BY-NC 4.0 (data). Used for measurement only; not trained on or redistributed.",
    note: "52,002 everyday instructions (write, explain, classify, code). All benign, so only the false-positive rate is defined. Instruction and input are joined the way an app would send them.",
    files: { data: { url: `${GH}/tatsu-lab/stanford_alpaca/${ALPACA}/alpaca_data.json`, sha256: "2eddafc6b977608d778aaab8dfc7e50e547b3af9826dfb9e909d9fc362e4a419" } },
    load: (f) =>
      (JSON.parse(f.data) as { instruction: string; input: string }[]).map((r) => {
        const text = clean(r.input ? `${r.instruction}\n\n${r.input}` : r.instruction);
        return { dataset: "alpaca", text, label: 0, source: "user", group: text };
      }),
  },
  {
    id: "bipia-context",
    name: "BIPIA email and table contexts",
    home: "https://github.com/microsoft/BIPIA",
    licence: "MIT",
    note: "Real emails and tables that BIPIA uses as retrieved documents, without any attack inserted. Scanned as documents (source: context), where the stricter document-only rules apply. All benign.",
    files: {
      email: { url: `${GH}/microsoft/BIPIA/${BIPIA}/benchmark/email/test.jsonl`, sha256: "217b403faaa1d0cb12c24892bea39f4a0b9e2819919ac7e2b902006e28278cdb" },
      table: { url: `${GH}/microsoft/BIPIA/${BIPIA}/benchmark/table/test.jsonl`, sha256: "3d5eaab192b80bada762e3cd7655583a14e5888ba8b845a01f0434e4ccc4291e" },
    },
    load: (f) => [...jsonl(f.email), ...jsonl(f.table)].map((r) => ({ dataset: "bipia-context", text: clean(String(r.context)), label: 0, source: "context", group: clean(String(r.context)) })),
  },
];

/**
 * Used only to train the classifier, never measured: everyday instructions with a licence that
 * allows it, so the model stops mistaking any instruction for an attack.
 */
export const SELF_INSTRUCT_DATA: Dataset = {
  id: "self-instruct",
  name: "Self-Instruct 82K instructions",
  home: "https://github.com/yizhongw/self-instruct",
  licence: "Apache-2.0",
  note: "Model-generated everyday instructions (the method Alpaca later copied). Training only. Any instruction that also appears in Alpaca is removed first.",
  files: { data: { url: `${GH}/yizhongw/self-instruct/${SELF_INSTRUCT}/data/gpt3_generations/batch_221203/all_instances_82K.jsonl`, sha256: "d9223a1ce9efb36566100a03d569252becab4592e79c12f07d7e1627d174d75a" } },
  load: (f) =>
    jsonl(f.data).map((r) => {
      const text = clean(r.input ? `${r.instruction}\n\n${r.input}` : String(r.instruction));
      return { dataset: "self-instruct", text, label: 0, source: "user", group: clean(String(r.instruction)).toLowerCase() };
    }),
};

const CACHE = resolve(process.cwd(), ".cache/bench");

export type LoadResult = { dataset: Dataset; rows: BenchRow[] } | { dataset: Dataset; error: string };

/** Downloads (or reads from the cache) and checks every file of a dataset. */
export async function loadDataset(d: Dataset): Promise<LoadResult> {
  mkdirSync(CACHE, { recursive: true });
  const files: Record<string, string> = {};
  for (const [key, f] of Object.entries(d.files)) {
    const path = resolve(CACHE, `${d.id}-${key}`);
    let buf: Buffer;
    if (existsSync(path)) buf = readFileSync(path);
    else {
      try {
        const res = await fetch(f.url, { signal: AbortSignal.timeout(120_000) });
        if (!res.ok) return { dataset: d, error: `HTTP ${res.status} for ${f.url}` };
        buf = Buffer.from(await res.arrayBuffer());
      } catch (e) {
        return { dataset: d, error: `Could not download ${f.url}: ${(e as Error).cause ?? (e as Error).message}` };
      }
    }
    const sha = createHash("sha256").update(buf).digest("hex");
    if (sha !== f.sha256) return { dataset: d, error: `Checksum mismatch for ${f.url} (got ${sha})` };
    if (!existsSync(path)) writeFileSync(path, buf);
    files[key] = buf.toString("utf8");
  }
  // Exact duplicates are counted once.
  const seen = new Set<string>();
  const rows = d.load(files).filter((r) => r.text && !seen.has(`${r.label}:${r.text}`) && (seen.add(`${r.label}:${r.text}`), true));
  return { dataset: d, rows };
}

function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** A fixed half of every dataset is the test split; the other half (dev) is the only part used for tuning. */
export const splitOf = (r: BenchRow): Split => (fnv1a(`airlock-split-v1:${r.dataset}:${r.group}`) % 2 === 0 ? "test" : "dev");
