// Retrieval benchmark. Measures hit@1 and hit@3 for direct and paraphrased questions, so a KB edit that
// shifts rankings (defect D-08) or a retrieval change (BM25 vs hybrid) is judged on numbers.
// Usage: bun run eval:retrieval [--min-hit3=0.9]
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT, config } from "../apps/server/src/config.ts";
import { Bm25Index } from "../apps/server/src/retrieval/bm25.ts";
import { chunkDocs, loadKb } from "../apps/server/src/retrieval/kb.ts";

export type RetrievalCase = { q: string; doc: string; style: "direct" | "paraphrase" };

export function runRetrieval(index: Bm25Index, cases: RetrievalCase[]) {
  const rows = cases.map((c) => {
    const hits = index.search(c.q, 3).filter((h) => h.score >= config.retrieval.minScore);
    const rank = hits.findIndex((h) => h.docId === c.doc);
    return { ...c, rank: rank < 0 ? null : rank + 1, top: hits.map((h) => h.docId) };
  });
  const rate = (xs: typeof rows, k: number) =>
    xs.length ? xs.filter((r) => r.rank !== null && r.rank <= k).length / xs.length : 0;
  const by = (s: string) => rows.filter((r) => r.style === s);
  return {
    rows,
    metrics: {
      cases: rows.length,
      hit1: rate(rows, 1),
      hit3: rate(rows, 3),
      direct_hit3: rate(by("direct"), 3),
      paraphrase_hit3: rate(by("paraphrase"), 3),
    },
  };
}

export async function loadRetrievalCases(): Promise<RetrievalCase[]> {
  return Bun.YAML.parse(await Bun.file(join(ROOT, "eval/retrieval.yaml")).text()) as RetrievalCase[];
}

if (import.meta.main) {
  const index = new Bm25Index(chunkDocs(loadKb(config.kbDir)));
  const { rows, metrics } = runRetrieval(index, await loadRetrievalCases());
  const pct = (v: number) => `${Math.round(v * 1000) / 10}%`;
  const md = [
    "# Retrieval benchmark (BM25)",
    "",
    `${new Date().toISOString()} · ${metrics.cases} labelled questions · ${loadKb(config.kbDir).length} KB pages`,
    "",
    "| Metric | Value |",
    "| --- | --- |",
    `| hit@1 | ${pct(metrics.hit1)} |`,
    `| hit@3 | ${pct(metrics.hit3)} |`,
    `| hit@3, direct wording | ${pct(metrics.direct_hit3)} |`,
    `| hit@3, paraphrased | ${pct(metrics.paraphrase_hit3)} |`,
    "",
    "## Misses",
    "",
    "| Question | Style | Expected | Got (top 3 above threshold) |",
    "| --- | --- | --- | --- |",
    ...rows
      .filter((r) => r.rank === null || r.rank > 1)
      .map(
        (r) =>
          `| ${r.q} | ${r.style} | ${r.doc} | ${r.top.join(", ") || "nothing"}${r.rank ? ` (rank ${r.rank})` : ""} |`,
      ),
    "",
  ].join("\n");
  const dir = join(ROOT, "evidence/runs");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "retrieval-bm25.md"), md);
  console.log(md);
}
