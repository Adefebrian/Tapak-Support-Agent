export type Action = "answer" | "clarify" | "refuse" | "escalate";

export type MessageResponse = {
  reply: string;
  action: Action;
  citations: string[];
  escalation_id: string | null;
  clarification_fields: string[];
  trace_id: string;
  meta: { latency_ms: number; guardrails_triggered: string[]; intent: string; llm: string; jev: string };
};

export type TraceEvent = {
  trace_id: string;
  turn: number;
  stage: "input" | "decision.jev" | "retrieval" | "tool_call" | "llm" | "guardrail" | "output";
  payload: Record<string, unknown>;
  latency_ms: number;
  created_at: string;
};

export type Escalation = {
  id: string;
  session_id: string;
  reason: string;
  priority: "normal" | "high";
  summary: string;
  status: "open" | "in_progress" | "resolved";
  created_at: string;
};

export type Health = { status: string; db: string; llm: string; jev: string };
export type Metrics = {
  turns: number;
  actions: Record<string, number>;
  escalation_rate: number;
  latency_ms: { p50: number; p95: number };
  guardrails: { rule: string; n: number }[];
  jev_disagreement_rate: number | null;
};

const KEY = "tapak.apiBase";

function isNativeShell(): boolean {
  return location.protocol === "tauri:" || location.hostname === "tauri.localhost";
}

// Web: same origin. Native (Tauri) shell: configurable, defaulting to the local server
// (the Android emulator reaches the host machine through 10.0.2.2).
export function defaultBase(): string {
  if (!isNativeShell()) return "";
  return /Android/i.test(navigator.userAgent) ? "http://10.0.2.2:8787" : "http://localhost:8787";
}

export function getBase(): string {
  try {
    return localStorage.getItem(KEY) ?? defaultBase();
  } catch {
    return defaultBase();
  }
}

export function setBase(v: string): void {
  try {
    if (v.trim()) localStorage.setItem(KEY, v.trim().replace(/\/$/, ""));
    else localStorage.removeItem(KEY);
  } catch {
    // storage unavailable; the default base is used
  }
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code);
  }
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${getBase()}/api/v1${path}`, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
  const body = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new ApiError(res.status, body.error ?? `http_${res.status}`);
  return body;
}

export const api = {
  health: () => req<Health>("/health"),
  metrics: () => req<Metrics>("/metrics"),
  createSession: () => req<{ session_id: string }>("/sessions", { method: "POST" }),
  send: (id: string, message: string) =>
    req<MessageResponse>(`/sessions/${id}/messages`, { method: "POST", body: JSON.stringify({ message }) }),
  sessions: () => req<{ sessions: { id: string; created_at: string; messages: number }[] }>("/sessions"),
  history: (id: string) =>
    req<{
      messages: {
        role: "user" | "assistant";
        content: string;
        action: Action | null;
        meta: { citations: string[]; escalation_id: string | null; trace_id: string } | null;
      }[];
    }>(`/sessions/${id}/messages`),
  traces: (id: string) => req<{ events: TraceEvent[] }>(`/traces/${id}`),
  escalations: () => req<{ escalations: Escalation[] }>("/escalations"),
  patchEscalation: (id: string, status: Escalation["status"]) =>
    req<Escalation>(`/escalations/${id}`, { method: "PATCH", body: JSON.stringify({ status }) }),
};

export const ACTION_LABEL: Record<Action, string> = {
  answer: "Answered",
  clarify: "Needs info",
  refuse: "Declined",
  escalate: "Escalated",
};

export function timeAgo(iso: string): string {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return new Date(iso).toLocaleDateString();
}
