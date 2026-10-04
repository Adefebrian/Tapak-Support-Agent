import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useEffect, useState } from "react";
import { type KbDoc, type OrderCard as Order, api } from "../lib/api.ts";

const STEPS = ["Paid", "Packed", "Shipped", "Delivered"] as const;

function day(iso: string | null): string {
  if (!iso) return "to be confirmed";
  const d = new Date(`${iso}T00:00:00`);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}
const STEP_OF: Record<string, number> = {
  paid: 0,
  packed: 1,
  shipped: 2,
  delivered: 3,
  returned: 3,
  lost: 2,
  cancelled: 0,
};

// Order status as a timeline that fills up to the current step when the card appears.
export function OrderCard({ order }: { order: Order }) {
  const reduce = useReducedMotion();
  const at = STEP_OF[order.status] ?? 0;
  const problem = order.status === "lost" || order.status === "cancelled";
  const note =
    order.status === "lost"
      ? "Reported lost by the carrier. Support is handling the claim."
      : order.status === "cancelled"
        ? "This order was cancelled."
        : order.status === "returned"
          ? "Returned to our warehouse."
          : order.status === "delivered"
            ? `Delivered ${day(order.delivered_at)}`
            : `Arrives by ${day(order.eta)}`;

  return (
    <div className="order-card">
      <div className="order-head">
        <span className="mono order-id">{order.order_id}</span>
        <span className={`chip ${problem ? "chip-orange" : "chip-ink"}`}>{order.status}</span>
      </div>
      <ol className="timeline" aria-label={`Order progress: ${order.status}`}>
        {STEPS.map((step, i) => {
          const done = order.status === "cancelled" ? i === 0 : i <= at;
          const flag = problem && i === at;
          return (
            <li key={step} className="timeline-step">
              <span className="timeline-bar">
                <motion.span
                  className={`timeline-fill ${flag ? "is-orange" : ""}`}
                  initial={{ scaleX: 0 }}
                  animate={{ scaleX: done ? 1 : 0 }}
                  transition={{
                    delay: reduce ? 0 : 0.1 + i * 0.22,
                    duration: reduce ? 0 : 0.35,
                    ease: [0.2, 0.8, 0.2, 1],
                  }}
                />
              </span>
              <span className={`timeline-label ${i === at ? "is-current" : ""}`}>{step}</span>
            </li>
          );
        })}
      </ol>
      <dl className="order-facts">
        <div>
          <dt>Status</dt>
          <dd>{note}</dd>
        </div>
        {order.carrier && (
          <div>
            <dt>Carrier</dt>
            <dd>
              {order.carrier}
              {order.tracking_no ? <span className="mono"> · {order.tracking_no}</span> : null}
            </dd>
          </div>
        )}
        <div>
          <dt>Items</dt>
          <dd>{order.items.map((i) => `${i.qty} x ${i.name}, EU ${i.size_eu}`).join("; ")}</dd>
        </div>
      </dl>
    </div>
  );
}

// A citation the customer can open: shows the exact policy text the answer relied on.
export function SourceChip({ id }: { id: string }) {
  const [open, setOpen] = useState(false);
  const [doc, setDoc] = useState<KbDoc | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!open || doc) return;
    api
      .kbDoc(id)
      .then(setDoc)
      .catch(() => setFailed(true));
  }, [open, doc, id]);

  return (
    <>
      <button
        type="button"
        className="chip chip-button mono"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        {id}
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            className="source"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
          >
            <div className="source-head">
              <strong>{doc?.title ?? (failed ? "Source unavailable" : "Loading source")}</strong>
              {doc && <span className="muted small">updated {doc.updated_at}</span>}
            </div>
            {doc && <SourceBody body={doc.body} />}
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

// Renders a KB page's Markdown subset: paragraphs, bullet lists, and tables. No HTML is injected.
function SourceBody({ body }: { body: string }) {
  const blocks = body
    .replace(/^#.*\n+/, "")
    .replace(/\*\*/g, "")
    .split(/\n\s*\n/)
    .map((b) => b.trim())
    .filter(Boolean);
  return (
    <div className="source-body">
      {blocks.map((b) => {
        const lines = b.split("\n").map((l) => l.trim());
        if (lines.every((l) => l.startsWith("- ")))
          return (
            <ul key={b}>
              {lines.map((l) => (
                <li key={l}>{l.slice(2)}</li>
              ))}
            </ul>
          );
        if (lines.every((l) => l.startsWith("|"))) {
          const rows = lines
            .filter((l) => !/^\|[\s|-]+\|$/.test(l))
            .map((l) =>
              l
                .split("|")
                .map((c) => c.trim())
                .filter(Boolean),
            );
          const [head, ...rest] = rows;
          return (
            <div key={b} className="table-wrap">
              <table className="source-table">
                <thead>
                  <tr>
                    {head?.map((h) => (
                      <th key={h}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rest.map((r) => (
                    <tr key={r.join("|")}>
                      {r.map((c, j) => (
                        <td key={`${j}-${c}`}>{c}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        }
        return <p key={b}>{lines.join(" ")}</p>;
      })}
    </div>
  );
}
