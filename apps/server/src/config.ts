import { resolve } from "node:path";

// Repo root, resolved from this file so scripts work from any cwd.
export const ROOT = resolve(import.meta.dir, "../../..");

function bool(v: string | undefined, fallback: boolean): boolean {
  if (v === undefined || v === "") return fallback;
  return v === "1" || v.toLowerCase() === "true";
}

export type LlmKind = "mock" | "openai" | "anthropic";
export type JevKind = "jev" | "mock" | "noop";

export const config = {
  port: Number(process.env.PORT ?? 8787),
  dbPath: resolve(ROOT, process.env.DB_PATH ?? "data/tapak.db"),
  kbDir: resolve(ROOT, "kb"),
  publicDir: resolve(ROOT, "apps/server/public"),
  llm: {
    provider: (process.env.LLM_PROVIDER ?? "mock") as LlmKind,
    openaiKey: process.env.OPENAI_API_KEY ?? "",
    openaiModel: process.env.OPENAI_MODEL ?? "gpt-4o-mini",
    anthropicKey: process.env.ANTHROPIC_API_KEY ?? "",
    anthropicModel: process.env.ANTHROPIC_MODEL ?? "claude-sonnet-5-5",
    timeoutMs: 20_000,
    retries: 1,
  },
  jev: {
    enabled: bool(process.env.JEV_ENABLED, false),
    provider: (process.env.JEV_PROVIDER ?? "mock") as JevKind,
    apiKey: process.env.JEV_API_KEY ?? "",
    timeoutMs: 2_000,
  },
  limits: {
    maxMessageChars: 2_000,
    historyTurns: 10,
    ratePerMinute: 20,
    maxVerifyAttempts: 3,
    toolTimeoutMs: 3_000,
    maxToolSteps: 4,
  },
  retrieval: {
    topK: 3,
    // Below this BM25 score a hit is treated as "no grounding found".
    minScore: 1.2,
  },
  groundednessThreshold: 0.7,
  escalationScoreThreshold: 0.6,
  corsOrigins: (process.env.CORS_ORIGINS ?? "http://localhost:8787")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
  promptVersion: "p-2026-10-04.1",
};
