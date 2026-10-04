import { describe, expect, test } from "bun:test";
import { MessageResponseSchema } from "../src/agent/schema.ts";
import { createApp, RateLimiter } from "../src/http/app.ts";
import { harness } from "./helpers.ts";

function app(rateLimiter?: RateLimiter) {
  const h = harness();
  return { h, app: createApp({ ...h.deps, rateLimiter }) };
}

async function newSession(a: ReturnType<typeof createApp>) {
  const r = await a.request("/api/v1/sessions", { method: "POST" });
  return ((await r.json()) as { session_id: string }).session_id;
}

function send(a: ReturnType<typeof createApp>, id: string, message: unknown) {
  return a.request(`/api/v1/sessions/${id}/messages`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ message }),
  });
}

describe("API contract", () => {
  test("message response matches the schema and carries x-trace-id", async () => {
    const { app: a } = app();
    const id = await newSession(a);
    const r = await send(a, id, "How long is the return window?");
    expect(r.status).toBe(200);
    const body = MessageResponseSchema.parse(await r.json());
    expect(r.headers.get("x-trace-id")).toBe(body.trace_id);
  });

  test("unknown session is 404, malformed id is 404", async () => {
    const { app: a } = app();
    expect((await send(a, "ses_00000000000000000000", "hi")).status).toBe(404);
    expect((await send(a, "../etc", "hi")).status).toBe(404);
  });

  test("empty message is 400, over 2000 chars is 413", async () => {
    const { app: a } = app();
    const id = await newSession(a);
    expect((await send(a, id, "   ")).status).toBe(400);
    expect((await send(a, id, "x".repeat(2001))).status).toBe(413);
  });

  test("rate limit returns 429 after the per-session budget", async () => {
    const { app: a } = app(new RateLimiter(2));
    const id = await newSession(a);
    expect((await send(a, id, "hi")).status).toBe(200);
    expect((await send(a, id, "hi")).status).toBe(200);
    expect((await send(a, id, "hi")).status).toBe(429);
  });

  test("escalation queue lists tickets and PATCH changes status", async () => {
    const { app: a } = app();
    const id = await newSession(a);
    const m = (await (await send(a, id, "Please cancel my order TPK-10003")).json()) as { escalation_id: string };
    const list = (await (await a.request("/api/v1/escalations")).json()) as { escalations: { id: string }[] };
    expect(list.escalations.map((e) => e.id)).toContain(m.escalation_id);
    const p = await a.request(`/api/v1/escalations/${m.escalation_id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status: "resolved" }),
    });
    expect(((await p.json()) as { status: string }).status).toBe("resolved");
    const bad = await a.request(`/api/v1/escalations/${m.escalation_id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status: "deleted" }),
    });
    expect(bad.status).toBe(400);
  });

  test("traces and history endpoints return redacted data", async () => {
    const { app: a } = app();
    const id = await newSession(a);
    await send(a, id, "TPK-10001 rina.putri@example.com where is it");
    const t = await (await a.request(`/api/v1/traces/${id}`)).text();
    const m = await (await a.request(`/api/v1/sessions/${id}/messages`)).text();
    expect(t).not.toContain("@example.com");
    expect(m).not.toContain("@example.com");
    expect(JSON.parse(t).events.length).toBeGreaterThan(3);
  });

  test("health reports db, llm and jev", async () => {
    const { app: a } = app();
    const j = (await (await a.request("/api/v1/health")).json()) as Record<string, string>;
    expect(j).toMatchObject({ status: "ok", db: "ok", jev: "noop" });
  });

  test("CORS allows the Tauri origin and rejects others", async () => {
    const { app: a } = app();
    const ok = await a.request("/api/v1/health", { headers: { origin: "tauri://localhost" } });
    const no = await a.request("/api/v1/health", { headers: { origin: "https://evil.example" } });
    expect(ok.headers.get("access-control-allow-origin")).toBe("tauri://localhost");
    expect(no.headers.get("access-control-allow-origin")).toBeNull();
  });
});
