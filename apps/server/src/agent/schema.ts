import { z } from "zod";
import { TOOL_NAMES } from "../tools/index.ts";

export const ActionSchema = z.enum(["answer", "clarify", "refuse", "escalate"]);

export const FinalSchema = z.object({
  type: z.literal("final"),
  reply: z.string().min(1).max(1500),
  action: ActionSchema,
  citations: z.array(z.string().max(60)).max(5).default([]),
  confidence: z.number().min(0).max(1),
  clarification_fields: z.array(z.string().max(40)).max(5).default([]),
});

export const ToolStepSchema = z.object({
  type: z.literal("tool"),
  name: z.enum(TOOL_NAMES),
  args: z.record(z.unknown()),
});

export const StepSchema = z.discriminatedUnion("type", [FinalSchema, ToolStepSchema]);
export type Step = z.infer<typeof StepSchema>;
export type Final = z.infer<typeof FinalSchema>;

// Public API response for POST /sessions/:id/messages.
export const MessageResponseSchema = z.object({
  reply: z.string(),
  action: ActionSchema,
  citations: z.array(z.string()),
  escalation_id: z.string().nullable(),
  clarification_fields: z.array(z.string()),
  trace_id: z.string(),
  meta: z.object({
    latency_ms: z.number(),
    guardrails_triggered: z.array(z.string()),
    intent: z.string(),
    llm: z.string(),
    jev: z.string(),
  }),
});
export type MessageResponse = z.infer<typeof MessageResponseSchema>;

export function parseStep(text: string): { ok: true; step: Step } | { ok: false; error: string } {
  let json: unknown;
  try {
    const trimmed = text
      .trim()
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/```$/, "");
    json = JSON.parse(trimmed);
  } catch {
    return { ok: false, error: "response is not valid JSON" };
  }
  const r = StepSchema.safeParse(json);
  if (!r.success) return { ok: false, error: r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") };
  return { ok: true, step: r.data };
}
