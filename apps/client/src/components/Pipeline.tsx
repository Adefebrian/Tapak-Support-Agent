import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useEffect, useMemo, useState } from "react";
import { ACTION_LABEL, type Action, type TraceEvent } from "../lib/api.ts";
import { Icon } from "./Icon.tsx";

type StageKey = "input" | "decision" | "retrieval" | "llm" | "tools" | "guard" | "output";
type StageState = "idle" | "ok" | "flag" | "skip";

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
    idle: "Rules classify intent, flag injection, check verification",
  },
  {
    key: "decision",
    label: "Decision layer",
    icon: "scale",
    idle: "JEV advises intent and escalation; can only add caution",
  },
  { key: "retrieval", label: "Retrieval", icon: "search", idle: "BM25 over the policy knowledge base" },
  { key: "llm", label: "Model loop", icon: "spark", idle: "Structured JSON steps, validated by schema" },
  { key: "tools", label: "Tools", icon: "wrench", idle: "Read-only tools; no refund or cancel tool exists" },
  {
    key: "guard",
    label: "Output guard",
    icon: "check",
    idle: "Citations, PII, foreign order data, false claims",
  },
  {
    key: "output",
    label: "Response",
    icon: "reply",
    idle: "Final action: answer, clarify, refuse, or escalate",
  },
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

export function buildStages(events: TraceEvent[] | null): StageView[] {
  if (!events)
    return STAGES.map((s) => ({
      key: s.key,
      label: s.label,
      icon: s.icon,
      state: "idle",
      detail: s.idle,
      chips: [],
    }));
  const by = (st: TraceEvent["stage"]) => events.filter((e) => e.stage === st);
  const guards = by("guardrail").map((e) => String(e.payload.rule));
  const guardsAt = (k: StageKey) => guards.filter((r) => (RULE_STAGE[r] ?? "guard") === k);

  const input = by("input")[0]?.payload ?? {};
  const jev = by("decision.jev");
  const retrieval = by("retrieval")[0]?.payload;
  const llm = by("llm");
  const tools = by("tool_call");
  const out = by("output")[0]?.payload ?? {};

  const view = (key: StageKey, base: Omit<StageView, "key" | "label" | "icon">): StageView => {
    const s = STAGES.find((x) => x.key === key)!;
    const flagged = guardsAt(key);
    return {
      key,
      label: s.label,
      icon: s.icon,
      ...base,
      state: flagged.length ? "flag" : base.state,
      chips: [...flagged.map(human), ...base.chips],
    };
  };

  const pre = jev.find((e) => e.payload.type === "intent+escalation")?.payload;
  const gr = jev.find((e) => e.payload.type === "groundedness")?.payload;
  const top = (retrieval?.top_k as { doc_id: string; score: number }[] | undefined) ?? [];
  const maxScore = Math.max(1, ...top.map((t) => t.score));

  return [
    view("input", {
      state: "ok",
      detail: `Intent ${human(String(input.rule_intent ?? "unknown"))}${(input.order_ids as string[] | undefined)?.length ? `, order ${(input.order_ids as string[]).join(", ")}` : ""}`,
      chips: (input.injection_flags as string[] | undefined)?.map((f) => `injection: ${human(f)}`) ?? [],
    }),
    view("decision", {
      state: !pre || pre.status === "disabled" ? "skip" : "ok",
      detail:
        !pre || pre.status === "disabled"
          ? "JEV disabled (advisory layer off)"
          : `${String(pre.status)}${pre.escalation_score != null ? `, escalation score ${Number(pre.escalation_score).toFixed(2)}` : ""}${gr?.score != null ? `, grounded ${Number(gr.score).toFixed(2)}` : ""}`,
      chips: pre?.disagreement ? ["disagrees with rules"] : [],
    }),
    view("retrieval", {
      state: retrieval ? "ok" : "skip",
      detail: retrieval
        ? top.length
          ? `${top.length} document${top.length > 1 ? "s" : ""} above threshold`
          : "Nothing relevant found"
        : "Not needed for this route",
      chips: [],
      bars: top.map((t) => ({ label: t.doc_id, value: t.score, max: maxScore })),
    }),
    view("llm", {
      state: llm.length ? "ok" : "skip",
      detail: llm.length
        ? `${llm.length} step${llm.length > 1 ? "s" : ""}, ${llm.every((e) => e.payload.schema_valid) ? "schema valid" : "schema error caught"}`
        : "Skipped: decided deterministically",
      chips: [],
    }),
    view("tools", {
      state: tools.length ? "ok" : "skip",
      detail: tools.length
        ? tools
            .map((t) => `${String(t.payload.tool)}${t.payload.by === "code" ? " (by code)" : ""}`)
            .join(", ")
        : "No tool call",
      chips: [],
    }),
    view("guard", {
      state: llm.length ? "ok" : "skip",
      detail: llm.length
        ? guardsAt("guard").length
          ? "Draft corrected before sending"
          : "Draft passed every check"
        : "Templated reply, no model draft",
      chips: [],
    }),
    view("output", {
      state: out.action === "escalate" || out.action === "refuse" ? "flag" : "ok",
      detail: `${ACTION_LABEL[(out.action as Action) ?? "clarify"]}${(out.citations as string[] | undefined)?.length ? `, cites ${(out.citations as string[]).join(", ")}` : ""}`,
      chips: [],
    }),
  ];
}

