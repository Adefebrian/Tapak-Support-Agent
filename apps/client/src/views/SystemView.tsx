import { motion, useReducedMotion } from "framer-motion";
import { useEffect, useMemo, useRef, useState } from "react";

type NodeId = "customer" | "input" | "jev" | "retrieval" | "model" | "tools" | "guard" | "reply" | "queue";
type Pt = [number, number];
type Layout = {
  w: number;
  h: number;
  nw: number;
  nh: number;
  nodes: Record<NodeId, Pt>;
  edges: Record<string, Pt[]>;
  labels: [number, number, string][];
};

const NODE_TEXT: Record<NodeId, [string, string]> = {
  customer: ["Customer", "web, desktop, Android"],
  input: ["Input guard", "deterministic rules"],
  jev: ["JEV", "advisory, fail closed"],
  retrieval: ["Retrieval", "BM25 over KB"],
  model: ["Model loop", "JSON steps, Zod"],
  tools: ["Tools", "read only"],
  guard: ["Output guard", "deterministic"],
  reply: ["Reply", "answer, clarify, refuse"],
  queue: ["Escalation queue", "human support"],
};

// Two hand-placed layouts so labels stay readable on phones instead of shrinking a wide diagram.
const WIDE: Layout = {
  w: 1060,
  h: 430,
  nw: 140,
  nh: 56,
  nodes: {
    customer: [85, 215],
    input: [255, 215],
    jev: [425, 85],
    retrieval: [425, 215],
    model: [595, 215],
    tools: [595, 340],
    guard: [765, 215],
    reply: [975, 135],
    queue: [975, 295],
  },
  edges: {
    "customer-input": [
      [155, 215],
      [185, 215],
    ],
    "input-jev": [
      [240, 187],
      [240, 85],
      [355, 85],
    ],
    "input-retrieval": [
      [325, 215],
      [355, 215],
    ],
    "retrieval-model": [
      [495, 215],
      [525, 215],
    ],
    "model-tools": [
      [595, 243],
      [595, 312],
    ],
    "model-guard": [
      [665, 215],
      [695, 215],
    ],
    "guard-reply": [
      [835, 205],
      [870, 205],
      [870, 135],
      [905, 135],
    ],
    "guard-queue": [
      [835, 225],
      [870, 225],
      [870, 295],
      [905, 295],
    ],
    "input-queue": [
      [255, 243],
      [255, 400],
      [975, 400],
      [975, 323],
    ],
    "input-reply": [
      [270, 187],
      [270, 32],
      [975, 32],
      [975, 107],
    ],
  },
  labels: [
    [620, 22, "deterministic reply, model skipped"],
    [620, 420, "forced escalation, model skipped"],
  ],
};

const NARROW: Layout = {
  w: 400,
  h: 660,
  nw: 130,
  nh: 52,
  nodes: {
    customer: [150, 40],
    input: [150, 150],
    jev: [320, 150],
    retrieval: [150, 260],
    model: [150, 370],
    tools: [320, 370],
    guard: [150, 480],
    reply: [150, 610],
    queue: [320, 610],
  },
  edges: {
    "customer-input": [
      [150, 66],
      [150, 124],
    ],
    "input-jev": [
      [215, 150],
      [255, 150],
    ],
    "input-retrieval": [
      [150, 176],
      [150, 234],
    ],
    "retrieval-model": [
      [150, 286],
      [150, 344],
    ],
    "model-tools": [
      [215, 370],
      [255, 370],
    ],
    "model-guard": [
      [150, 396],
      [150, 454],
    ],
    "guard-reply": [
      [150, 506],
      [150, 584],
    ],
    "guard-queue": [
      [215, 490],
      [320, 490],
      [320, 584],
    ],
    "input-queue": [
      [215, 166],
      [236, 166],
      [236, 540],
      [320, 540],
      [320, 584],
    ],
    "input-reply": [
      [85, 150],
      [30, 150],
      [30, 610],
      [85, 610],
    ],
  },
  labels: [],
};

