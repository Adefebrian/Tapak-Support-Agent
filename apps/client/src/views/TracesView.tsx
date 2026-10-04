import { motion, useReducedMotion } from "framer-motion";
import { useEffect, useMemo, useState } from "react";
import { Icon } from "../components/Icon.tsx";
import {
  ACTION_LABEL,
  type Action,
  type Metrics,
  type TraceEvent,
  api,
  getBase,
  timeAgo,
} from "../lib/api.ts";

function summarize(e: TraceEvent): string {
  const { at_ms: _at, ...p } = e.payload;
  return JSON.stringify(p)
    .replace(/^\{|\}$/g, "")
    .replace(/"([a-z_]+)":/g, "$1: ")
    .replace(/,(?=[a-z_]+: )/g, ", ");
}

const pct = (v: number | null | undefined) =>
  v === null || v === undefined ? "n/a" : `${Math.round(v * 100)}%`;

export function TracesView() {
  const reduce = useReducedMotion();
  const [sessions, setSessions] = useState<{ id: string; created_at: string; messages: number }[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const [events, setEvents] = useState<TraceEvent[]>([]);
  const [metrics, setMetrics] = useState<Metrics | null>(null);

  useEffect(() => {
    api
      .sessions()
      .then((r) => {
        setSessions(r.sessions);
        setActive((a) => a ?? r.sessions[0]?.id ?? null);
      })
      .catch(() => setSessions([]));
    api
      .metrics()
      .then(setMetrics)
      .catch(() => setMetrics(null));
  }, []);

  useEffect(() => {
    if (!active) return;
    api
      .traces(active)
      .then((r) => setEvents(r.events))
      .catch(() => setEvents([]));
  }, [active]);

  const turns = useMemo(() => {
    const m = new Map<number, TraceEvent[]>();
    for (const e of events) m.set(e.turn, [...(m.get(e.turn) ?? []), e]);
    return [...m.entries()];
  }, [events]);

  const maxGuard = Math.max(1, ...(metrics?.guardrails.map((g) => g.n) ?? [1]));
  const kpis: [string, string, boolean?][] = metrics
    ? [
        ["Turns recorded", String(metrics.turns)],
        ["Escalation rate", pct(metrics.escalation_rate), true],
        ["Clarify rate", pct(metrics.clarify_rate)],
        ["Latency p95", `${metrics.latency_ms.p95} ms`],
        ["Schema failures", pct(metrics.llm_schema_failure_rate)],
        ["Empty retrieval", pct(metrics.retrieval_empty_rate)],
        ["Tokens per session", String(metrics.tokens_per_session)],
        ["JEV disagreement", pct(metrics.jev_disagreement_rate)],
      ]
    : [];

  return (
    <div className="page">
      <div className="page-head">
        <div className="page-head-text">
          <h1 className="h1">Traces</h1>
          <p className="lede">
            Every turn can be rebuilt from its trace: what came in, what was retrieved, which tools ran, which
            guard fired, and why. Personal data is redacted before anything is written.
          </p>
        </div>
      </div>

      {metrics && (
        <div className="kpis kpis-8">
          {kpis.map(([label, value, orange]) => (
            <div className="kpi" key={label}>
              <div className="kpi-label">{label}</div>
              <div className={`kpi-value ${orange ? "orange" : ""}`}>{value}</div>
            </div>
          ))}
        </div>
      )}

      {metrics && metrics.guardrails.length > 0 && (
        <section className="panel" aria-label="Guardrails fired">
          <div className="panel-head">
            <h2 className="panel-title">Guardrails fired</h2>
            <span className="muted small">count across all turns</span>
          </div>
          <div className="guard-bars">
            {metrics.guardrails.map((g, i) => (
              <div key={g.rule} className="guard-row">
                <span className="mono guard-name">{g.rule}</span>
                <div className="bar-track">
                  <motion.div
                    className={`bar-fill ${i === 0 ? "orange" : ""}`}
                    initial={{ scaleX: 0 }}
                    animate={{ scaleX: g.n / maxGuard }}
                    transition={{
                      duration: reduce ? 0 : 0.6,
                      delay: reduce ? 0 : i * 0.05,
                      ease: [0.2, 0.8, 0.2, 1],
                    }}
                  />
                </div>
                <span className="mono muted bar-value">{g.n}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      <div className="trace-grid">
        <section className="panel" aria-label="Sessions">
          <div className="panel-head">
            <h2 className="panel-title">Sessions</h2>
            <span className="muted small">{sessions.length}</span>
          </div>
          <div className="session-list">
            {sessions.length === 0 && <div className="empty">No conversations yet.</div>}
            {sessions.map((s) => (
              <button
                type="button"
                key={s.id}
                className="session-item"
                aria-current={s.id === active}
                onClick={() => setActive(s.id)}
              >
                <span className="mono ellipsis">{s.id}</span>
                <span className="muted small nowrap">{timeAgo(s.created_at)}</span>
              </button>
            ))}
          </div>
        </section>

        <section className="panel" aria-label="Turn timeline">
          <div className="panel-head">
            <h2 className="panel-title">Turn timeline</h2>
            {active && (
              <a
                className="chip mono"
                href={`${getBase()}/api/v1/traces/${active}`}
                target="_blank"
                rel="noreferrer"
              >
                <Icon name="search" size={14} /> raw JSON
              </a>
            )}
          </div>
          {turns.length === 0 && <div className="empty">Select a session to see its trace.</div>}
          {turns.map(([turn, evs]) => {
            const out = evs.find((e) => e.stage === "output")?.payload;
            return (
              <div key={turn} className="turn">
                <div className="turn-head">
                  <strong>Turn {turn}</strong>
                  <div className="chip-row">
                    {out && (
                      <span
                        className={`chip ${out.action === "escalate" || out.action === "refuse" ? "chip-orange" : "chip-ink"}`}
                      >
                        {ACTION_LABEL[out.action as Action]}
                      </span>
                    )}
                    <span className="chip mono">{evs[0]?.trace_id}</span>
                  </div>
                </div>
                <div className="waterfall">
                  {evs.map((e, i) => (
                    <motion.div
                      key={`${e.trace_id}-${i}`}
                      className="wf-row"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      transition={{ delay: reduce ? 0 : i * 0.03, duration: 0.2 }}
                    >
                      <span className={`wf-stage ${e.stage === "guardrail" ? "flag" : ""}`}>
                        {e.stage}
                        {e.latency_ms > 0 ? ` ${e.latency_ms}ms` : ""}
                      </span>
                      <span className="wf-payload">{summarize(e)}</span>
                    </motion.div>
                  ))}
                </div>
              </div>
            );
          })}
        </section>
      </div>
    </div>
  );
}
