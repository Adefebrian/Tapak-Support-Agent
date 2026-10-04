import type { Database } from "bun:sqlite";
import { z } from "zod";
import { config } from "../config.ts";
import { normalizeEmail, normalizeOrderId, type Priority } from "../policy/input.ts";
import type { Bm25Index, Hit } from "../retrieval/bm25.ts";

// The complete tool surface. There is deliberately no refund, cancel, address, or exchange tool:
// any action that moves money or changes an order can only become an escalation ticket.
export const TOOL_NAMES = ["search_kb", "get_order", "create_escalation", "request_clarification"] as const;
export type ToolName = (typeof TOOL_NAMES)[number];

export const ToolArgs = {
  search_kb: z.object({ query: z.string().min(1).max(300) }),
  get_order: z.object({ order_id: z.string().min(1).max(40), email: z.string().min(3).max(200) }),
  create_escalation: z.object({
    reason: z.string().min(1).max(200),
    priority: z.enum(["normal", "high"]),
    summary: z.string().min(1).max(1000),
  }),
  request_clarification: z.object({ missing_fields: z.array(z.string().min(1).max(40)).min(1).max(5) }),
} satisfies Record<ToolName, z.ZodTypeAny>;

export type ToolContext = {
  db: Database;
  index: Bm25Index;
  sessionId: string;
  // Every customer message in this session. get_order args must come from here, never from the model.
  customerText: string;
  retrieved: Map<string, Hit>;
};

export type ToolResult = { ok: boolean; data: Record<string, unknown> };

export function searchKb(ctx: ToolContext, query: string): ToolResult {
  const hits = ctx.index.search(query, config.retrieval.topK).filter((h) => h.score >= config.retrieval.minScore);
  for (const h of hits) ctx.retrieved.set(h.docId, h);
  return {
    ok: hits.length > 0,
    data: { results: hits.map((h) => ({ doc_id: h.docId, title: h.title, text: h.text, score: h.score })) },
  };
}

// One message for "no such order" and "email does not match": callers cannot enumerate orders.
export const NOT_VERIFIED = "not_verified";

export type OrderView = {
  order_id: string;
  status: string;
  eta: string | null;
  delivered_at: string | null;
  carrier: string | null;
  tracking_no: string | null;
  items: { name: string; size_eu: number; qty: number }[];
};

type SessionRow = { verified_order_id: string | null; verify_attempts: number };

export function getSession(db: Database, sessionId: string): SessionRow {
  const row = db.query("SELECT verified_order_id, verify_attempts FROM sessions WHERE id = ?").get(sessionId) as
    | SessionRow
    | null;
  if (!row) throw new Error("session not found");
  return row;
}

export function getOrder(ctx: ToolContext, rawOrderId: string, rawEmail: string): ToolResult {
  const orderId = normalizeOrderId(rawOrderId);
  const email = normalizeEmail(rawEmail);
  const session = getSession(ctx.db, ctx.sessionId);

  if (session.verify_attempts >= config.limits.maxVerifyAttempts) {
    return { ok: false, data: { error: "verify_locked" } };
  }

  // Provenance: both identifiers must have been typed by the customer in this session.
  const said = ctx.customerText.toUpperCase().replace(/TPK\s(\d{5})/g, "TPK-$1");
  const saidEmail = ctx.customerText.toLowerCase();
  if (!said.includes(orderId) || !saidEmail.includes(email)) {
    return { ok: false, data: { error: "args_not_from_customer" } };
  }

  const row = ctx.db
    .query(
      `SELECT o.id, o.status, o.eta, o.delivered_at, o.carrier, o.tracking_no, c.email
       FROM orders o JOIN customers c ON c.id = o.customer_id WHERE o.id = ?`,
    )
    .get(orderId) as
    | {
        id: string;
        status: string;
        eta: string | null;
        delivered_at: string | null;
        carrier: string | null;
        tracking_no: string | null;
        email: string;
      }
    | null;

  if (!row || normalizeEmail(row.email) !== email) {
    ctx.db.query("UPDATE sessions SET verify_attempts = verify_attempts + 1 WHERE id = ?").run(ctx.sessionId);
    const attempts = session.verify_attempts + 1;
    return { ok: false, data: { error: NOT_VERIFIED, attempts_left: config.limits.maxVerifyAttempts - attempts } };
  }

  ctx.db.query("UPDATE sessions SET verified_order_id = ? WHERE id = ?").run(row.id, ctx.sessionId);
  return { ok: true, data: { order: loadOrderView(ctx.db, row.id) } };
}

// Minimum fields only: never address, phone, email, name, or prices.
export function loadOrderView(db: Database, orderId: string): OrderView | null {
  const o = db
    .query("SELECT id, status, eta, delivered_at, carrier, tracking_no FROM orders WHERE id = ?")
    .get(orderId) as {
    id: string;
    status: string;
    eta: string | null;
    delivered_at: string | null;
    carrier: string | null;
    tracking_no: string | null;
  } | null;
  if (!o) return null;
  const items = db.query("SELECT name, size_eu, qty FROM order_items WHERE order_id = ?").all(orderId) as {
    name: string;
    size_eu: number;
    qty: number;
  }[];
  return {
    order_id: o.id,
    status: o.status,
    eta: o.eta,
    delivered_at: o.delivered_at,
    carrier: o.carrier,
    tracking_no: o.tracking_no,
    items,
  };
}

export function createEscalation(
  ctx: Pick<ToolContext, "db" | "sessionId">,
  reason: string,
  priority: Priority,
  summary: string,
): ToolResult {
  // One open ticket per session: re-escalating upgrades priority instead of spamming the queue.
  const open = ctx.db
    .query("SELECT id, priority FROM escalations WHERE session_id = ? AND status != 'resolved' ORDER BY created_at DESC")
    .get(ctx.sessionId) as { id: string; priority: Priority } | null;
  if (open) {
    if (priority === "high" && open.priority !== "high") {
      ctx.db.query("UPDATE escalations SET priority = 'high', reason = ? WHERE id = ?").run(reason, open.id);
    }
    return { ok: true, data: { escalation_id: open.id, reused: true } };
  }
  const id = `esc_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  ctx.db
    .query(
      "INSERT INTO escalations (id, session_id, reason, priority, summary, status, created_at) VALUES (?,?,?,?,?,'open',?)",
    )
    .run(id, ctx.sessionId, reason, priority, summary, new Date().toISOString());
  return { ok: true, data: { escalation_id: id, reused: false } };
}

export function requestClarification(missing: string[]): ToolResult {
  return { ok: true, data: { missing_fields: missing } };
}

export async function withTimeout<T>(p: Promise<T> | T, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.resolve(p),
      new Promise<never>((_, rej) => {
        timer = setTimeout(() => rej(new Error(`${label} timed out after ${ms}ms`)), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
