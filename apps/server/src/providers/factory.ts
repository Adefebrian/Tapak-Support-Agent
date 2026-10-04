import { config, type JevKind, type LlmKind } from "../config.ts";
import { JevProvider, MockJevProvider, NoopProvider } from "./decision/providers.ts";
import type { DecisionProvider } from "./decision/types.ts";
import { AnthropicProvider, OpenAiProvider } from "./llm/live.ts";
import { MockLlm } from "./llm/mock.ts";
import type { LLMProvider } from "./llm/types.ts";

export function makeLlm(kind: LlmKind = config.llm.provider): LLMProvider {
  if (kind === "openai") {
    if (!config.llm.openaiKey) throw new Error("LLM_PROVIDER=openai but OPENAI_API_KEY is empty");
    return new OpenAiProvider(config.llm.openaiKey, config.llm.openaiModel);
  }
  if (kind === "anthropic") {
    if (!config.llm.anthropicKey) throw new Error("LLM_PROVIDER=anthropic but ANTHROPIC_API_KEY is empty");
    return new AnthropicProvider(config.llm.anthropicKey, config.llm.anthropicModel);
  }
  return new MockLlm();
}

export function makeDecision(enabled = config.jev.enabled, kind: JevKind = config.jev.provider): DecisionProvider {
  if (!enabled || kind === "noop") return new NoopProvider();
  if (kind === "jev") {
    if (!config.jev.apiKey) throw new Error("JEV_PROVIDER=jev but JEV_API_KEY is empty");
    return new JevProvider(config.jev.apiKey, config.jev.timeoutMs);
  }
  return new MockJevProvider();
}
