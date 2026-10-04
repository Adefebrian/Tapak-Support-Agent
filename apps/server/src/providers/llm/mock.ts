import { tokenize } from "../../retrieval/bm25.ts";
import type { OrderView } from "../../tools/index.ts";
import type { LLMProvider, LlmContext, LlmRequest, LlmResponse } from "./types.ts";

// Turns a KB passage into plain sentences: list items become sentences and each table row becomes
// "Subject: column value, column value". This is what lets the mock answer from a table.
export function passageSentences(text: string): string[] {
  return passageUnits(text).map((u) => u.text);
}

type Unit = { text: string; row: boolean };

function passageUnits(text: string): Unit[] {
  const body = text.replace(/^[^.]*\.\s*/, "").replace(/\*\*/g, "");
  const out: Unit[] = [];
  let header: string[] | null = null;
  for (const raw of body.split("\n")) {
    const line = raw.trim();
    if (!line) {
      header = null;
      continue;
    }
    if (line.startsWith("|")) {
      const cells = line
        .split("|")
        .map((c) => c.trim())
        .filter(Boolean);
      if (cells.every((c) => /^-+$/.test(c))) continue;
      if (!header) {
        header = cells;
        continue;
      }
      const subject = header[0] && header[0].length <= 4 ? `${header[0]} ${cells[0]}` : cells[0];
      const rest = cells.slice(1).map((c, i) => `${header?.[i + 1] ?? ""} ${c}`.trim());
      out.push({ text: `${subject}: ${rest.join(", ")}.`, row: true });
      continue;
    }
    header = null;
    const text2 = line.replace(/^[-*]\s+/, "");
    for (const s of text2.match(/[^.!?]+[.!?]+|[^.!?]+$/g) ?? []) {
      const t = s.trim();
      if (t.length > 3) out.push({ text: /[.!?]$/.test(t) ? t : `${t}.`, row: false });
    }
  }
  return out;
}

export function splitQuestions(message: string): string[] {
  return message
    .split(/\?+\s*|\s+(?:and also|also,)\s+/i)
    .map((q) => q.trim())
    .filter((q) => q.split(/\s+/).length >= 3);
}

function overlap(passage: string, q: string): number {
  const p = new Set(tokenize(passage));
  return tokenize(q).filter((t) => p.has(t)).length;
}

