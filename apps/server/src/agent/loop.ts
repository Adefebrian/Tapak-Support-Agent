import type { Database } from "bun:sqlite";
import { config } from "../config.ts";
import { log } from "../observability/logger.ts";
import { redact } from "../observability/redact.ts";
import { newTraceId, TurnTrace } from "../observability/trace.ts";
import {
  type Action,
  actionKind,
  analyzeInput,
  type InputAnalysis,
  type Intent,
  type Priority,
  riskierIntent,
} from "../policy/input.ts";
import { clarifyFinal, type GuardHit, guardOutput } from "../policy/output.ts";
import type { DecisionProvider, PreDecision } from "../providers/decision/types.ts";
import type { LLMProvider, LlmMessage } from "../providers/llm/types.ts";
import type { Bm25Index, Hit } from "../retrieval/bm25.ts";
import {
  createEscalation,
  getOrder,
  loadOrderView,
  NOT_VERIFIED,
  type OrderView,
  requestClarification,
  searchKb,
  type ToolContext,
  ToolArgs,
  withTimeout,
} from "../tools/index.ts";
import { ACTION_PHRASES, PROMPT_TEMPLATES as T, SYSTEM_PROMPT } from "./prompt.ts";
import { type Final, type MessageResponse, parseStep } from "./schema.ts";

export type AgentDeps = { db: Database; index: Bm25Index; llm: LLMProvider; decision: DecisionProvider };

type SessionState = {
  verified_order_id: string | null;
  verify_attempts: number;
  pending_order_id: string | null;
  pending_email: string | null;
};

type Outcome = {
  final: Final;
  escalate?: { reason: string; priority: Priority };
  templated: boolean;
};

export function createSession(db: Database): string {
  const id = `ses_${crypto.randomUUID().replace(/-/g, "").slice(0, 20)}`;
  db.query("INSERT INTO sessions (id, created_at) VALUES (?, ?)").run(id, new Date().toISOString());
  return id;
}

export function sessionExists(db: Database, id: string): boolean {
  return db.query("SELECT 1 FROM sessions WHERE id = ?").get(id) !== null;
}

function templated(reply: string, action: Action, fields: string[] = [], citations: string[] = []): Final {
  return { type: "final", reply, action, citations, confidence: 1, clarification_fields: fields };
}

export class Agent {
  constructor(private readonly deps: AgentDeps) {}

