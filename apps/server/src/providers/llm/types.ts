import type { InputAnalysis } from "../../policy/input.ts";
import type { OrderView } from "../../tools/index.ts";

export type LlmMessage = { role: "user" | "assistant" | "tool"; content: string };

// Structured view of the turn. Live providers ignore it; MockLlm uses it to behave deterministically.
export type LlmContext = {
  message: string;
  analysis: InputAnalysis;
  candidates: { orderId: string | null; email: string | null };
  verifiedOrder: OrderView | null;
  hits: { docId: string; text: string; score: number }[];
  toolLog: { name: string; ok: boolean; data: Record<string, unknown> }[];
};

export type LlmRequest = { system: string; messages: LlmMessage[]; context: LlmContext };
export type LlmResponse = { text: string; usage: { input: number; output: number } };

export interface LLMProvider {
  readonly name: string;
  readonly model: string;
  complete(req: LlmRequest, signal: AbortSignal): Promise<LlmResponse>;
}