type Scenario = { id: string; title: string; route: NodeId[]; flag: NodeId[]; caption: string };

const SCENARIOS: Scenario[] = [
  {
    id: "policy",
    title: "Policy question",
    route: ["customer", "input", "retrieval", "model", "guard", "reply"],
    flag: [],
    caption:
      "Retrieval runs before the model. The model must cite a document retrieved in this turn, or the output guard downgrades the answer to a clarification.",
  },
  {
    id: "order",
    title: "Order lookup",
    route: ["customer", "input", "retrieval", "model", "tools", "model", "guard", "reply"],
    flag: [],
    caption:
      "get_order only returns data when the order ID and email typed by the customer both match. Not found and wrong email produce the same reply, so orders cannot be enumerated.",
  },
  {
    id: "refund",
    title: "Refund request",
    route: ["customer", "input", "queue"],
    flag: ["input", "queue"],
    caption:
      "No refund or cancel tool exists. The input guard routes the request straight to a ticket, and the model is never asked.",
  },
  {
    id: "injection",
    title: "Prompt injection",
    route: ["customer", "input", "reply"],
    flag: ["input"],
    caption:
      "Injection patterns are flagged in the trace. Without a real order lookup the turn gets a fixed boundary reply instead of a best effort answer.",
  },
  {
    id: "advisory",
    title: "JEV advises",
    route: ["customer", "input", "jev", "input", "retrieval", "model", "guard", "reply"],
    flag: ["jev"],
    caption:
      "JEV scores intent and escalation risk. Its signal is merged one way only: it can push a turn toward escalation, never unlock data. A timeout escalates.",
  },
  {
    id: "blocked",
    title: "Bad draft blocked",
    route: ["customer", "input", "retrieval", "model", "guard", "queue"],
    flag: ["guard", "queue"],
    caption:
      "A draft with PII, another order's data, an uncited policy claim, or a claim like 'I refunded you' is blocked by code and handed to a human.",
  },
];

function edgePoints(L: Layout, a: NodeId, b: NodeId): Pt[] {
  const fwd = L.edges[`${a}-${b}`];
  if (fwd) return fwd;
  const back = L.edges[`${b}-${a}`];
  return back ? [...back].reverse() : [L.nodes[a], L.nodes[b]];
}

function routePoints(L: Layout, route: NodeId[]) {
  const pts: Pt[] = [];
  const arrive: number[] = [0];
  for (let i = 0; i < route.length - 1; i++) {
    const seg = edgePoints(L, route[i]!, route[i + 1]!);
    pts.push(...seg);
    arrive.push(pts.length - 1);
  }
  let len = 0;
  const cum = [0];
  for (let i = 1; i < pts.length; i++) {
    len += Math.hypot(pts[i]![0] - pts[i - 1]![0], pts[i]![1] - pts[i - 1]![1]);
    cum.push(len);
  }
  const times = cum.map((c) => (len ? c / len : 0));
  return { pts, times, len, arriveAt: arrive.map((idx, i) => (i === 0 ? 0 : (times[idx] ?? 1))) };
}

function useNarrow() {
  const q = "(max-width: 720px)";
  const [n, setN] = useState(() => typeof window !== "undefined" && window.matchMedia(q).matches);
  useEffect(() => {
    const m = window.matchMedia(q);
    const on = () => setN(m.matches);
    m.addEventListener("change", on);
    return () => m.removeEventListener("change", on);
  }, []);
  return n;
}

const C = {
  ink: "#0b0b0c",
  line: "#e6e3dc",
  lineStrong: "#d6d2c9",
  muted: "#85817a",
  orange: "#ff5a1f",
  orangeSoft: "#fff1ea",
  white: "#ffffff",
  subOn: "#c9c6bf",
};

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function pointAt(pts: Pt[], times: number[], t: number): Pt {
  for (let i = 1; i < pts.length; i++) {
    if (t <= times[i]!) {
      const span = times[i]! - times[i - 1]! || 1;
      const k = (t - times[i - 1]!) / span;
      return [
        pts[i - 1]![0] + (pts[i]![0] - pts[i - 1]![0]) * k,
        pts[i - 1]![1] + (pts[i]![1] - pts[i - 1]![1]) * k,
      ];
    }
  }
  return pts[pts.length - 1]!;
}