  async handleTurn(sessionId: string, message: string): Promise<MessageResponse> {
    const { db } = this.deps;
    const traceId = newTraceId();
    const turn =
      (db.query("SELECT COUNT(*) AS n FROM messages WHERE session_id = ? AND role = 'user'").get(sessionId) as { n: number })
        .n + 1;
    const trace = new TurnTrace(traceId, sessionId, turn);
    const guards: GuardHit[] = [];
    const session = db
      .query("SELECT verified_order_id, verify_attempts, pending_order_id, pending_email FROM sessions WHERE id = ?")
      .get(sessionId) as SessionState;

    // ---- input stage -------------------------------------------------------
    const a = analyzeInput(message);
    trace.add("input", {
      length: a.length,
      injection_flags: a.injectionFlags,
      rule_intent: a.intent,
      order_ids: a.orderIds,
      has_email: a.emails.length > 0,
      flags: {
        medical: a.medical,
        high_priority: a.highPriority,
        negative_tone: a.negativeTone,
        policy_exception: a.policyException,
      },
    });
    if (a.injectionFlags.length) guards.push({ rule: "injection_detected", effect: "stripped", detail: a.injectionFlags.join(",") });

    const candidates = {
      orderId: a.orderIds[0] ?? session.pending_order_id,
      email: a.emails[0] ?? session.pending_email,
    };

    // ---- decision layer (advisory, one-directional) -------------------------
    const history = this.history(sessionId);
    const pre = await this.deps.decision.pre({
      message,
      recentTurns: history.slice(-6).map((m) => `${m.role}: ${m.content}`).join("\n"),
      ruleIntent: a.intent,
      verified: session.verified_order_id !== null,
    });
    const jevIntent = pre.status === "ok" ? pre.intent : undefined;
    const intent: Intent = jevIntent ? riskierIntent(a.intent, jevIntent) : a.intent;
    trace.add(
      "decision.jev",
      {
        provider: this.deps.decision.name,
        type: "intent+escalation",
        status: pre.status,
        intent: pre.intent ?? null,
        escalation_score: pre.escalationScore ?? null,
        disagreement: jevIntent !== undefined && jevIntent !== a.intent,
        merged_intent: intent,
        error: pre.error ?? null,
      },
      pre.latencyMs,
    );

    // ---- route ----------------------------------------------------------------
    let outcome: Outcome;
    let llmLabel = "skipped";
    const ctx: ToolContext = {
      db,
      index: this.deps.index,
      sessionId,
      customerText: [message, session.pending_order_id ?? "", session.pending_email ?? ""].join("\n"),
      retrieved: new Map<string, Hit>(),
    };

    const forced = this.forcedRoute(message, a, intent, pre, session, candidates, guards);
    if (forced) {
      outcome = forced;
    } else {
      // Retrieval always runs before the model, so grounding is decided by code, not by the model's tool choice.
      const t0 = performance.now();
      const kb = searchKb(ctx, message);
      const results = kb.data.results as { doc_id: string; score: number }[];
      trace.add(
        "retrieval",
        { query: message, top_k: results.map((r) => ({ doc_id: r.doc_id, score: r.score })), empty: results.length === 0 },
        performance.now() - t0,
      );

      const needsKb = !(intent === "order_status" && (candidates.orderId || session.verified_order_id));
      if (needsKb && results.length === 0) {
        guards.push({ rule: "retrieval_empty", effect: "downgraded_to_clarify" });
        outcome = { final: templated(T.outOfKb, "clarify", ["details"]), templated: true };
      } else {
        llmLabel = `${this.deps.llm.name}:${this.deps.llm.model}`;
        outcome = await this.runModel(ctx, a, intent, candidates, session, history, message, trace, guards);
      }
    }

    // ---- output guard ---------------------------------------------------------
    let final = outcome.final;
    const verifiedId = (db.query("SELECT verified_order_id FROM sessions WHERE id = ?").get(sessionId) as SessionState)
      .verified_order_id;
    const verifiedOrder = verifiedId ? loadOrderView(db, verifiedId) : null;

    if (!outcome.templated) {
      const g = guardOutput({
        final,
        intent,
        retrievedDocIds: new Set(ctx.retrieved.keys()),
        verifiedOrderId: verifiedId,
        verifiedTracking: verifiedOrder?.tracking_no ?? null,
        customerText: ctx.customerText,
      });
      final = g.final;
      guards.push(...g.hits);

      // Groundedness check on policy answers (JEV advisory; fail closed when JEV is enabled but down).
      if (final.action === "answer" && final.citations.length) {
        const passages = final.citations.map((id) => ctx.retrieved.get(id)?.text ?? "");
        const gr = await this.deps.decision.groundedness(final.reply, passages);
        trace.add(
          "decision.jev",
          { provider: this.deps.decision.name, type: "groundedness", status: gr.status, score: gr.score ?? null, error: gr.error ?? null },
          gr.latencyMs,
        );
        if (gr.status === "timeout" || gr.status === "error") {
          guards.push({ rule: "jev_unavailable", effect: "escalated", detail: "groundedness" });
          final = templated(T.fallback, "escalate");
          outcome.escalate = { reason: "jev_unavailable", priority: "normal" };
        } else if (gr.status === "ok" && (gr.score ?? 0) < config.groundednessThreshold) {
          guards.push({ rule: "groundedness_low", effect: "downgraded_to_clarify", detail: String(gr.score) });
          final = clarifyFinal();
        }
      }

      // A lost parcel always needs a human claim, whatever the model said.
      if (verifiedOrder?.status === "lost" && final.action === "answer" && final.reply.includes(verifiedOrder.order_id)) {
        guards.push({ rule: "lost_parcel_claim", effect: "escalated" });
        final = { ...final, action: "escalate" };
        outcome.escalate = { reason: "lost_parcel", priority: "normal" };
      }
    } else if (/@|\+\d/.test(final.reply)) {
      // Templates are trusted, but still never echo contact details.
      final = { ...final, reply: redact(final.reply) };
    }

    // ---- escalation is created by code whenever the final action is escalate --
    let escalationId: string | null = null;
    if (final.action === "escalate") {
      const esc = outcome.escalate ?? { reason: "model_escalated", priority: "normal" as Priority };
      const summary = redact(
        `Intent: ${intent}. Last message: "${message.slice(0, 400)}". Verified order: ${verifiedId ?? "none"}. Guardrails: ${guards.map((g) => g.rule).join(", ") || "none"}.`,
      );
      const t0 = performance.now();
      const r = createEscalation(ctx, esc.reason, esc.priority, summary);
      escalationId = r.data.escalation_id as string;
      trace.add(
        "tool_call",
        { tool: "create_escalation", by: "code", args: { reason: esc.reason, priority: esc.priority }, result: r.data },
        performance.now() - t0,
      );
    }

    for (const g of guards) trace.add("guardrail", { rule: g.rule, effect: g.effect, detail: g.detail ?? null });

    // ---- persist ----------------------------------------------------------------
    this.persistPending(sessionId, candidates, verifiedId);
    const now = new Date().toISOString();
    const insert = db.query(
      "INSERT INTO messages (session_id, role, content_redacted, action, meta_json, created_at) VALUES (?,?,?,?,?,?)",
    );
    insert.run(sessionId, "user", redact(message), null, null, now);
    insert.run(
      sessionId,
      "assistant",
      redact(final.reply),
      final.action,
      JSON.stringify({ citations: final.citations, escalation_id: escalationId, trace_id: traceId }),
      now,
    );

    const latency = trace.elapsed();
    trace.add("output", { action: final.action, citations: final.citations, escalation_id: escalationId, latency_total_ms: latency });
    trace.flush(db);
    log("info", "turn", { trace_id: traceId, session_id: sessionId, turn, intent, action: final.action, latency_ms: latency });

    return {
      reply: final.reply,
      action: final.action,
      citations: final.citations,
      escalation_id: escalationId,
      clarification_fields: final.action === "clarify" ? final.clarification_fields : [],
      trace_id: traceId,
      meta: {
        latency_ms: latency,
        guardrails_triggered: [...new Set(guards.map((g) => g.rule))],
        intent,
        llm: llmLabel,
        jev: `${this.deps.decision.name}:${pre.status}`,
      },
    };
  }

