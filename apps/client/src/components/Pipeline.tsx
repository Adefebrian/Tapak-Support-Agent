import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useMemo } from "react";
import { ACTION_LABEL, type Action, type TraceEvent } from "../lib/api.ts";
import { Icon } from "./Icon.tsx";

type StageKey = "input" | "decision" | "retrieval" | "llm" | "tools" | "guard" | "output";
type StageState = "idle" | "active" | "ok" | "flag" | "skip";
type StageView = {
  key: StageKey;
  label: string;
  icon: string;
  state: StageState;
  detail: string;
  chips: string[];
  bars?: { label: string; value: number; max: number }[];
};

const STAGES: { key: StageKey; label: string; icon: string; idle: string }[] = [
  {
    key: "input",
    label: "Input guard",
    icon: "shield",
    idle: "Rules read intent, injection, and verification",
  },
  { key: "decision", label: "Decision layer", icon: "scale", idle: "JEV may add caution, never remove it" },
  { key: "retrieval", label: "Retrieval", icon: "search", idle: "BM25 over the policy knowledge base" },
  { key: "llm", label: "Model loop", icon: "spark", idle: "JSON steps checked against a schema" },
  { key: "tools", label: "Tools", icon: "wrench", idle: "Read only. No refund or cancel tool exists" },
  { key: "guard", label: "Output guard", icon: "check", idle: "Citations, personal data, false claims" },
  { key: "output", label: "Response", icon: "reply", idle: "Answer, clarify, refuse, or escalate" },
];

const RULE_STAGE: Record<string, StageKey> = {
  injection_detected: "input",
  injection_boundary: "input",
  high_priority_keywords: "input",
  action_not_automatable: "input",
  medical_or_safety_advice: "input",
  verification_incomplete: "input",
  verify_attempts_exceeded: "input",
  jev_unavailable: "decision",
  jev_escalation_score: "decision",
  groundedness_low: "decision",
  retrieval_empty: "retrieval",
  schema_invalid: "llm",
  llm_unavailable: "llm",
  tool_step_limit: "llm",
  tool_args_provenance: "tools",
  verification_failed: "tools",
  tool_error: "tools",
};

const human = (s: string) => s.replace(/_/g, " ");

// Builds the stage list from whatever events have arrived so far. While the turn is running,
// stages without events are idle; once the output event is in, they are marked skipped.
export function buildStages(events: TraceEvent[]): StageView[] {
  const done = events.some((e) => e.stage === "output");
  const by = (st: TraceEvent["stage"]) => events.filter((e) => e.stage === st);
  const guards = by("guardrail").map((e) => String(e.payload.rule));
  const guardsAt = (k: StageKey) => guards.filter((r) => (RULE_STAGE[r] ?? "guard") === k);
  const input = by("input")[0]?.payload;
  const pre = by("decision.jev").find((e) => e.payload.type === "intent+escalation")?.payload;
  const gr = by("decision.jev").find((e) => e.payload.type === "groundedness")?.payload;
  const retrieval = by("retrieval")[0]?.payload;
  const llm = by("llm");
  const tools = by("tool_call");
  const out = by("output")[0]?.payload;
  const top = (retrieval?.top_k as { doc_id: string; score: number }[] | undefined) ?? [];
  const maxScore = Math.max(1, ...top.map((t) => t.score));
  const jevOff = !pre || pre.status === "disabled";

  const seen: Record<StageKey, boolean> = {
    input: !!input,
    decision: !!pre,
    retrieval: !!retrieval,
    llm: llm.length > 0,
    tools: tools.length > 0,
    guard: done && llm.length > 0,
    output: !!out,
  };

  const orderIds = (input?.order_ids as string[] | undefined) ?? [];
  const citations = (out?.citations as string[] | undefined) ?? [];
  const llmMs = llm.reduce((s, e) => s + e.latency_ms, 0);
  const detail: Record<StageKey, string> = {
    input: input
      ? `Intent: ${human(String(input.rule_intent))}${orderIds.length ? `, order ${orderIds.join(", ")}` : ""}`
      : "",
    decision: jevOff
      ? "Off for this session"
      : `${String(pre?.status)}${pre?.escalation_score != null ? `, escalation ${Number(pre.escalation_score).toFixed(2)}` : ""}${gr?.score != null ? `, grounded ${Number(gr.score).toFixed(2)}` : ""}`,
    retrieval: retrieval
      ? top.length
        ? `${top.length} relevant document${top.length > 1 ? "s" : ""}`
        : "Nothing relevant found"
      : "Not needed for this route",
    llm: llm.length
      ? `${llm.length} step${llm.length > 1 ? "s" : ""}, ${llm.every((e) => e.payload.schema_valid) ? "valid JSON" : "schema error caught"}${llmMs > 0 ? `, ${llmMs} ms` : ""}`
      : "Not called: decided by rules",
    tools: tools.length
      ? tools.map((t) => `${String(t.payload.tool)}${t.payload.by === "code" ? " (by code)" : ""}`).join(", ")
      : "No tool needed",
    guard: llm.length
      ? guardsAt("guard").length
        ? "Draft corrected before sending"
        : "Draft passed every check"
      : "Fixed reply, no draft to check",
    output: out
      ? `${ACTION_LABEL[(out.action as Action) ?? "clarify"]}${citations.length ? `, cites ${citations.join(", ")}` : ""}`
      : "",
  };

  const firstPending = STAGES.findIndex((s) => !seen[s.key]);
  return STAGES.map((s, i) => {
    const flagged = guardsAt(s.key);
    let state: StageState;
    if (seen[s.key]) {
      const handedOff = s.key === "output" && (out?.action === "escalate" || out?.action === "refuse");
      state = flagged.length || handedOff ? "flag" : "ok";
      if (s.key === "decision" && jevOff) state = flagged.length ? "flag" : "skip";
    } else if (done) state = flagged.length ? "flag" : "skip";
    else state = events.length && i === firstPending ? "active" : "idle";
    const shown = state !== "idle" && state !== "active";
    const injection = s.key === "input" ? ((input?.injection_flags as string[] | undefined) ?? []) : [];
    return {
      key: s.key,
      label: s.label,
      icon: s.icon,
      state,
      detail: shown ? detail[s.key] : s.idle,
      chips: shown
        ? [
            ...flagged.map(human),
            ...injection.map((f) => `injection: ${human(f)}`),
            ...(s.key === "decision" && pre?.disagreement ? ["disagrees with rules"] : []),
          ]
        : [],
      bars:
        s.key === "retrieval" && shown
          ? top.map((t) => ({ label: t.doc_id, value: t.score, max: maxScore }))
          : undefined,
    };
  });
}

