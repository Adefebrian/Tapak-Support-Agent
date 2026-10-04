import type { Database } from "bun:sqlite";
import { type Context, Hono } from "hono";
import { cors } from "hono/cors";
import { secureHeaders } from "hono/secure-headers";
import { streamSSE } from "hono/streaming";
import { z } from "zod";
import { Agent, createSession, sessionExists } from "../agent/loop.ts";
import { MessageResponseSchema } from "../agent/schema.ts";
import { config } from "../config.ts";
import { log } from "../observability/logger.ts";
import { newTraceId, readTraces } from "../observability/trace.ts";
import type { DecisionProvider } from "../providers/decision/types.ts";
import type { LLMProvider } from "../providers/llm/types.ts";
import type { Bm25Index } from "../retrieval/bm25.ts";

const SessionId = z.string().regex(/^ses_[a-f0-9]{20}$/);
const MessageBody = z.object({ message: z.string().trim().min(1).max(config.limits.maxMessageChars) });
const EscalationPatch = z.object({ status: z.enum(["open", "in_progress", "resolved"]) });

// Sliding one-minute window per session. In-memory is enough for a single-instance deployment.
export class RateLimiter {
  private readonly hits = new Map<string, number[]>();
  constructor(
    private readonly perMinute: number,
    private readonly now: () => number = Date.now,
  ) {}
  allow(key: string): boolean {
    const t = this.now();
    const recent = (this.hits.get(key) ?? []).filter((x) => t - x < 60_000);
    if (recent.length >= this.perMinute) {
      this.hits.set(key, recent);
      return false;
    }
    recent.push(t);
    this.hits.set(key, recent);
    return true;
  }
}

export type AppDeps = {
  db: Database;
  index: Bm25Index;
  llm: LLMProvider;
  decision: DecisionProvider;
  rateLimiter?: RateLimiter;
};

const TAURI_ORIGINS = ["tauri://localhost", "http://tauri.localhost", "https://tauri.localhost"];

