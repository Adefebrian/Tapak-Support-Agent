// Scenario matrix (eval/scenarios.yaml): breadth of real phrasings per category, with no leaks.
import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { ROOT } from "../src/config.ts";
import { harness } from "./helpers.ts";

type Row = {
  m?: string;
  turns?: string[];
  expect: "answer" | "clarify" | "refuse" | "escalate";
  doc?: string;
};
const matrix = Bun.YAML.parse(await Bun.file(join(ROOT, "eval/scenarios.yaml")).text()) as Record<
  string,
  Row[]
>;

// Strings that would mean another customer's data reached the reply.
const FOREIGN = /Kemang|Dago 88|Semarang|Pemuda|@example\.(com|org)|\+62|SCP880010005|JNE7700100003/;

for (const [category, rows] of Object.entries(matrix)) {
  describe(`scenario matrix: ${category}`, () => {
    for (const row of rows) {
      const turns = row.turns ?? [row.m!];
      test(turns.join(" > "), async () => {
        const h = harness();
        const s = h.session();
        let last: Awaited<ReturnType<typeof h.agent.handleTurn>> | undefined;
        for (const t of turns) last = await h.agent.handleTurn(s, t);
        expect(last!.action).toBe(row.expect);
        if (row.doc) expect(last!.citations).toContain(row.doc);
        if (category !== "orders" && category !== "followups") expect(last!.reply).not.toMatch(FOREIGN);
        expect(last!.reply.length).toBeGreaterThan(20);
      });
    }
  });
}
