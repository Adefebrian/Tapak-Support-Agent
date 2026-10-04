import { seedDb } from "../../../data/seed.ts";
import { Agent, createSession } from "../src/agent/loop.ts";
import { config } from "../src/config.ts";
import { openDb } from "../src/db.ts";
import { setLogSilent } from "../src/observability/logger.ts";
import { NoopProvider } from "../src/providers/decision/providers.ts";
import type { DecisionProvider } from "../src/providers/decision/types.ts";
import { MockLlm } from "../src/providers/llm/mock.ts";
import type { LLMProvider } from "../src/providers/llm/types.ts";
import { Bm25Index } from "../src/retrieval/bm25.ts";
import { chunkDocs, loadKb } from "../src/retrieval/kb.ts";

setLogSilent(true);

export const index = new Bm25Index(chunkDocs(loadKb(config.kbDir)));

export function harness(opts: { llm?: LLMProvider; decision?: DecisionProvider } = {}) {
  const db = openDb(":memory:");
  seedDb(db);
  const deps = { db, index, llm: opts.llm ?? new MockLlm(), decision: opts.decision ?? new NoopProvider() };
  const agent = new Agent(deps);
  const session = () => createSession(db);
  return { db, deps, agent, session };
}

export function final(o: Record<string, unknown>): string {
  return JSON.stringify({ type: "final", citations: [], confidence: 0.9, clarification_fields: [], ...o });
}
