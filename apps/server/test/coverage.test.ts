// Paths the deterministic mock model never takes on its own. A scripted model drives each one so every
// branch of the tool loop is exercised without an API key.
import { describe, expect, test } from "bun:test";
import { createApp } from "../src/http/app.ts";
import { readTraces } from "../src/observability/trace.ts";
import { ScriptedLlm } from "../src/providers/llm/mock.ts";
import { final, harness } from "./helpers.ts";

const tool = (name: string, args: Record<string, unknown>) => JSON.stringify({ type: "tool", name, args });

describe("tool loop branches", () => {
  test("search_kb called by the model makes its documents citable", async () => {
    const llm = new ScriptedLlm([
      tool("search_kb", { query: "suede care brush" }),
      final({
        reply: "Brush suede when dry and use a suede eraser for marks.",
        action: "answer",
        citations: ["kb-care-007"],
      }),
    ]);
    const h = harness({ llm });
    const s = h.session();
    const r = await h.agent.handleTurn(s, "My shoes look dirty, any tips on returns or care?");
    expect(r.action).toBe("answer");
    expect(r.citations).toEqual(["kb-care-007"]);
    expect(readTraces(h.db, s).some((e) => e.stage === "tool_call" && e.payload.tool === "search_kb")).toBe(
      true,
    );
  });

  test("request_clarification ends the turn with the requested fields", async () => {
    const llm = new ScriptedLlm([tool("request_clarification", { missing_fields: ["shoe_model"] })]);
    const h = harness({ llm });
    const r = await h.agent.handleTurn(h.session(), "How do I clean them?");
    expect(r.action).toBe("clarify");
    expect(r.clarification_fields).toEqual(["shoe_model"]);
  });

  test("create_escalation called by the model creates a ticket in code", async () => {
    const llm = new ScriptedLlm([
      tool("create_escalation", { reason: "unclear warranty case", priority: "normal", summary: "x" }),
    ]);
    const h = harness({ llm });
    const r = await h.agent.handleTurn(h.session(), "What does the warranty cover?");
    expect(r.action).toBe("escalate");
    const row = h.db.query("SELECT reason FROM escalations WHERE id = ?").get(r.escalation_id!) as {
      reason: string;
    };
    expect(row.reason).toStartWith("model:");
  });

  test("invalid tool arguments are reported back and the loop continues", async () => {
    const llm = new ScriptedLlm([
      tool("get_order", { order_id: "" }),
      final({
        reply: "Unworn shoes can be returned within 30 days of delivery.",
        action: "answer",
        citations: ["kb-returns-001"],
      }),
    ]);
    const h = harness({ llm });
    const s = h.session();
    const r = await h.agent.handleTurn(s, "How long is the return window?");
    expect(r.action).toBe("answer");
    expect(readTraces(h.db, s).some((e) => e.payload.status === "invalid_args")).toBe(true);
  });

  test("a model that never finishes hits the step limit and escalates", async () => {
    const llm = new ScriptedLlm([tool("search_kb", { query: "returns" })]);
    const h = harness({ llm });
    const r = await h.agent.handleTurn(h.session(), "How long is the return window?");
    expect(r.action).toBe("escalate");
    expect(r.meta.guardrails_triggered).toContain("tool_step_limit");
    expect(llm.calls).toBe(4);
  });

  test("a model passing an email the customer never typed is stopped by provenance", async () => {
    const llm = new ScriptedLlm([
      tool("get_order", { order_id: "TPK-10005", email: "budi.santoso@example.com" }),
    ]);
    const h = harness({ llm });
    const r = await h.agent.handleTurn(h.session(), "where is TPK-10005? my email is rina.putri@example.com");
    expect(r.action).toBe("clarify");
    expect(r.meta.guardrails_triggered).toContain("tool_args_provenance");
    expect(r.reply).not.toMatch(/delivered|SiCepat/);
  });

  test("a tool that throws fails closed to escalation", async () => {
    const h = harness();
    h.db.exec("DROP TABLE order_items; DROP TABLE orders;");
    const r = await h.agent.handleTurn(h.session(), "where is TPK-10001? rina.putri@example.com");
    expect(r.action).toBe("escalate");
    expect(r.meta.guardrails_triggered).toContain("tool_error");
  });

  test("a model claiming it refunded is blocked end to end", async () => {
    const llm = new ScriptedLlm([
      final({
        reply: "Good news, I have refunded your order.",
        action: "answer",
        citations: ["kb-returns-001"],
      }),
    ]);
    const h = harness({ llm });
    const r = await h.agent.handleTurn(h.session(), "How long is the return window?");
    expect(r.action).toBe("escalate");
    expect(r.meta.guardrails_triggered).toContain("false_action_claim");
  });

  test("at most 10 earlier turns are sent to the model", async () => {
    let seen = 0;
    const llm = new ScriptedLlm([
      (ctx) => {
        seen = ctx.message.length;
        return final({
          reply: "Unworn shoes can be returned within 30 days of delivery.",
          action: "answer",
          citations: ["kb-returns-001"],
        });
      },
    ]);
    const lengths: number[] = [];
    const spy = {
      ...llm,
      name: "spy",
      model: "spy",
      complete: async (req: Parameters<typeof llm.complete>[0]) => {
        lengths.push(req.messages.length);
        return llm.complete(req);
      },
    };
    const h = harness({ llm: spy });
    const s = h.session();
    for (let i = 0; i < 14; i++) await h.agent.handleTurn(s, "How long is the return window?");
    expect(seen).toBeGreaterThan(0);
    expect(Math.max(...lengths)).toBe(21); // 10 turns (20 messages) + the current message
  });
});

