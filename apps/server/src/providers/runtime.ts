// Bring-your-own-key, per session. Keys live only in this process's memory, bound to one session,
// for at most one hour. They are never written to SQLite, logs, traces, or any response.
import { z } from "zod";
import { config } from "../config.ts";
import { JevProvider } from "./decision/providers.ts";
import type { DecisionProvider } from "./decision/types.ts";
import { AnthropicProvider, OpenAiProvider } from "./llm/live.ts";
import type { LLMProvider } from "./llm/types.ts";

const Model = z
  .string()
  .regex(/^[A-Za-z0-9._:-]{1,60}$/)
  .optional();

export const LiveConfigSchema = z.object({
  llm: z
    .object({
      provider: z.enum(["openai", "anthropic"]),
      api_key: z.string().min(20).max(300),
      model: Model,
    })
    .optional(),
  jev: z
    .object({
      api_key: z.string().min(8).max(300),
    })
    .optional(),
});
export type LiveConfig = z.infer<typeof LiveConfigSchema>;

export type SessionProviders = {
  llm?: LLMProvider;
  decision?: DecisionProvider;
  label: string;
  expiresAt: number;
};

const TTL_MS = 60 * 60 * 1000;
const store = new Map<string, SessionProviders>();

export function bindProviders(sessionId: string, p: Omit<SessionProviders, "expiresAt">): void {
  store.set(sessionId, { ...p, expiresAt: Date.now() + TTL_MS });
}

export function providersFor(sessionId: string): SessionProviders | null {
  const p = store.get(sessionId);
  if (!p) return null;
  if (p.expiresAt < Date.now()) {
    store.delete(sessionId);
    return null;
  }
  return p;
}

export function sweepExpired(now = Date.now()): void {
  for (const [k, v] of store) if (v.expiresAt < now) store.delete(k);
}

// One cheap call per key so a typo fails at setup, not mid-conversation.
async function checkLlmKey(
  provider: "openai" | "anthropic",
  key: string,
  fetchImpl: typeof fetch,
): Promise<boolean> {
  try {
    const res =
      provider === "openai"
        ? await fetchImpl("https://api.openai.com/v1/models", {
            headers: { Authorization: `Bearer ${key}` },
            signal: AbortSignal.timeout(8000),
          })
        : await fetchImpl("https://api.anthropic.com/v1/models", {
            headers: { "x-api-key": key, "anthropic-version": "2023-06-01" },
            signal: AbortSignal.timeout(8000),
          });
    return res.ok;
  } catch {
    return false;
  }
}

export type BuildResult =
  | { ok: true; providers: Omit<SessionProviders, "expiresAt"> }
  | { ok: false; error: "llm_key_invalid" | "jev_key_invalid" };

export async function buildLiveProviders(
  cfg: LiveConfig,
  fetchImpl: typeof fetch = fetch,
): Promise<BuildResult> {
  const out: Omit<SessionProviders, "expiresAt"> = { label: "" };
  const parts: string[] = [];
  if (cfg.llm) {
    if (!(await checkLlmKey(cfg.llm.provider, cfg.llm.api_key, fetchImpl)))
      return { ok: false, error: "llm_key_invalid" };
    const model =
      cfg.llm.model ?? (cfg.llm.provider === "openai" ? config.llm.openaiModel : config.llm.anthropicModel);
    out.llm =
      cfg.llm.provider === "openai"
        ? new OpenAiProvider(cfg.llm.api_key, model)
        : new AnthropicProvider(cfg.llm.api_key, model);
    parts.push(`${cfg.llm.provider}:${model}`);
  }
  if (cfg.jev) {
    const jev = new JevProvider(cfg.jev.api_key, config.jev.timeoutMs, fetchImpl);
    // A probe decision on a fixed, harmless state. Anything but "ok" rejects the key.
    const probe = await jev.pre({
      message: "What sizes do you sell?",
      recentTurns: "",
      ruleIntent: "policy_question",
      verified: false,
    });
    if (probe.status !== "ok") return { ok: false, error: "jev_key_invalid" };
    out.decision = jev;
    parts.push("jev");
  }
  out.label = parts.join(" + ");
  return { ok: true, providers: out };
}