const NODE_STYLE: Record<StageState, { bg: string; fg: string; border: string }> = {
  idle: { bg: "#ffffff", fg: "#85817a", border: "#e6e3dc" },
  ok: { bg: "#0b0b0c", fg: "#ffffff", border: "#0b0b0c" },
  flag: { bg: "#ff5a1f", fg: "#ffffff", border: "#ff5a1f" },
  skip: { bg: "#f7f6f3", fg: "#b3afa7", border: "#e6e3dc" },
};

export function Pipeline({
  events,
  pending,
  turnKey,
}: { events: TraceEvent[] | null; pending: boolean; turnKey: string }) {
  const reduce = useReducedMotion();
  const stages = useMemo(() => buildStages(events), [events]);
  const [revealed, setRevealed] = useState(events ? stages.length : 0);
  const [scan, setScan] = useState(0);

  // While waiting, a scanner walks the stages to show the turn is in flight.
  useEffect(() => {
    if (!pending) return;
    setScan(0);
    const id = setInterval(() => setScan((s) => (s + 1) % STAGES.length), reduce ? 900 : 320);
    return () => clearInterval(id);
  }, [pending, reduce]);

  // When a trace arrives, replay the stages in order. turnKey restarts the replay for a new turn.
  // biome-ignore lint/correctness/useExhaustiveDependencies: turnKey is the intended trigger
  useEffect(() => {
    if (!events) {
      setRevealed(0);
      return;
    }
    if (reduce) {
      setRevealed(stages.length);
      return;
    }
    setRevealed(0);
    let i = 0;
    const id = setInterval(() => {
      i++;
      setRevealed(i);
      if (i >= stages.length) clearInterval(id);
    }, 230);
    return () => clearInterval(id);
  }, [turnKey, events, stages.length, reduce]);

  return (
    <ol className="stages" aria-live="polite">
      {stages.map((s, i) => {
        const shown = events ? i < revealed : false;
        const scanning = pending && scan === i;
        const st: StageState = shown ? s.state : "idle";
        const style = scanning ? { bg: "#fff1ea", fg: "#c2410c", border: "#ff5a1f" } : NODE_STYLE[st];
        const last = i === stages.length - 1;
        return (
          <li key={s.key} className="stage">
            <div className="stage-track">
              <motion.div
                className="stage-node"
                animate={{
                  backgroundColor: style.bg,
                  color: style.fg,
                  borderColor: style.border,
                  scale: scanning ? 1.08 : 1,
                }}
                transition={{ duration: reduce ? 0 : 0.22 }}
              >
                <Icon name={s.icon} size={16} />
              </motion.div>
              {!last && (
                <div className="stage-rail">
                  <motion.div
                    className="stage-rail-fill"
                    initial={false}
                    animate={{
                      scaleY: shown && i + 1 < revealed ? 1 : 0,
                      backgroundColor: stages[i + 1]?.state === "flag" ? "#ff5a1f" : "#0b0b0c",
                    }}
                    transition={{ duration: reduce ? 0 : 0.22 }}
                  />
                </div>
              )}
            </div>
            <div className="stage-body">
              <div className="stage-label">
                <span style={{ color: st === "skip" ? "var(--ink-3)" : undefined }}>{s.label}</span>
                {shown && st === "skip" && <span className="chip">skipped</span>}
              </div>
              <AnimatePresence mode="wait" initial={false}>
                <motion.div
                  key={shown ? `${turnKey}-on` : "off"}
                  initial={{ opacity: 0, y: reduce ? 0 : 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: reduce ? 0 : 0.2 }}
                >
                  <div className="stage-detail">{shown ? s.detail : STAGES[i]!.idle}</div>
                  {shown && s.chips.length > 0 && (
                    <div className="stage-chips">
                      {s.chips.map((c) => (
                        <span key={c} className={`chip ${s.state === "flag" ? "chip-orange" : ""}`}>
                          {c}
                        </span>
                      ))}
                    </div>
                  )}
                  {shown &&
                    s.bars?.map((b, bi) => (
                      <div key={b.label} className="bar-row">
                        <div>
                          <div className="mono" style={{ marginBottom: 3 }}>
                            {b.label}
                          </div>
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
                        </div>
                        <span className="mono muted" style={{ textAlign: "right" }}>
                          {b.value.toFixed(1)}
                        </span>
                      </div>
                    ))}
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
