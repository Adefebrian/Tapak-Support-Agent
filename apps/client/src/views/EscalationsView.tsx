import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useCallback, useEffect, useState } from "react";
import { Icon } from "../components/Icon.tsx";
import { type Escalation, api, timeAgo } from "../lib/api.ts";

const STATUSES: Escalation["status"][] = ["open", "in_progress", "resolved"];
const FILTERS = ["active", "high", "resolved", "all"] as const;
type Filter = (typeof FILTERS)[number];

function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
}: { value: T; options: readonly T[]; onChange: (v: T) => void; label: string }) {
  return (
    <div className="segmented" role="group" aria-label={label}>
      {options.map((o) => (
        <button type="button" key={o} aria-pressed={value === o} onClick={() => onChange(o)}>
          {o.replace(/_/g, " ")}
        </button>
      ))}
    </div>
  );
}

export function EscalationsView() {
  const reduce = useReducedMotion();
  const [items, setItems] = useState<Escalation[]>([]);
  const [filter, setFilter] = useState<Filter>("active");
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    try {
      setItems((await api.escalations()).escalations);
      setError(false);
    } catch {
      setError(true);
    }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, 5000);
    return () => clearInterval(id);
  }, [load]);

  const update = async (id: string, status: Escalation["status"]) => {
    setItems((xs) => xs.map((x) => (x.id === id ? { ...x, status } : x)));
    try {
      await api.patchEscalation(id, status);
    } catch {
      load();
    }
  };

  const shown = items.filter((e) =>
    filter === "all"
      ? true
      : filter === "resolved"
        ? e.status === "resolved"
        : filter === "high"
          ? e.priority === "high" && e.status !== "resolved"
          : e.status !== "resolved",
  );
  const open = items.filter((e) => e.status !== "resolved");

  return (
    <div>
      <div className="page-head">
        <div>
          <h1 className="h1">Escalation queue</h1>
          <p className="lede">
            Every action the agent is not allowed to take lands here with its reason. The agent never refunds,
            cancels, or edits an order.
          </p>
        </div>
        <button type="button" className="btn btn-ghost" onClick={load}>
          <Icon name="refresh" size={16} /> Refresh
        </button>
      </div>

      <div className="kpis">
        <div className="kpi">
          <div className="kpi-label">Open tickets</div>
          <div className="kpi-value">{open.length}</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">High priority open</div>
          <div className="kpi-value orange">{open.filter((e) => e.priority === "high").length}</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">In progress</div>
          <div className="kpi-value">{items.filter((e) => e.status === "in_progress").length}</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Resolved</div>
          <div className="kpi-value">{items.filter((e) => e.status === "resolved").length}</div>
        </div>
      </div>

      <div style={{ marginBottom: 16 }}>
        <Segmented label="Filter tickets" value={filter} options={FILTERS} onChange={setFilter} />
      </div>

      {error && (
        <div className="error-banner" role="alert" style={{ margin: "0 0 16px" }}>
          Cannot load the queue. Is the server running?
        </div>
      )}

      <div className="esc-list">
        <AnimatePresence initial={false} mode="popLayout">
          {shown.map((e) => (
            <motion.article
              layout={!reduce}
              key={e.id}
              className="panel esc"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.22 }}
            >
              <div className="esc-top">
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", minWidth: 0 }}>
                  <span className={`chip ${e.priority === "high" ? "chip-orange" : ""}`}>
                    {e.priority === "high" ? "High priority" : "Normal"}
                  </span>
                  <span className="chip mono">{e.reason}</span>
                  <span className="muted" style={{ fontSize: 13 }}>
                    {timeAgo(e.created_at)}
                  </span>
                </div>
                <Segmented
                  label="Ticket status"
                  value={e.status}
                  options={STATUSES}
                  onChange={(s) => update(e.id, s)}
                />
              </div>
              <p className="esc-summary">{e.summary}</p>
              <div className="muted mono" style={{ fontSize: 12, overflowWrap: "anywhere" }}>
                {e.id} · session {e.session_id}
              </div>
            </motion.article>
          ))}
        </AnimatePresence>
        {shown.length === 0 && !error && (
          <div className="panel empty">
            No tickets here. Try a refund request or a chargeback threat in the chat.
          </div>
        )}
      </div>
    </div>
  );
}