  // Deterministic routes that never reach the model. Order matters: most conservative first.
  private forcedRoute(
    message: string,
    a: InputAnalysis,
    intent: Intent,
    pre: PreDecision,
    session: SessionState,
    candidates: { orderId: string | null; email: string | null },
    guards: GuardHit[],
  ): Outcome | null {
    if (pre.status === "timeout" || pre.status === "error") {
      guards.push({ rule: "jev_unavailable", effect: "escalated", detail: pre.status });
      return { final: templated(T.fallback, "escalate"), escalate: { reason: "jev_unavailable", priority: "normal" }, templated: true };
    }
    if (intent === "complaint" || a.highPriority) {
      guards.push({ rule: "high_priority_keywords", effect: "escalated" });
      return { final: templated(T.complaint, "escalate"), escalate: { reason: "complaint_or_dispute", priority: "high" }, templated: true };
    }
    if (intent === "action_request") {
      const k = actionKind(message);
      const priority: Priority = a.negativeTone ? "high" : "normal";
      guards.push({ rule: "action_not_automatable", effect: "escalated", detail: k });
      return {
        final: templated(T.escalated(ACTION_PHRASES[k] ?? ACTION_PHRASES.other!, priority), "escalate"),
        escalate: { reason: `action_request:${k}`, priority },
        templated: true,
      };
    }
    if (a.medical || a.legalSafety) {
      guards.push({ rule: "medical_or_safety_advice", effect: "blocked" });
      return { final: templated(T.medical, "refuse"), templated: true };
    }
    if (pre.status === "ok" && (pre.escalationScore ?? 0) >= config.escalationScoreThreshold) {
      guards.push({ rule: "jev_escalation_score", effect: "escalated", detail: String(pre.escalationScore) });
      const priority: Priority = (pre.escalationScore ?? 0) >= 0.95 ? "high" : "normal";
      return { final: templated(T.fallback, "escalate"), escalate: { reason: "jev_escalation_score", priority }, templated: true };
    }
    if (a.greeting) return { final: templated(T.greeting, "answer"), templated: true };

    if (intent === "order_status") {
      if (session.verify_attempts >= config.limits.maxVerifyAttempts) {
        guards.push({ rule: "verify_attempts_exceeded", effect: "escalated" });
        return { final: templated(T.verifyLocked, "escalate"), escalate: { reason: "verification_failed", priority: "normal" }, templated: true };
      }
      const asksNewOrder = a.orderIds.length > 0 && a.orderIds[0] !== session.verified_order_id;
      if (!session.verified_order_id || asksNewOrder) {
        const missing = [!candidates.orderId && "order_id", !candidates.email && "email"].filter(Boolean) as string[];
        if (missing.length) {
          guards.push({ rule: "verification_incomplete", effect: "downgraded_to_clarify", detail: missing.join(",") });
          return { final: templated(T.needOrderFields(missing), "clarify", missing), templated: true };
        }
      }
    }
    return null;
  }