// Drawn on a single canvas: nodes, routes, and a packet that travels the real route of the turn.
// The packet is painted before the nodes so it slides behind each box rather than over its label.
function FlowDiagram({ scenario, onDone }: { scenario: Scenario; onDone: () => void }) {
  const reduce = useReducedMotion();
  const L = useNarrow() ? NARROW : WIDE;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { pts, times, len, arriveAt } = useMemo(() => routePoints(L, scenario.route), [L, scenario]);
  const duration = Math.max(1.6, len / 260) * 1000;

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = L.w * dpr;
    canvas.height = L.h * dpr;
    const routeEdges = new Set(
      scenario.route.slice(1).map((b, i) => [scenario.route[i]!, b].sort().join("|")),
    );
    const font = getComputedStyle(document.body).fontFamily;
    let raf = 0;
    let done = false;
    const t0 = performance.now();

    const draw = (now: number) => {
      const elapsed = reduce ? duration : now - t0;
      const t = Math.min(1, elapsed / duration);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, L.w, L.h);
      ctx.lineJoin = "round";

      for (const [k, p] of Object.entries(L.edges)) {
        const on = routeEdges.has(k.split("-").sort().join("|"));
        const reached = on && scenario.route.some((n, i) => i > 0 && arriveAt[i]! <= t && k.includes(n));
        ctx.setLineDash(k.includes("jev") ? [5, 5] : []);
        ctx.strokeStyle = on ? (reached ? C.ink : C.lineStrong) : C.line;
        ctx.lineWidth = on ? 2 : 1.5;
        ctx.beginPath();
        p.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
        ctx.stroke();
      }
      ctx.setLineDash([]);

      ctx.font = `400 11px ${font}`;
      ctx.fillStyle = C.muted;
      ctx.textAlign = "center";
      for (const [x, y, text] of L.labels) ctx.fillText(text, x, y);

      if (!reduce && t < 1) {
        const [px, py] = pointAt(pts, times, t);
        ctx.beginPath();
        ctx.arc(px, py, 7, 0, Math.PI * 2);
        ctx.fillStyle = C.orange;
        ctx.fill();
        ctx.lineWidth = 2.5;
        ctx.strokeStyle = C.white;
        ctx.stroke();
      }

      for (const id of Object.keys(L.nodes) as NodeId[]) {
        const [cx, cy] = L.nodes[id];
        const idx = scenario.route.indexOf(id);
        const on = idx >= 0 && arriveAt[idx]! <= t + 1e-6;
        const flag = on && scenario.flag.includes(id);
        // Brief pop as the packet arrives.
        const since = idx >= 0 ? (t - arriveAt[idx]!) * duration : -1;
        const pop =
          !reduce && on && since >= 0 && since < 260 ? 1 + 0.06 * Math.sin((since / 260) * Math.PI) : 1;
        const w = L.nw * pop;
        const h = L.nh * pop;
        roundRect(ctx, cx - w / 2, cy - h / 2, w, h, 12);
        ctx.fillStyle = flag ? C.orange : on ? C.ink : C.white;
        ctx.fill();
        ctx.setLineDash(id === "jev" && !on ? [5, 4] : []);
        ctx.strokeStyle = on ? (flag ? C.orange : C.ink) : id === "jev" ? C.lineStrong : C.line;
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = on ? C.white : C.ink;
        ctx.font = `600 14px ${font}`;
        ctx.fillText(NODE_TEXT[id][0], cx, cy - 2);
        ctx.fillStyle = on ? (flag ? C.orangeSoft : C.subOn) : C.muted;
        ctx.font = `400 11px ${font}`;
        ctx.fillText(NODE_TEXT[id][1], cx, cy + 15);
      }

      if (t < 1) raf = requestAnimationFrame(draw);
      else if (!done) {
        done = true;
        raf = window.setTimeout(onDone, reduce ? 4000 : 2200) as unknown as number;
      }
    };
    raf = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(raf);
    };
  }, [L, scenario, pts, times, arriveAt, duration, reduce, onDone]);

  return (
    <canvas
      ref={canvasRef}
      className="flow-svg"
      style={{ aspectRatio: `${L.w} / ${L.h}` }}
      role="img"
      aria-label={`Flow for ${scenario.title}: ${scenario.route.join(" to ")}. ${scenario.caption}`}
    />
  );
}

