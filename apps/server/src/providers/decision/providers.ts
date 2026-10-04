import { analyzeInput, type Intent } from "../../policy/input.ts";
import { tokenize } from "../../retrieval/bm25.ts";
import {
  type DecisionProvider,
  ESCALATION_RUBRIC,
  type GroundednessDecision,
  type PreDecision,
  type PreDecisionInput,
} from "./types.ts";

const INTENTS: Intent[] = ["policy_question", "order_status", "action_request", "complaint", "out_of_scope"];

export class NoopProvider implements DecisionProvider {
  readonly name = "noop";
  async pre(): Promise<PreDecision> {
    return { status: "disabled", latencyMs: 0 };
  }
  async groundedness(): Promise<GroundednessDecision> {
    return { status: "disabled", latencyMs: 0 };
  }
}

type MockOpts = { fail?: "timeout" | "error"; scoreOverride?: number; intentOverride?: Intent };

// Deterministic stand-in for JEV with deliberately different heuristics from the rule engine,
// so disagreement metrics are meaningful in mock runs.
export class MockJevProvider implements DecisionProvider {
  readonly name = "mock-jev";
  constructor(private readonly opts: MockOpts = {}) {}

  async pre(input: PreDecisionInput): Promise<PreDecision> {
    if (this.opts.fail) return { status: this.opts.fail, latencyMs: 0, error: `mock ${this.opts.fail}` };
    const a = analyzeInput(input.message);
    let score = 0.1;
    if (a.actionRequested) score = Math.max(score, 0.85);
    if (a.policyException) score = Math.max(score, 0.85);
    if (a.highPriority) score = 1;
    if (a.negativeTone) score = Math.max(score, 0.7);
    if (a.medical || a.legalSafety) score = Math.max(score, 0.6);
    if (a.injectionFlags.length) score = Math.max(score, 0.5);
    let intent: Intent = input.ruleIntent;
    if (a.negativeTone && intent === "order_status") intent = "complaint";
    return {
      status: "ok",
      intent: this.opts.intentOverride ?? intent,
      escalationScore: this.opts.scoreOverride ?? score,
      latencyMs: 1,
    };
  }

  async groundedness(draft: string, passages: string[]): Promise<GroundednessDecision> {
    if (this.opts.fail) return { status: this.opts.fail, latencyMs: 0, error: `mock ${this.opts.fail}` };
    const src = new Set(tokenize(passages.join(" ")));
    const toks = tokenize(draft).filter((t) => !/^\d+$/.test(t) || src.has(t));
    if (!toks.length) return { status: "ok", score: 0, latencyMs: 1 };
    const covered = toks.filter((t) => src.has(t)).length / toks.length;
    // Numbers in the draft that are absent from the sources are a strong hallucination signal.
    const badNumbers = (draft.match(/\d+/g) ?? []).filter((n) => !passages.join(" ").includes(n)).length;
    return { status: "ok", score: Math.max(0, Math.min(1, covered - badNumbers * 0.25)), latencyMs: 1 };
  }
}

function toUnit(v: unknown): number | undefined {
  const n = typeof v === "number" ? v : typeof v === "object" && v ? Number((v as { score?: unknown }).score) : Number(v);
  if (!Number.isFinite(n)) return undefined;
  if (n <= 1) return Math.max(0, n);
  if (n <= 10) return n / 10;
  return Math.min(1, n / 100);
}

function toChoice(v: unknown): string | undefined {
  if (typeof v === "string") return v;
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    for (const k of ["choice", "answer", "value", "label"]) if (typeof o[k] === "string") return o[k] as string;
  }
  return undefined;
}

// TypeSafe System One. Single call per decision point, 2 s budget, no retry: a slow JEV fails closed.
export class JevProvider implements DecisionProvider {
  readonly name = "jev";
  constructor(
    private readonly apiKey: string,
    private readonly timeoutMs: number,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private async call(state: unknown, questions: Record<string, unknown>) {
    const t0 = performance.now();
    try {
      const res = await this.fetchImpl("https://api.typesafe.ai/v1/systemone", {
        method: "POST",
        headers: { Authorization: `Bearer ${this.apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ state, model: "jev-latest", questions }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      const latencyMs = Math.round(performance.now() - t0);
      if (!res.ok) return { status: "error" as const, latencyMs, error: `http ${res.status}` };
      const j = (await res.json()) as { answers?: Record<string, unknown> } & Record<string, unknown>;
      return { status: "ok" as const, latencyMs, answers: (j.answers ?? j) as Record<string, unknown> };
    } catch (e) {
      const latencyMs = Math.round(performance.now() - t0);
      const timeout = e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");
      return { status: timeout ? ("timeout" as const) : ("error" as const), latencyMs, error: String(e) };
    }
  }

  async pre(input: PreDecisionInput): Promise<PreDecision> {
    const r = await this.call(
      { customer_message: input.message, recent_turns: input.recentTurns, verified_order: input.verified },
      {
        intent: {
          type: "choice",
          instructions: "Classify the customer's latest message for a shoe store support assistant.",
          criteria: {
            policy_question: "Asks how a store policy works (returns, shipping, sizing, care, warranty, payment).",
            order_status: "Asks where an order is or what state it is in.",
            action_request: "Asks the store to do something: refund, cancel, exchange, change address, make an exception.",
            complaint: "Angry, threatening a chargeback or legal action, or a serious complaint.",
            out_of_scope: "Anything else, including medical, legal, or safety advice.",
          },
        },
        escalation: {
          type: "score",
          instructions: ESCALATION_RUBRIC,
          criteria: ["needs a human (0 to 1)"],
        },
      },
    );
    if (r.status !== "ok") return { status: r.status, latencyMs: r.latencyMs, error: r.error };
    const intent = toChoice(r.answers.intent);
    const score = toUnit(r.answers.escalation);
    if (score === undefined || !intent || !INTENTS.includes(intent as Intent)) {
      return { status: "error", latencyMs: r.latencyMs, error: "unparseable JEV answer" };
    }
    return { status: "ok", intent: intent as Intent, escalationScore: score, latencyMs: r.latencyMs };
  }

  async groundedness(draft: string, passages: string[]): Promise<GroundednessDecision> {
    const r = await this.call(
      { draft_reply: draft, retrieved_passages: passages },
      {
        grounded: {
          type: "score",
          instructions:
            "Score from 0 to 1 how fully every factual claim in draft_reply is supported by retrieved_passages. Any number, deadline, or condition not present in the passages lowers the score sharply.",
          criteria: ["supported by passages (0 to 1)"],
        },
      },
    );
    if (r.status !== "ok") return { status: r.status, latencyMs: r.latencyMs, error: r.error };
    const score = toUnit(r.answers.grounded);
    if (score === undefined) return { status: "error", latencyMs: r.latencyMs, error: "unparseable JEV answer" };
    return { status: "ok", score, latencyMs: r.latencyMs };
  }
}