  private async runModel(
    ctx: ToolContext,
    a: InputAnalysis,
    intent: Intent,
    candidates: { orderId: string | null; email: string | null },
    session: SessionState,
    history: LlmMessage[],
    message: string,
    trace: TurnTrace,
    guards: GuardHit[],
  ): Promise<Outcome> {
    const { db, llm } = this.deps;
    const messages: LlmMessage[] = [...history, { role: "user", content: message }];
    const toolLog: { name: string; ok: boolean; data: Record<string, unknown> }[] = [];
    let schemaRetried = false;

    for (let step = 0; step < config.limits.maxToolSteps; step++) {
      const verifiedOrder = this.currentVerified(db, ctx.sessionId);
      const llmCtx = {
        message,
        analysis: { ...a, intent },
        candidates,
        verifiedOrder,
        hits: [...ctx.retrieved.values()].map((h) => ({ docId: h.docId, text: h.text, score: h.score })),
        toolLog,
      };
      const kbBlock = `KNOWLEDGE BASE PASSAGES retrieved this turn (cite by doc_id):\n${[...ctx.retrieved.values()]
        .map((h) => `[${h.docId}] ${h.text}`)
        .join("\n") || "(none)"}\nVerified order in this session: ${verifiedOrder ? JSON.stringify(verifiedOrder) : "none"}`;

      const t0 = performance.now();
      let raw: string;
      let usage = { input: 0, output: 0 };
      try {
        const res = await this.callLlm({ system: `${SYSTEM_PROMPT}\n\n${kbBlock}`, messages, context: llmCtx });
        raw = res.text;
        usage = res.usage;
      } catch (e) {
        trace.add("llm", { model: llm.model, status: "error", error: String(e) }, performance.now() - t0);
        guards.push({ rule: "llm_unavailable", effect: "escalated" });
        return { final: templated(T.fallback, "escalate"), escalate: { reason: "llm_unavailable", priority: "normal" }, templated: true };
      }

      const parsed = parseStep(raw);
      trace.add(
        "llm",
        {
          model: llm.model,
          prompt_version: config.promptVersion,
          step,
          tokens_in: usage.input,
          tokens_out: usage.output,
          schema_valid: parsed.ok,
          schema_error: parsed.ok ? null : parsed.error,
          step_type: parsed.ok ? parsed.step.type : null,
        },
        performance.now() - t0,
      );

      if (!parsed.ok) {
        if (!schemaRetried) {
          schemaRetried = true;
          messages.push({ role: "assistant", content: raw.slice(0, 2000) });
          messages.push({ role: "user", content: `Your last response was invalid: ${parsed.error}. Respond with one valid JSON object only.` });
          step--;
          continue;
        }
        guards.push({ rule: "schema_invalid", effect: "downgraded_to_clarify" });
        return { final: clarifyFinal(), templated: false };
      }

      const s = parsed.step;
      if (s.type === "final") return { final: s, templated: false };

      // ---- tool step ----
      const argsSchema = ToolArgs[s.name];
      const args = argsSchema.safeParse(s.args);
      const tt = performance.now();
      if (!args.success) {
        trace.add("tool_call", { tool: s.name, status: "invalid_args" }, 0);
        messages.push({ role: "assistant", content: JSON.stringify(s) });
        messages.push({ role: "tool", content: JSON.stringify({ error: "invalid arguments" }) });
        toolLog.push({ name: s.name, ok: false, data: { error: "invalid_args" } });
        continue;
      }

      if (s.name === "request_clarification") {
        const r = requestClarification((args.data as { missing_fields: string[] }).missing_fields);
        trace.add("tool_call", { tool: s.name, args: args.data, result: r.data }, performance.now() - tt);
        const fields = r.data.missing_fields as string[];
        return {
          final: templated(`Could you share ${fields.join(" and ").replace(/_/g, " ")} so I can help?`, "clarify", fields),
          templated: true,
        };
      }

      if (s.name === "create_escalation") {
        const d = args.data as { reason: string; priority: Priority; summary: string };
        trace.add("tool_call", { tool: s.name, by: "model", args: { reason: d.reason, priority: d.priority } }, performance.now() - tt);
        return {
          final: templated(T.fallback, "escalate"),
          escalate: { reason: `model:${d.reason.slice(0, 60)}`, priority: d.priority },
          templated: true,
        };
      }

      let result: { ok: boolean; data: Record<string, unknown> };
      try {
        if (s.name === "search_kb") {
          result = await withTimeout(searchKb(ctx, (args.data as { query: string }).query), config.limits.toolTimeoutMs, "search_kb");
        } else {
          const d = args.data as { order_id: string; email: string };
          result = await withTimeout(getOrder(ctx, d.order_id, d.email), config.limits.toolTimeoutMs, "get_order");
        }
      } catch (e) {
        trace.add("tool_call", { tool: s.name, status: "error", error: String(e) }, performance.now() - tt);
        guards.push({ rule: "tool_error", effect: "escalated", detail: s.name });
        return { final: templated(T.fallback, "escalate"), escalate: { reason: "tool_error", priority: "normal" }, templated: true };
      }

      trace.add(
        "tool_call",
        {
          tool: s.name,
          args: s.name === "get_order" ? { order_id: (args.data as { order_id: string }).order_id, email: "[email]" } : args.data,
          ok: result.ok,
          result: s.name === "get_order" ? summarizeOrderResult(result) : { hits: (result.data.results as unknown[])?.length ?? 0 },
        },
        performance.now() - tt,
      );
      toolLog.push({ name: s.name, ok: result.ok, data: result.data });

      // Verification outcomes are worded by code, not by the model, so the "not found" and
      // "wrong email" cases are byte-identical.
      if (s.name === "get_order" && !result.ok) {
        const err = result.data.error;
        if (err === "verify_locked") {
          guards.push({ rule: "verify_attempts_exceeded", effect: "escalated" });
          return { final: templated(T.verifyLocked, "escalate"), escalate: { reason: "verification_failed", priority: "normal" }, templated: true };
        }
        if (err === "args_not_from_customer") {
          guards.push({ rule: "tool_args_provenance", effect: "downgraded_to_clarify" });
          return { final: templated(T.needOrderFields(["order_id", "email"]), "clarify", ["order_id", "email"]), templated: true };
        }
        if (err === NOT_VERIFIED) {
          const left = Number(result.data.attempts_left ?? 0);
          guards.push({ rule: "verification_failed", effect: "downgraded_to_clarify" });
          this.clearPending(ctx.sessionId);
          candidates.orderId = null;
          candidates.email = null;
          if (left <= 0) {
            return { final: templated(T.verifyLocked, "escalate"), escalate: { reason: "verification_failed", priority: "normal" }, templated: true };
          }
          return { final: templated(T.notVerified(left), "clarify", ["order_id", "email"]), templated: true };
        }
      }

      messages.push({ role: "assistant", content: JSON.stringify(s) });
      messages.push({ role: "tool", content: JSON.stringify(result.data).slice(0, 4000) });
    }

    guards.push({ rule: "tool_step_limit", effect: "escalated" });
    return { final: templated(T.fallback, "escalate"), escalate: { reason: "tool_step_limit", priority: "normal" }, templated: true };
  }