// Extractive answer: the sentences that overlap the question most, kept in the page's own order.
export function bestSentences(passage: string, query: string, n: number): string {
  const units = passageUnits(passage);
  const sentences = units.map((u) => u.text);
  const qList = tokenize(query);
  const q = new Set(qList);
  const nums = query.match(/\d+(?:\.\d+)?/g) ?? [];
  // Adjacent word pairs from the question ("men 9") must appear together to count: this is what tells
  // "US Men 9.5" apart from "US Women 9".
  const raw = (x: string) =>
    x
      .toLowerCase()
      .replace(/'s\b/g, "")
      .match(/[a-z0-9]+/g) ?? [];
  const qWords = raw(query);
  const pairs = qWords.slice(1).map((w, i) => `${qWords[i]} ${w}`);
  const scored = sentences.map((s, i) => {
    const toks = new Set(tokenize(s));
    const sw = raw(s);
    const sPairs = new Set(sw.slice(1).map((w, j) => `${sw[j]} ${w}`));
    let score = 0;
    for (const t of q) if (toks.has(t)) score += 1;
    let pairHits = 0;
    for (const p of pairs) if (sPairs.has(p)) pairHits++;
    score += pairHits * 2.5;
    for (const num of nums)
      if (new RegExp(`(^|[^\\d.])${num.replace(".", "\\.")}([^\\d]|$)`).test(s)) score += 1.5;
    return { s, i, score, pairHits };
  });
  const best = scored.reduce((a, b) => (b.score > a.score ? b : a), scored[0] ?? { score: 0, pairHits: 0 });
  // A lookup that matched a distinctive phrase (a table row) answers with that row, not its neighbours.
  const precise = (best.pairHits ?? 0) > Math.min(...scored.map((x) => x.pairHits));
  const picked = scored
    .filter((x) => x.score > 0 && x.score >= best.score * (precise ? 0.8 : 0.4))
    .sort((a, b) => b.score - a.score || a.i - b.i)
    .slice(0, n)
    .sort((a, b) => a.i - b.i);
  // A single precise sentence of prose reads abruptly: add the sentence that follows it on the page.
  if (picked.length === 1 && n > 1) {
    const only = picked[0]!;
    const next = scored[only.i + 1];
    if (next && !units[only.i]?.row && !units[next.i]?.row) picked.push(next);
  }
  const chosen = picked.length ? picked : scored.slice(0, n);
  return chosen.map((x) => x.s).join(" ");
}

function day(iso: string | null): string {
  if (!iso) return "a date we will confirm soon";
  const d = new Date(`${iso}T00:00:00Z`);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
}

export function describeOrder(o: OrderView): string {
  const items = o.items.map((i) => `${i.qty} x ${i.name} in EU ${i.size_eu}`).join(" and ");
  switch (o.status) {
    case "paid":
      return `Order ${o.order_id} is paid and next in line to be packed. It should reach you by ${day(o.eta)}. It contains ${items}.`;
    case "packed":
      return `Order ${o.order_id} is packed and goes to ${o.carrier ?? "the carrier"} shortly. It should reach you by ${day(o.eta)}. It contains ${items}.`;
    case "shipped":
      return `Good news: order ${o.order_id} has shipped and is on its way with ${o.carrier}, tracking number ${o.tracking_no}. It should arrive by ${day(o.eta)}. It contains ${items}.`;
    case "delivered":
      return `Order ${o.order_id} was delivered on ${day(o.delivered_at)}. It contained ${items}.`;
    case "returned":
      return `Order ${o.order_id} has arrived back at our warehouse. Refunds for returns are handled by our support team.`;
    case "cancelled":
      return `Order ${o.order_id} was cancelled, so nothing will be shipped.`;
    case "lost":
      return `I'm sorry: ${o.carrier} has reported order ${o.order_id} as lost. A carrier claim needs a person on our team, who will offer you a replacement or a refund.`;
    default:
      return `Order ${o.order_id} is currently ${o.status}.`;
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

  // Two questions in one message: look the second one up with search_kb (a real tool step), then
  // answer both, each from its own page.
  const questions = splitQuestions(ctx.message);
  if (questions.length >= 2 && ctx.analysis.intent === "policy_question") {
    const searched = ctx.toolLog.some((l) => l.name === "search_kb");
    if (!searched) return { type: "tool", name: "search_kb", args: { query: questions[1] } };
    const parts: string[] = [];
    const cites: string[] = [];
    for (const q of questions.slice(0, 2)) {
      const best = [...ctx.hits].sort((a, b) => overlap(b.text, q) - overlap(a.text, q))[0];
      if (!best || overlap(best.text, q) === 0) continue;
      parts.push(bestSentences(best.text, q, 2));
      if (!cites.includes(best.docId)) cites.push(best.docId);
    }
    if (parts.length) {
      return {
        type: "final",
        reply: parts.length === 2 ? `${parts[0]} On your second question: ${parts[1]}` : parts[0],
        action: "answer",
        citations: cites,
        confidence: 0.8,
        clarification_fields: [],
      };
    }
  }

  const top = ctx.hits[0];
  if (!top) {
    return {
      type: "final",
      reply:
        "I couldn't find that in our help pages, and I'd rather not guess. Could you tell me a bit more?",
      action: "clarify",
      citations: [],
      confidence: 0.3,
      clarification_fields: ["details"],
    };
  }
  // Sentences are ranked by what the customer just said; the carried-over topic only picks the page.
  const contextual = ctx.query !== undefined && ctx.query !== ctx.message;
  const second = ctx.hits[1];
  const useSecond = !contextual && second && second.score >= top.score * 0.9;
  const reply = useSecond
    ? `${bestSentences(top.text, ctx.message, 2)} ${bestSentences(second.text, ctx.message, 1)}`
    : bestSentences(top.text, ctx.message, contextual ? 2 : 3);
  return {
    type: "final",
    reply,
    action: "answer",
    citations: useSecond && second ? [top.docId, second.docId] : [top.docId],
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
