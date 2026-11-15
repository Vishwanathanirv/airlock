/**
 * A small learned detector for paraphrased injections the rules don't list. Logistic regression
 * on hashed features: words, word pairs and character 3-5-grams of the unmasked text. It is
 * tiny (a few hundred KB), runs in microseconds, works in the browser, and every score can be
 * explained by the n-grams that pushed it up.
 */

export const DIMS = 1 << 16;

function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export type Features = Map<number, number>;

/** Feature id → the n-grams that produced it, kept only when explaining a score. */
export function featurize(text: string, keep?: Map<number, string>): Features {
  const f: Features = new Map();
  const add = (gram: string, w = 1) => {
    const i = fnv1a(gram) % DIMS;
    f.set(i, (f.get(i) ?? 0) + w);
    keep?.set(i, gram);
  };
  const words = text.match(/[a-z0-9']+/g) ?? [];
  for (let i = 0; i < words.length; i++) {
    add(`w:${words[i]}`);
    if (i + 1 < words.length) add(`b:${words[i]} ${words[i + 1]}`, 1.5);
  }
  for (const w of words) {
    const s = ` ${w} `;
    for (let n = 3; n <= 5; n++) for (let i = 0; i + n <= s.length; i++) add(`c:${s.slice(i, i + n)}`, 0.5);
  }
  // Sublinear term frequency, then unit length, so long documents don't score high just for being long.
  let norm = 0;
  for (const [k, v] of f) {
    const t = 1 + Math.log(v);
    f.set(k, t);
    norm += t * t;
  }
  norm = Math.sqrt(norm) || 1;
  for (const [k, v] of f) f.set(k, v / norm);
  return f;
}

export type Model = { dims: number; bias: number; w: Float32Array };

export const sigmoid = (z: number) => 1 / (1 + Math.exp(-z));

export function predict(m: Model, f: Features): number {
  let z = m.bias;
  for (const [k, v] of f) z += m.w[k] * v;
  return sigmoid(z);
}

/** The n-grams that pushed this text's score up the most. */
export function explain(m: Model, text: string, n = 5): { gram: string; weight: number }[] {
  const names = new Map<number, string>();
  const f = featurize(text, names);
  return [...f]
    .map(([k, v]) => ({ gram: names.get(k)!.slice(2), weight: m.w[k] * v }))
    .filter((x) => x.weight > 0)
    .sort((a, b) => b.weight - a.weight)
    .slice(0, n);
}

/**
 * Trains with AdaGrad on the log loss, with L2 regularisation and class weights so the
 * smaller class isn't drowned out.
 */
export function train(rows: { text: string; label: 0 | 1 }[], opts: { epochs?: number; lr?: number; l2?: number; seed?: number } = {}): Model {
  const { epochs = 12, lr = 0.5, l2 = 1e-5, seed = 7 } = opts;
  const X = rows.map((r) => featurize(r.text));
  const y = rows.map((r) => r.label);
  const pos = y.filter((v) => v === 1).length;
  const cw = [rows.length / (2 * Math.max(1, rows.length - pos)), rows.length / (2 * Math.max(1, pos))];
  const w = new Float32Array(DIMS);
  const g2 = new Float32Array(DIMS).fill(1e-8);
  let bias = 0;
  let b2 = 1e-8;
  let s = seed;
  const rand = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
  const order = rows.map((_, i) => i);
  for (let e = 0; e < epochs; e++) {
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }
    for (const i of order) {
      const p = predict({ dims: DIMS, bias, w }, X[i]);
      const g = (p - y[i]) * cw[y[i]];
      for (const [k, v] of X[i]) {
        const gk = g * v + l2 * w[k];
        g2[k] += gk * gk;
        w[k] -= (lr / Math.sqrt(g2[k])) * gk;
      }
      b2 += g * g;
      bias -= (lr / Math.sqrt(b2)) * g;
    }
  }
  return { dims: DIMS, bias, w };
}

/** Compact JSON: only the weights that matter, rounded. */
export function serialize(m: Model): { dims: number; bias: number; idx: number[]; val: number[] } {
  const idx: number[] = [];
  const val: number[] = [];
  m.w.forEach((v, i) => {
    if (Math.abs(v) >= 1e-3) {
      idx.push(i);
      val.push(Math.round(v * 1e4) / 1e4);
    }
  });
  return { dims: m.dims, bias: Math.round(m.bias * 1e4) / 1e4, idx, val };
}

export function deserialize(j: { dims: number; bias: number; idx: number[]; val: number[] }): Model {
  const w = new Float32Array(j.dims);
  j.idx.forEach((k, i) => (w[k] = j.val[i]));
  return { dims: j.dims, bias: j.bias, w };
}