  private async callLlm(req: Parameters<LLMProvider["complete"]>[0]) {
    let lastErr: unknown;
    for (let attempt = 0; attempt <= config.llm.retries; attempt++) {
      try {
        return await this.deps.llm.complete(req, AbortSignal.timeout(config.llm.timeoutMs));
      } catch (e) {
        lastErr = e;
      }
    }
    throw lastErr;
  }

  private currentVerified(db: Database, sessionId: string): OrderView | null {
    const id = (db.query("SELECT verified_order_id FROM sessions WHERE id = ?").get(sessionId) as SessionState).verified_order_id;
    return id ? loadOrderView(db, id) : null;
  }

  private history(sessionId: string): LlmMessage[] {
    const rows = this.deps.db
      .query("SELECT role, content_redacted FROM messages WHERE session_id = ? ORDER BY id DESC LIMIT ?")
      .all(sessionId, config.limits.historyTurns * 2) as { role: "user" | "assistant"; content_redacted: string }[];
    return rows.reverse().map((r) => ({ role: r.role, content: r.content_redacted }));
  }

  private persistPending(sessionId: string, c: { orderId: string | null; email: string | null }, verifiedId: string | null) {
    if (verifiedId && c.orderId === verifiedId) {
      this.clearPending(sessionId);
      return;
    }
    this.deps.db
      .query("UPDATE sessions SET pending_order_id = ?, pending_email = ? WHERE id = ?")
      .run(c.orderId, c.email, sessionId);
  }

  private clearPending(sessionId: string) {
    this.deps.db.query("UPDATE sessions SET pending_order_id = NULL, pending_email = NULL WHERE id = ?").run(sessionId);
  }
}

function summarizeOrderResult(r: { ok: boolean; data: Record<string, unknown> }) {
  if (!r.ok) return { error: r.data.error };
  const o = r.data.order as OrderView;
  return { status: o.status, items: o.items.length };
}