const BOUNDARY: [string, string, string][] = [
  ["Answer a policy question from the KB with a citation", "Automatic", "Citation validator + groundedness"],
  ["Show order status after order ID and email both match", "Automatic", "get_order in code"],
  [
    "Show an order without full verification",
    "Never, ask for details",
    "get_order refuses; identical error text",
  ],
  ["Refund, cancel, change address, exchange", "Escalate", "The tools do not exist"],
  ["Policy exception (late return, worn item)", "Escalate", "Input rules + JEV rubric"],
  ["Medical, legal, product safety advice", "Refuse, offer a human", "Input rules + prompt"],
  ["Chargeback, legal threat, strong anger", "Escalate, high priority", "Keyword rules + JEV score"],
  ["Question outside the KB", "Clarify, never guess", "Empty retrieval forces clarify"],
  [
    "Instructions hidden in a customer message",
    "Ignored, flagged in trace",
    "No tool to abuse + boundary reply",
  ],
];

export function SystemView() {
  const [idx, setIdx] = useState(0);
  const [auto, setAuto] = useState(true);
  const [run, setRun] = useState(0);
  const scenario = SCENARIOS[idx]!;

  const next = useMemo(
    () => () => {
      if (auto) setIdx((i) => (i + 1) % SCENARIOS.length);
      else setRun((r) => r + 1);
    },
    [auto],
  );

  return (
    <div>
      <div className="page-head">
        <div>
          <h1 className="h1">How a turn flows</h1>
          <p className="lede">
            One agent, one manual tool loop, between two deterministic guards. The model and JEV can only make
            a turn more careful. Pick a path to watch it.
          </p>
        </div>
      </div>

      <div className="system-grid">
        <section className="panel" aria-label="Animated architecture">
          <div className="flow-controls" role="group" aria-label="Scenario">
            {SCENARIOS.map((s, i) => (
              <button
                type="button"
                key={s.id}
                className={`btn ${i === idx ? "" : "btn-ghost"}`}
                aria-pressed={i === idx}
                onClick={() => {
                  setAuto(false);
                  setIdx(i);
                  setRun((r) => r + 1);
                }}
              >
                {s.title}
              </button>
            ))}
            {!auto && (
              <button type="button" className="btn btn-ghost" onClick={() => setAuto(true)}>
                Auto play
              </button>
            )}
          </div>
          <div className="flow-wrap">
            <FlowDiagram key={`${scenario.id}-${run}`} scenario={scenario} onDone={next} />
          </div>
          <motion.p
            key={scenario.id}
            className="flow-caption"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.3 }}
          >
            <strong>{scenario.title}.</strong> {scenario.caption}
          </motion.p>
        </section>

        <section className="panel" aria-label="Control boundary">
          <div className="panel-head">
            <div>
              <h2 className="panel-title">Control boundary</h2>
              <p className="panel-sub">
                What is safe to automate, and what enforces it. Enforcement is code, not prompt.
              </p>
            </div>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Situation</th>
                  <th>Decision</th>
                  <th>Enforced by</th>
                </tr>
              </thead>
              <tbody>
                {BOUNDARY.map(([a, b, c]) => (
                  <tr key={a}>
                    <td>{a}</td>
                    <td>
                      <span className={`chip ${b.startsWith("Automatic") ? "chip-ink" : "chip-orange"}`}>
                        {b}
                      </span>
                    </td>
                    <td className="muted">{c}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  );
}
