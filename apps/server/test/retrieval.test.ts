// Floor for the retrieval benchmark (eval/retrieval.yaml). Adding or editing a KB page that pushes the
// right page out of the top 3 for a direct question fails here, as D-08 would have.
import { expect, test } from "bun:test";
import { loadRetrievalCases, runRetrieval } from "../../../eval/retrieval.ts";
import { index, kb } from "./helpers.ts";

test("D-08: retrieval floor holds after KB changes", async () => {
  const { metrics, rows } = runRetrieval(index, await loadRetrievalCases());
  const missedDirect = rows
    .filter((r) => r.style === "direct" && (r.rank === null || r.rank > 3))
    .map((r) => r.q);
  expect(missedDirect.length).toBeLessThanOrEqual(1);
  expect(metrics.hit3).toBeGreaterThanOrEqual(0.8);
});

test("every current KB page offers follow-up questions", () => {
  const missing = kb.filter((d) => d.status === "current" && d.asks.length === 0).map((d) => d.id);
  expect(missing).toEqual([]);
  expect(new Set(kb.map((d) => d.id)).size).toBe(kb.length);
});