export function createApp(deps: AppDeps) {
  const agent = new Agent(deps);
  const limiter = deps.rateLimiter ?? new RateLimiter(config.limits.ratePerMinute);
  const allowed = new Set([...config.corsOrigins, ...TAURI_ORIGINS]);
  const app = new Hono<{ Variables: { traceId: string } }>();

  app.use("*", secureHeaders());
  app.use(
    "/api/*",
    cors({
      origin: (origin) => (allowed.has(origin) ? origin : null),
      allowMethods: ["GET", "POST", "PATCH"],
      allowHeaders: ["Content-Type"],
      exposeHeaders: ["x-trace-id"],
    }),
  );
  // Every API response carries a trace id; message turns override it with the turn's own trace id.
  app.use("/api/*", async (c, next) => {
    c.set("traceId", newTraceId());
    await next();
    if (!c.res.headers.get("x-trace-id")) c.res.headers.set("x-trace-id", c.get("traceId"));
  });

  const api = new Hono<{ Variables: { traceId: string } }>();

  api.get("/health", (c) => {
    let db = "ok";
    try {
      deps.db.query("SELECT 1").get();
    } catch {
      db = "error";
    }
    return c.json({
      status: db === "ok" ? "ok" : "degraded",
      db,
      llm: `${deps.llm.name}:${deps.llm.model}`,
      jev: deps.decision.name,
    });
  });

  api.post("/sessions", (c) => c.json({ session_id: createSession(deps.db) }, 201));

  // Shared validation for both the JSON and the streaming endpoint.
  async function readTurn(c: Context): Promise<{ id: string; message: string } | Response> {
    const id = SessionId.safeParse(c.req.param("id"));
    if (!id.success || !sessionExists(deps.db, id.data)) return c.json({ error: "session_not_found" }, 404);
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "invalid_json" }, 400);
    }
    const parsed = MessageBody.safeParse(body);
    if (!parsed.success) {
      const tooLong = parsed.error.issues.some((i) => i.code === "too_big");
      return c.json(
        { error: tooLong ? "message_too_long" : "invalid_message", max_chars: config.limits.maxMessageChars },
        tooLong ? 413 : 400,
      );
    }
    if (!limiter.allow(id.data)) return c.json({ error: "rate_limited", retry_after_s: 60 }, 429);
    return { id: id.data, message: parsed.data.message };
  }

  api.post("/sessions/:id/messages", async (c) => {
    const t = await readTurn(c);
    if (t instanceof Response) return t;
    try {
      const res = MessageResponseSchema.parse(await agent.handleTurn(t.id, t.message));
      c.header("x-trace-id", res.trace_id);
      return c.json(res);
    } catch (e) {
      log("error", "turn_failed", { session_id: t.id, error: String(e) });
      return c.json({ error: "internal_error", trace_id: c.get("traceId") }, 500);
    }
  });

  // F-20: same turn, streamed. Each trace stage is sent as it happens ("stage"), then the reply ("result").
  api.post("/sessions/:id/messages/stream", async (c) => {
    const t = await readTurn(c);
    if (t instanceof Response) return t;
    return streamSSE(c, async (stream) => {
      const pending: Promise<void>[] = [];
      try {
        const res = MessageResponseSchema.parse(
          await agent.handleTurn(t.id, t.message, (e) => {
            pending.push(stream.writeSSE({ event: "stage", data: JSON.stringify(e) }));
          }),
        );
        await Promise.all(pending);
        await stream.writeSSE({ event: "result", data: JSON.stringify(res) });
      } catch (e) {
        log("error", "turn_failed", { session_id: t.id, error: String(e) });
        await stream.writeSSE({ event: "error", data: JSON.stringify({ error: "internal_error" }) });
      }
    });
  });

  api.get("/sessions/:id/messages", (c) => {
    const id = SessionId.safeParse(c.req.param("id"));
    if (!id.success || !sessionExists(deps.db, id.data)) return c.json({ error: "session_not_found" }, 404);
    const rows = deps.db
      .query(
        "SELECT role, content_redacted AS content, action, meta_json, created_at FROM messages WHERE session_id = ? ORDER BY id",
      )
      .all(id.data) as {
      role: string;
      content: string;
      action: string | null;
      meta_json: string | null;
      created_at: string;
    }[];
    return c.json({
      messages: rows.map(({ meta_json, ...r }) => ({ ...r, meta: meta_json ? JSON.parse(meta_json) : null })),
    });
  });

  api.get("/sessions", (c) => {
    const rows = deps.db
      .query(
        `SELECT s.id, s.created_at, COUNT(m.id) AS messages FROM sessions s LEFT JOIN messages m ON m.session_id = s.id
         GROUP BY s.id HAVING messages > 0 ORDER BY s.created_at DESC LIMIT 50`,
      )
      .all();
    return c.json({ sessions: rows });
  });

  api.get("/escalations", (c) => {
    const status = c.req.query("status");
    const rows = status
      ? deps.db.query("SELECT * FROM escalations WHERE status = ? ORDER BY created_at DESC").all(status)
      : deps.db
          .query(
            "SELECT * FROM escalations ORDER BY CASE status WHEN 'resolved' THEN 1 ELSE 0 END, CASE priority WHEN 'high' THEN 0 ELSE 1 END, created_at DESC",
          )
          .all();
    return c.json({ escalations: rows });
  });

  api.patch("/escalations/:id", async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "invalid_json" }, 400);
    }
    const p = EscalationPatch.safeParse(body);
    if (!p.success) return c.json({ error: "invalid_status" }, 400);
    const r = deps.db
      .query("UPDATE escalations SET status = ? WHERE id = ?")
      .run(p.data.status, c.req.param("id"));
    if (r.changes === 0) return c.json({ error: "not_found" }, 404);
    return c.json(deps.db.query("SELECT * FROM escalations WHERE id = ?").get(c.req.param("id")));
  });

  api.get("/traces/:session_id", (c) => {
    const id = SessionId.safeParse(c.req.param("session_id"));
    if (!id.success || !sessionExists(deps.db, id.data)) return c.json({ error: "session_not_found" }, 404);
    return c.json({ session_id: id.data, events: readTraces(deps.db, id.data) });
  });

  // Metrics derived from traces only, so they can be recomputed for any past period.
  api.get("/metrics", (c) => {
    const q = <T>(sql: string) => deps.db.query(sql).all() as T[];
    const turns = q<{ payload_json: string }>("SELECT payload_json FROM traces WHERE stage = 'output'");
    const actions: Record<string, number> = {};
    const latencies: number[] = [];
    for (const t of turns) {
      const p = JSON.parse(t.payload_json) as { action: string; latency_total_ms: number };
      actions[p.action] = (actions[p.action] ?? 0) + 1;
      latencies.push(p.latency_total_ms);
    }
    const pctOf = (xs: number[], p: number) => {
      const s = [...xs].sort((a, b) => a - b);
      return s.length ? (s[Math.min(s.length - 1, Math.floor(p * s.length))] ?? 0) : 0;
    };
    const rate = (n: number) => (turns.length ? n / turns.length : 0);

    const stageRows = q<{ stage: string; latency_ms: number }>(
      "SELECT stage, latency_ms FROM traces WHERE stage IN ('decision.jev','retrieval','tool_call','llm')",
    );
    const byStage: Record<string, number[]> = {};
    for (const r of stageRows) (byStage[r.stage] ??= []).push(r.latency_ms);
    const stage_latency_ms = Object.fromEntries(
      Object.entries(byStage).map(([k, v]) => [k, { p50: pctOf(v, 0.5), p95: pctOf(v, 0.95), n: v.length }]),
    );

    const llm = q<{ valid: number; tin: number; tout: number; session_id: string }>(
      "SELECT json_extract(payload_json,'$.schema_valid') AS valid, json_extract(payload_json,'$.tokens_in') AS tin, json_extract(payload_json,'$.tokens_out') AS tout, session_id FROM traces WHERE stage = 'llm'",
    );
    const sessionsWithLlm = new Set(llm.map((r) => r.session_id)).size;
    const tokens = llm.reduce((s, r) => s + (r.tin ?? 0) + (r.tout ?? 0), 0);

    const guards = q<{ rule: string; n: number }>(
      "SELECT json_extract(payload_json, '$.rule') AS rule, COUNT(*) AS n FROM traces WHERE stage = 'guardrail' GROUP BY rule ORDER BY n DESC",
    );
    const retrieval = q<{ empty: number }>(
      "SELECT json_extract(payload_json,'$.empty') AS empty FROM traces WHERE stage = 'retrieval'",
    );
    const jev = q<{ disagreement: number; status: string }>(
      "SELECT json_extract(payload_json,'$.disagreement') AS disagreement, json_extract(payload_json,'$.status') AS status FROM traces WHERE stage = 'decision.jev' AND json_extract(payload_json,'$.type') = 'intent+escalation'",
    );
    const jevOk = jev.filter((r) => r.status === "ok");
    const jevCalls = jev.filter((r) => r.status !== "disabled");

    return c.json({
      turns: turns.length,
      actions,
      escalation_rate: rate(actions.escalate ?? 0),
      clarify_rate: rate(actions.clarify ?? 0),
      latency_ms: { p50: pctOf(latencies, 0.5), p95: pctOf(latencies, 0.95) },
      stage_latency_ms,
      guardrails: guards.map((g) => ({ ...g, per_turn: rate(g.n) })),
      llm_schema_failure_rate: llm.length ? llm.filter((r) => !r.valid).length / llm.length : null,
      retrieval_empty_rate: retrieval.length
        ? retrieval.filter((r) => r.empty).length / retrieval.length
        : null,
      tokens_per_session: sessionsWithLlm ? Math.round(tokens / sessionsWithLlm) : 0,
      jev_disagreement_rate: jevOk.length ? jevOk.filter((r) => r.disagreement).length / jevOk.length : null,
      jev_timeout_rate: jevCalls.length
        ? jevCalls.filter((r) => r.status === "timeout").length / jevCalls.length
        : null,
    });
  });

  app.route("/api/v1", api);
  return app;
}
