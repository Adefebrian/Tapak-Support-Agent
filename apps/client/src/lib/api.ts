export type Action = "answer" | "clarify" | "refuse" | "escalate";

export type MessageResponse = {
  reply: string;
  action: Action;
  citations: string[];
  escalation_id: string | null;
  suggestions: string[];
  order: OrderCard | null;
  clarification_fields: string[];
  trace_id: string;
  meta: { latency_ms: number; guardrails_triggered: string[]; intent: string; llm: string; jev: string };
};

export type OrderCard = {
  order_id: string;
  status: string;
  eta: string | null;
  delivered_at: string | null;
  carrier: string | null;
  tracking_no: string | null;
  items: { name: string; size_eu: number; qty: number }[];
};

export type KbDoc = { id: string; title: string; updated_at: string; status: string; body: string };

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

export type Health = { status: string; db: string; llm: string; jev: string; live_mode_available: boolean };

// Live mode: keys travel once, in the session-creation request, and are held only by the server.
export type LiveConfig = {
  llm?: { provider: "openai" | "anthropic"; api_key: string; model?: string };
  jev?: { api_key: string };
};
export type Metrics = {
  turns: number;
  actions: Record<string, number>;
  escalation_rate: number;
  clarify_rate: number;
  latency_ms: { p50: number; p95: number };
  stage_latency_ms: Record<string, { p50: number; p95: number; n: number }>;
  guardrails: { rule: string; n: number; per_turn: number }[];
  llm_schema_failure_rate: number | null;
  retrieval_empty_rate: number | null;
  tokens_per_session: number;
  jev_disagreement_rate: number | null;
  jev_timeout_rate: number | null;
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
  createSession: (live?: LiveConfig | null) =>
    req<{ session_id: string; mode: string }>("/sessions", {
      method: "POST",
      body: live ? JSON.stringify(live) : undefined,
    }),
  // Server-sent events over a POST: each trace stage as it happens, then the final result.
  stream: async (id: string, message: string, onStage: (e: TraceEvent) => void): Promise<MessageResponse> => {
    const res = await fetch(`${getBase()}/api/v1/sessions/${id}/messages/stream`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message }),
    });
    if (!res.ok || !res.body) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      throw new ApiError(res.status, body.error ?? `http_${res.status}`);
    }
    const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
    let buf = "";
    let result: MessageResponse | null = null;
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += value;
      let cut = buf.indexOf("\n\n");
      while (cut >= 0) {
        const block = buf.slice(0, cut);
        buf = buf.slice(cut + 2);
        const event = block.match(/^event: (.*)$/m)?.[1];
        const data = block.match(/^data: (.*)$/m)?.[1];
        if (event && data) {
          if (event === "stage") onStage(JSON.parse(data) as TraceEvent);
          if (event === "result") result = JSON.parse(data) as MessageResponse;
          if (event === "error") throw new ApiError(500, "internal_error");
        }
        cut = buf.indexOf("\n\n");
      }
    }
    if (!result) throw new ApiError(500, "stream_ended");
    return result;
  },
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
  kbDoc: (id: string) => req<KbDoc>(`/kb/${encodeURIComponent(id)}`),
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