const NODE: Record<StageState, { bg: string; fg: string; border: string }> = {
  idle: { bg: "#ffffff", fg: "#85817a", border: "#e6e3dc" },
  active: { bg: "#fff1ea", fg: "#c2410c", border: "#ff5a1f" },
  ok: { bg: "#0b0b0c", fg: "#ffffff", border: "#0b0b0c" },
  flag: { bg: "#ff5a1f", fg: "#ffffff", border: "#ff5a1f" },
  skip: { bg: "#f7f6f3", fg: "#b3afa7", border: "#e6e3dc" },
};

export function Pipeline({ events, turnKey }: { events: TraceEvent[]; turnKey: string }) {
  const reduce = useReducedMotion();
  const stages = useMemo(() => buildStages(events), [events]);

  return (
    <ol className="stages" aria-live="polite">
      {stages.map((s, i) => {
        const style = NODE[s.state];
        const next = stages[i + 1];
        const filled = next !== undefined && next.state !== "idle" && next.state !== "active";
        const pulsing = s.state === "active" && !reduce;
        return (
          <li key={s.key} className="stage">
            <div className="stage-track">
              <motion.div
                className="stage-node"
                animate={{
                  backgroundColor: style.bg,
                  color: style.fg,
                  borderColor: style.border,
                  scale: pulsing ? [1, 1.08, 1] : 1,
                }}
                transition={
                  pulsing
                    ? { scale: { duration: 0.8, repeat: Number.POSITIVE_INFINITY }, duration: 0.2 }
                    : { duration: reduce ? 0 : 0.2 }
                }
              >
                <Icon name={s.icon} size={16} />
              </motion.div>
              {next && (
                <div className="stage-rail">
                  <motion.div
                    className="stage-rail-fill"
                    initial={false}
                    animate={{
                      scaleY: filled ? 1 : 0,
                      backgroundColor: next.state === "flag" ? "#ff5a1f" : "#0b0b0c",
                    }}
                    transition={{ duration: reduce ? 0 : 0.2 }}
                  />
                </div>
              )}
            </div>
            <div className="stage-body">
              <div className="stage-label">
                <span className={s.state === "skip" || s.state === "idle" ? "muted" : undefined}>
                  {s.label}
                </span>
                {s.state === "skip" && <span className="chip">skipped</span>}
              </div>
              <AnimatePresence mode="wait" initial={false}>
                <motion.div
                  key={`${turnKey}-${s.state}`}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: reduce ? 0 : 0.15 }}
                >
                  <div className="stage-detail">{s.detail}</div>
                  {s.chips.length > 0 && (
                    <div className="stage-chips">
                      {s.chips.map((c) => (
                        <span key={c} className={`chip ${s.state === "flag" ? "chip-orange" : ""}`}>
                          {c}
                        </span>
                      ))}
                    </div>
                  )}
                  {s.bars && s.bars.length > 0 && (
                    <div className="bars">
                      {s.bars.map((b, bi) => (
                        <div key={b.label} className="bar-row">
                          <span className="mono bar-label">{b.label}</span>
                          <div className="bar-track">
                            <motion.div
                              className={`bar-fill ${bi === 0 ? "orange" : ""}`}
                              initial={{ scaleX: 0 }}
                              animate={{ scaleX: b.value / b.max }}
                              transition={{
                                duration: reduce ? 0 : 0.5,
                                delay: reduce ? 0 : 0.08 * bi,
                                ease: [0.2, 0.8, 0.2, 1],
                              }}
                            />
                          </div>
                          <span className="mono muted bar-value">{b.value.toFixed(1)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </motion.div>
              </AnimatePresence>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

export function PipelineLegend() {
  return (
    <div className="legend">
      <span>
        <i style={{ background: "var(--ink)" }} /> passed
      </span>
      <span>
        <i style={{ background: "var(--orange)" }} /> guard fired or handed off
      </span>
      <span>
        <i style={{ background: "var(--surface-2)" }} /> skipped
      </span>
    </div>
  );
}
