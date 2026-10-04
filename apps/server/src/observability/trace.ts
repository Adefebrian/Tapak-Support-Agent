import type { Database } from "bun:sqlite";
import { redactDeep } from "./redact.ts";

export type Stage = "input" | "decision.jev" | "retrieval" | "tool_call" | "llm" | "guardrail" | "output";

export type TraceEvent = {
  stage: Stage;
  payload: Record<string, unknown>;
  latency_ms: number;
  at: number;
};

export function newTraceId(): string {
  const t = Date.now().toString(36);
  const r = crypto.getRandomValues(new Uint8Array(6));
  return `tr_${t}${Array.from(r, (b) => b.toString(16).padStart(2, "0")).join("")}`;
}

// Collects stage events for one turn, then flushes them in one transaction.
export class TurnTrace {
  readonly events: TraceEvent[] = [];
  private readonly t0 = performance.now();

  constructor(
    readonly traceId: string,
    readonly sessionId: string,
    readonly turn: number,
    // Optional live listener (SSE). Receives the same redacted event that is stored.
    private readonly onEvent?: (e: TraceEvent & { trace_id: string; turn: number }) => void,
  ) {}

  add(stage: Stage, payload: Record<string, unknown>, latencyMs = 0): void {
    const e: TraceEvent = {
      stage,
      payload: redactDeep(payload),
      latency_ms: Math.round(latencyMs),
      at: Math.round(performance.now() - this.t0),
    };
    this.events.push(e);
    this.onEvent?.({ ...e, trace_id: this.traceId, turn: this.turn });
  }

  elapsed(): number {
    return Math.round(performance.now() - this.t0);
  }

  flush(db: Database): void {
    const stmt = db.prepare(
      "INSERT INTO traces (trace_id, session_id, turn, stage, payload_json, latency_ms, created_at) VALUES (?,?,?,?,?,?,?)",
    );
    const now = new Date().toISOString();
    db.transaction(() => {
      for (const e of this.events) {
        stmt.run(
          this.traceId,
          this.sessionId,
          this.turn,
          e.stage,
          JSON.stringify({ ...e.payload, at_ms: e.at }),
          e.latency_ms,
          now,
        );
      }
    })();
  }
}

export type TraceRow = {
  trace_id: string;
  turn: number;
  stage: Stage;
  payload: Record<string, unknown>;
  latency_ms: number;
  created_at: string;
};

export function readTraces(db: Database, sessionId: string): TraceRow[] {
  const rows = db
    .query(
      "SELECT trace_id, turn, stage, payload_json, latency_ms, created_at FROM traces WHERE session_id = ? ORDER BY turn, id",
    )
    .all(sessionId) as Array<Omit<TraceRow, "payload"> & { payload_json: string }>;
  return rows.map(({ payload_json, ...r }) => ({ ...r, payload: JSON.parse(payload_json) }));
}
