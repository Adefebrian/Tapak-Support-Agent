import type { Database } from "bun:sqlite";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { secureHeaders } from "hono/secure-headers";
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

  api.post("/sessions/:id/messages", async (c) => {
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

    try {
      const res = MessageResponseSchema.parse(await agent.handleTurn(id.data, parsed.data.message));
      c.header("x-trace-id", res.trace_id);
      return c.json(res);
    } catch (e) {
      log("error", "turn_failed", { session_id: id.data, error: String(e) });
      return c.json({ error: "internal_error", trace_id: c.get("traceId") }, 500);
    }
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

  api.get("/metrics", (c) => {
    const turns = deps.db
      .query("SELECT payload_json, latency_ms FROM traces WHERE stage = 'output'")
      .all() as { payload_json: string }[];
    const actions: Record<string, number> = {};
    const latencies: number[] = [];
    for (const t of turns) {
      const p = JSON.parse(t.payload_json) as { action: string; latency_total_ms: number };
      actions[p.action] = (actions[p.action] ?? 0) + 1;
      latencies.push(p.latency_total_ms);
    }
    latencies.sort((a, b) => a - b);
    const pct = (q: number) =>
      latencies.length ? latencies[Math.min(latencies.length - 1, Math.floor(q * latencies.length))] : 0;
    const guards = deps.db
      .query(
        "SELECT json_extract(payload_json, '$.rule') AS rule, COUNT(*) AS n FROM traces WHERE stage = 'guardrail' GROUP BY rule ORDER BY n DESC",
      )
      .all();
    const jev = deps.db
      .query(
        "SELECT SUM(CASE WHEN json_extract(payload_json,'$.disagreement') THEN 1 ELSE 0 END) AS disagree, COUNT(*) AS n FROM traces WHERE stage = 'decision.jev' AND json_extract(payload_json,'$.type') = 'intent+escalation' AND json_extract(payload_json,'$.status') = 'ok'",
      )
      .get() as { disagree: number | null; n: number };
    return c.json({
      turns: turns.length,
      actions,
      escalation_rate: turns.length ? (actions.escalate ?? 0) / turns.length : 0,
      latency_ms: { p50: pct(0.5), p95: pct(0.95) },
      guardrails: guards,
      jev_disagreement_rate: jev.n ? (jev.disagree ?? 0) / jev.n : null,
    });
  });

  app.route("/api/v1", api);
  return app;
}