describe("conversation behaviour", () => {
  test("a verified session can ask a follow-up without repeating the email", async () => {
    const h = harness();
    const s = h.session();
    await h.agent.handleTurn(s, "where is TPK-10001? rina.putri@example.com");
    const r = await h.agent.handleTurn(s, "when will it arrive?");
    expect(r.action).toBe("answer");
    expect(r.reply).toContain("TPK-10001");
  });

  test("a return request past 30 days is escalated as a policy exception", async () => {
    const h = harness();
    const r = await h.agent.handleTurn(
      h.session(),
      "I want to return TPK-10012, it was delivered over 30 days ago",
    );
    expect(r.action).toBe("escalate");
    const row = h.db.query("SELECT reason FROM escalations WHERE id = ?").get(r.escalation_id!) as {
      reason: string;
    };
    expect(row.reason).toBe("action_request:policy_exception");
  });

  test("a second escalation in the same session reuses the open ticket and raises priority", async () => {
    const h = harness();
    const s = h.session();
    const a = await h.agent.handleTurn(s, "Please refund my order TPK-10002");
    const b = await h.agent.handleTurn(s, "I'm filing a chargeback now");
    expect(b.escalation_id).toBe(a.escalation_id);
    const row = h.db.query("SELECT priority FROM escalations WHERE id = ?").get(a.escalation_id!) as {
      priority: string;
    };
    expect(row.priority).toBe("high");
  });

  test("greeting gets the capability message", async () => {
    const h = harness();
    const r = await h.agent.handleTurn(h.session(), "hi");
    expect(r.reply).toMatch(/order status/);
  });
});

describe("streaming and metrics endpoints", () => {
  test("SSE stream sends each stage, then the result", async () => {
    const h = harness();
    const app = createApp(h.deps);
    const { session_id } = (await (await app.request("/api/v1/sessions", { method: "POST" })).json()) as {
      session_id: string;
    };
    const res = await app.request(`/api/v1/sessions/${session_id}/messages/stream`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message: "How long is the return window?" }),
    });
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    const text = await res.text();
    const stages = [...text.matchAll(/event: stage\ndata: (.*)/g)].map((m) => JSON.parse(m[1]!).stage);
    expect(stages).toEqual(expect.arrayContaining(["input", "retrieval", "llm", "output"]));
    const result = JSON.parse(text.match(/event: result\ndata: (.*)/)![1]!);
    expect(result.action).toBe("answer");
    expect(text).not.toContain("@example.com");
  });

  test("metrics expose the PRD signals", async () => {
    const h = harness();
    const app = createApp(h.deps);
    const { session_id } = (await (await app.request("/api/v1/sessions", { method: "POST" })).json()) as {
      session_id: string;
    };
    for (const m of ["How long is the return window?", "Please refund TPK-10002", "where is my order?"]) {
      await app.request(`/api/v1/sessions/${session_id}/messages`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message: m }),
      });
    }
    const j = (await (await app.request("/api/v1/metrics")).json()) as Record<string, unknown>;
    for (const k of [
      "escalation_rate",
      "clarify_rate",
      "stage_latency_ms",
      "guardrails",
      "llm_schema_failure_rate",
      "retrieval_empty_rate",
      "tokens_per_session",
      "jev_disagreement_rate",
      "jev_timeout_rate",
    ]) {
      expect(j).toHaveProperty(k);
    }
    expect(j.turns).toBe(3);
    expect(j.escalation_rate).toBeCloseTo(1 / 3);
  });
});
