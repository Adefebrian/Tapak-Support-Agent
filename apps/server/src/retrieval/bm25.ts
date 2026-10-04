import type { Chunk } from "./kb.ts";

const STOP = new Set(
  "a an the is are was were be been am i you your my me we our it its of to in on for at by with and or but if then so do does did can could would should will what how when where which who why this that these those there here have has had not no yes please hi hello thanks thank".split(
    " ",
  ),
);

// Small synonym map so customer phrasing reaches policy vocabulary.
const SYNONYMS: Record<string, string> = {
  refund: "return",
  money: "refund",
  send: "ship",
  deliver: "ship",
  delivery: "ship",
  arrive: "ship",
  courier: "carrier",
  track: "tracking",
  exchange: "exchange",
  swap: "exchange",
  bigger: "size",
  smaller: "size",
  fit: "size",
  clean: "care",
  wash: "care",
  guarantee: "warranty",
  broken: "warranty",
  defect: "warranty",
  coupon: "voucher",
  promo: "voucher",
  discount: "voucher",
  pay: "payment",
  preorder: "pre-order",
  window: "day",
  long: "day",
  deadline: "day",
  wore: "worn",
  wear: "worn",
  used: "worn",
  outside: "outdoor",
  socks: "sock",
};

function stem(w: string): string {
  if (w.length > 5 && w.endsWith("ing")) return w.slice(0, -3);
  if (w.length > 4 && w.endsWith("ed")) return w.slice(0, -2);
  if (w.length > 3 && w.endsWith("s") && !w.endsWith("ss")) return w.slice(0, -1);
  return w;
}

export function tokenize(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.toLowerCase().match(/[a-z0-9-]+/g) ?? []) {
    if (STOP.has(raw) || raw.length < 2) continue;
    const s = stem(raw);
    out.push(s);
    const syn = SYNONYMS[s] ?? SYNONYMS[raw];
    if (syn && syn !== s) out.push(syn);
  }
  return out;
}

export type Hit = { chunkId: string; docId: string; title: string; text: string; score: number };

// Okapi BM25 over paragraph chunks. ~13 docs makes a vector store unnecessary.
export class Bm25Index {
  private readonly k1 = 1.4;
  private readonly b = 0.75;
  private readonly docs: { chunk: Chunk; tf: Map<string, number>; len: number }[];
  private readonly df = new Map<string, number>();
  private readonly avgLen: number;

  constructor(chunks: Chunk[]) {
    this.docs = chunks.map((chunk) => {
      // Title tokens count twice extra: a page titled "Return policy" should win "return" queries.
      const toks = [...tokenize(chunk.text), ...tokenize(chunk.title), ...tokenize(chunk.title)];
      const tf = new Map<string, number>();
      for (const t of toks) tf.set(t, (tf.get(t) ?? 0) + 1);
      for (const t of tf.keys()) this.df.set(t, (this.df.get(t) ?? 0) + 1);
      return { chunk, tf, len: toks.length };
    });
    this.avgLen = this.docs.reduce((s, d) => s + d.len, 0) / Math.max(1, this.docs.length);
  }

  search(query: string, k: number): Hit[] {
    const q = [...new Set(tokenize(query))];
    const N = this.docs.length;
    const scored = this.docs.map((d) => {
      let score = 0;
      for (const t of q) {
        const f = d.tf.get(t);
        if (!f) continue;
        const n = this.df.get(t) ?? 0;
        const idf = Math.log(1 + (N - n + 0.5) / (n + 0.5));
        score += (idf * (f * (this.k1 + 1))) / (f + this.k1 * (1 - this.b + (this.b * d.len) / this.avgLen));
      }
      // Superseded pages stay searchable but rank below current policy (defect D-02).
      if (d.chunk.superseded) score *= 0.5;
      return {
        chunkId: d.chunk.chunkId,
        docId: d.chunk.docId,
        title: d.chunk.title,
        text: d.chunk.text,
        score: Math.round(score * 1000) / 1000,
      };
    });
    // Best chunk per document, so top-k is k distinct documents.
    const best = new Map<string, Hit>();
    for (const h of scored) {
      if (h.score <= 0) continue;
      const prev = best.get(h.docId);
      if (!prev || h.score > prev.score) best.set(h.docId, h);
    }
    return [...best.values()].sort((a, b) => b.score - a.score).slice(0, k);
  }
}
