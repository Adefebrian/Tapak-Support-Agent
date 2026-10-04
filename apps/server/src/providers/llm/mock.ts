import type { OrderView } from "../../tools/index.ts";
import type { LLMProvider, LlmContext, LlmRequest, LlmResponse } from "./types.ts";

function firstSentences(text: string, n: number): string {
  const body = text.replace(/^[^.]*\.\s*/, ""); // drop the "Title. " prefix added at chunking
  const clean = body
    .replace(/\*\*/g, "")
    .replace(/\s*\n\s*-\s*/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const parts = clean.match(/[^.!?]+[.!?]/g) ?? [clean];
  return parts.slice(0, n).join(" ").trim();
}

export function describeOrder(o: OrderView): string {
  const items = o.items.map((i) => `${i.qty} x ${i.name} (EU ${i.size_eu})`).join(", ");
  switch (o.status) {
    case "paid":
      return `Order ${o.order_id} is paid and waiting to be packed. Estimated delivery: ${o.eta}. Items: ${items}.`;
    case "packed":
      return `Order ${o.order_id} is packed and will be handed to ${o.carrier ?? "the carrier"} soon. Estimated delivery: ${o.eta}. Items: ${items}.`;
    case "shipped":
      return `Order ${o.order_id} has shipped with ${o.carrier}, tracking number ${o.tracking_no}. Estimated delivery: ${o.eta}. Items: ${items}.`;
    case "delivered":
      return `Order ${o.order_id} was delivered on ${o.delivered_at}. Items: ${items}.`;
    case "returned":
      return `Order ${o.order_id} has been returned to our warehouse. Refunds are handled by our support team.`;
    case "cancelled":
      return `Order ${o.order_id} was cancelled.`;
    case "lost":
      return `The carrier ${o.carrier} has reported order ${o.order_id} as lost. Our support team handles carrier claims and will contact you about a replacement or refund.`;
    default:
      return `Order ${o.order_id} status: ${o.status}.`;
  }
}

// Deterministic stand-in for a live model. It follows the same JSON protocol, so every guard,
// schema check, and tool path runs exactly as in live mode.
export function mockPolicy(ctx: LlmContext): Record<string, unknown> {
  const last = ctx.toolLog[ctx.toolLog.length - 1];
  if (last?.name === "get_order") {
    if (last.ok) {
      const order = last.data.order as OrderView;
      const lost = order.status === "lost";
      return {
        type: "final",
        reply: describeOrder(order),
        action: lost ? "escalate" : "answer",
        citations: lost ? ["kb-carriers-005"].filter((id) => ctx.hits.some((h) => h.docId === id)) : [],
        confidence: 0.9,
        clarification_fields: [],
      };
    }
    return {
      type: "final",
      reply: "I could not verify an order with those details.",
      action: "clarify",
      citations: [],
      confidence: 0.8,
      clarification_fields: ["order_id", "email"],
    };
  }

  if (ctx.verifiedOrder && ctx.analysis.intent === "order_status" && ctx.analysis.orderIds.length === 0) {
    return {
      type: "final",
      reply: describeOrder(ctx.verifiedOrder),
      action: "answer",
      citations: [],
      confidence: 0.85,
      clarification_fields: [],
    };
  }

  if (ctx.candidates.orderId && ctx.candidates.email && ctx.analysis.intent === "order_status") {
    return {
      type: "tool",
      name: "get_order",
      args: { order_id: ctx.candidates.orderId, email: ctx.candidates.email },
    };
  }

  const top = ctx.hits[0];
  if (!top) {
    return {
      type: "final",
      reply: "I could not find that in our help articles. Could you tell me more about what you need?",
      action: "clarify",
      citations: [],
      confidence: 0.3,
      clarification_fields: ["details"],
    };
  }
  const second = ctx.hits[1];
  const useSecond = second && second.score >= top.score * 0.9;
  const reply = useSecond
    ? `${firstSentences(top.text, 2)} ${firstSentences(second.text, 1)}`
    : firstSentences(top.text, 3);
  return {
    type: "final",
    reply,
    action: "answer",
    citations: useSecond ? [top.docId, second.docId] : [top.docId],
    confidence: Math.min(0.95, 0.5 + top.score / 20),
    clarification_fields: [],
  };
}

export class MockLlm implements LLMProvider {
  readonly name = "mock";
  readonly model = "mock-deterministic-v1";
  async complete(req: LlmRequest): Promise<LlmResponse> {
    const text = JSON.stringify(mockPolicy(req.context));
    return {
      text,
      usage: {
        input: Math.ceil(JSON.stringify(req.messages).length / 4),
        output: Math.ceil(text.length / 4),
      },
    };
  }
}

// Test double: replays scripted raw outputs (or throws), to exercise schema failures, bad citations, leaks, timeouts.
export class ScriptedLlm implements LLMProvider {
  readonly name = "scripted";
  readonly model = "scripted";
  calls = 0;
  constructor(private readonly script: Array<string | Error | ((ctx: LlmContext) => string)>) {}
  async complete(req: LlmRequest): Promise<LlmResponse> {
    const next = this.script[Math.min(this.calls, this.script.length - 1)];
    this.calls++;
    if (next instanceof Error) throw next;
    const text = typeof next === "function" ? next(req.context) : (next ?? "");
    return { text, usage: { input: 0, output: 0 } };
  }
}
