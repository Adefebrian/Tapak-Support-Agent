// Deterministic post-LLM guard. Nothing the model produced reaches the customer without passing here.
import type { Final } from "../agent/schema.ts";
import { containsPii } from "../observability/redact.ts";
import { type Intent, extractOrderIds } from "./input.ts";

export type GuardEffect = "stripped" | "blocked" | "downgraded_to_clarify" | "escalated";
export type GuardHit = { rule: string; effect: GuardEffect; detail?: string };

export type OutputGuardInput = {
  final: Final;
  intent: Intent;
  retrievedDocIds: Set<string>;
  verifiedOrderId: string | null;
  verifiedTracking: string | null;
  customerText: string;
};

const TRACKING_RE = /\b(?:JNE|SCP|JT)\d{6,}\b/g;
const ACTION_CLAIM =
  /\b(i(?:'ve| have)?|we(?:'ve| have)?)\s+(?:already\s+)?(?:refunded|cancell?ed|issued (?:a|your) refund|processed (?:a|your|the) (?:refund|return|exchange|cancellation)|changed (?:your|the) address|approved (?:your|the|an?) (?:exception|exchange|return))/i;

export function guardOutput(input: OutputGuardInput): { final: Final; hits: GuardHit[] } {
  const hits: GuardHit[] = [];
  const f: Final = { ...input.final, citations: [...input.final.citations] };

  // 1. Citations must reference documents actually retrieved in this turn.
  const invalid = f.citations.filter((c) => !input.retrievedDocIds.has(c));
  if (invalid.length) {
    f.citations = f.citations.filter((c) => input.retrievedDocIds.has(c));
    hits.push({ rule: "citation_not_retrieved", effect: "stripped", detail: invalid.join(",") });
  }

  // 2. PII (emails, phones, street addresses) never goes out in a reply.
  if (containsPii(f.reply)) {
    hits.push({ rule: "pii_in_reply", effect: "blocked" });
    return { final: blockedFinal(), hits };
  }

  // 3. Order data may only describe the verified order. IDs the customer typed may be echoed.
  const typed = new Set(extractOrderIds(input.customerText));
  const foreignIds = extractOrderIds(f.reply).filter((id) => id !== input.verifiedOrderId && !typed.has(id));
  const foreignTracking = (f.reply.match(TRACKING_RE) ?? []).filter((t) => t !== input.verifiedTracking);
  if (foreignIds.length || foreignTracking.length) {
    hits.push({
      rule: "unverified_order_data",
      effect: "blocked",
      detail: [...foreignIds, ...foreignTracking].join(","),
    });
    return { final: blockedFinal(), hits };
  }

  // 4. The agent cannot perform actions, so it must never claim it did.
  if (ACTION_CLAIM.test(f.reply)) {
    hits.push({ rule: "false_action_claim", effect: "blocked" });
    return { final: blockedFinal(), hits };
  }

  // 5. Grounding: a policy answer without a valid citation is not an answer.
  if (f.action === "answer") {
    const isOrderAnswer = input.verifiedOrderId !== null && f.reply.includes(input.verifiedOrderId);
    if (!isOrderAnswer && f.citations.length === 0) {
      hits.push({ rule: "answer_without_citation", effect: "downgraded_to_clarify" });
      return { final: clarifyFinal(), hits };
    }
    if (input.intent === "order_status" && !isOrderAnswer && input.verifiedOrderId === null) {
      hits.push({ rule: "order_answer_unverified", effect: "downgraded_to_clarify" });
      return {
        final: {
          ...clarifyFinal(),
          reply: "To check an order I need your order ID and the email used at checkout.",
          clarification_fields: ["order_id", "email"],
        },
        hits,
      };
    }
  }

  return { final: f, hits };
}

export function clarifyFinal(): Final {
  return {
    type: "final",
    reply:
      "I could not find a reliable answer to that in our help articles. Could you tell me a bit more, or would you like me to pass it to our support team?",
    action: "clarify",
    citations: [],
    confidence: 0,
    clarification_fields: ["details"],
    suggestions: [],
  };
}

function blockedFinal(): Final {
  return {
    type: "final",
    reply:
      "I am not able to answer that reliably right now, so I have passed your message to our support team. They will reply within 1 business day.",
    action: "escalate",
    citations: [],
    confidence: 0,
    clarification_fields: [],
    suggestions: [],
  };
}

// Quick replies are model output too: same checks as the reply, and a bad one is dropped, not repaired.
export function guardSuggestions(
  list: string[],
  customerText: string,
  verifiedOrderId: string | null,
): string[] {
  const typed = new Set(extractOrderIds(customerText));
  return list
    .map((q) => q.trim())
    .filter((q) => q.length >= 2 && q.length <= 80)
    .filter((q) => !containsPii(q) && !ACTION_CLAIM.test(q) && !TRACKING_RE.test(q))
    .filter((q) => extractOrderIds(q).every((id) => id === verifiedOrderId || typed.has(id)))
    .slice(0, 3);
}
