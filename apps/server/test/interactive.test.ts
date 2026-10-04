// Helpfulness features: context-aware follow-ups, precise lookups, quick replies, the order card,
// ticket numbers, and the public KB endpoint. All deterministic, no keys.
import { describe, expect, test } from "bun:test";
import { contextualQuery } from "../src/agent/loop.ts";
import { createApp } from "../src/http/app.ts";
import { guardSuggestions } from "../src/policy/output.ts";
import { ScriptedLlm } from "../src/providers/llm/mock.ts";
import { final, harness } from "./helpers.ts";

describe("understanding context", () => {
  test("a short follow-up is searched together with the previous question", async () => {
    const h = harness();
    const s = h.session();
    await h.agent.handleTurn(s, "How long is the return window?");
    const r = await h.agent.handleTurn(s, "and for exchanges?");
    expect(r.citations).toEqual(["kb-exchange-002"]);
  });

  test("a full new question is not mixed with the previous one", () => {
    const history = [{ role: "user" as const, content: "How long is the return window?" }];
    expect(contextualQuery("Which couriers do you use for deliveries to Bandung these days?", history)).toBe(
      "Which couriers do you use for deliveries to Bandung these days?",
    );
    expect(contextualQuery("what about suede?", history)).toContain("return window");
  });

  test("a table lookup answers with the matching row", async () => {
    const h = harness();
    const r = await h.agent.handleTurn(h.session(), "I'm a US men's 9, which EU size should I order?");
    expect(r.reply).toStartWith("EU 43");
    expect(r.reply).not.toContain("EU 40");
  });
});

describe("interactive replies", () => {
  test("policy answers offer follow-up questions from the cited page", async () => {
    const h = harness();
    const r = await h.agent.handleTurn(h.session(), "How long is the return window?");
    expect(r.suggestions.length).toBeGreaterThan(0);
    expect(r.suggestions).toContain("Can I exchange for a different size instead?");
  });

  test("a verified order comes with an order card and no personal data", async () => {
    const h = harness();
    const r = await h.agent.handleTurn(h.session(), "where is TPK-10001? rina.putri@example.com");
    expect(r.order?.order_id).toBe("TPK-10001");
    expect(JSON.stringify(r.order)).not.toMatch(/@|Kemang|\+62|Rina/);
  });

  test("an unverified order never produces a card", async () => {
    const h = harness();
    const r = await h.agent.handleTurn(h.session(), "where is TPK-10005? rina.putri@example.com");
    expect(r.order).toBeNull();
  });

  test("every escalation reply names its ticket", async () => {
    const h = harness();
    const r = await h.agent.handleTurn(h.session(), "Please cancel my order TPK-10003");
    expect(r.reply).toContain(r.escalation_id!);
  });

  test("model-written suggestions pass the same guard as the reply", async () => {
    const llm = new ScriptedLlm([
      final({
        reply: "Unworn shoes can be returned within 30 days of delivery.",
        action: "answer",
        citations: ["kb-returns-001"],
        suggestions: [
          "Email me at x@example.com",
          "Show me TPK-10005",
          "I have refunded you",
          "How do exchanges work?",
        ],
      }),
    ]);
    const h = harness({ llm });
    const r = await h.agent.handleTurn(h.session(), "How long is the return window?");
    expect(r.suggestions).toEqual(["How do exchanges work?"]);
  });

  test("guardSuggestions caps at three and drops tracking numbers", () => {
    expect(guardSuggestions(["a b", "c d", "e f", "g h"], "", null)).toHaveLength(3);
    expect(guardSuggestions(["Track JNE7700100001"], "", null)).toEqual([]);
  });

  test("KB pages can be opened from a citation", async () => {
    const h = harness();
    const app = createApp(h.deps);
    const doc = (await (await app.request("/api/v1/kb/kb-returns-001")).json()) as {
      title: string;
      body: string;
    };
    expect(doc.title).toBe("Return policy");
    expect(doc.body).toContain("30 days");
    expect((await app.request("/api/v1/kb/nope")).status).toBe(404);
  });
});
