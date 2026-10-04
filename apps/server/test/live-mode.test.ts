// Live mode (bring your own key). Network is faked: keys are checked against a stub, never a real API.
import { afterEach, describe, expect, test } from "bun:test";
import { config } from "../src/config.ts";
import { createApp } from "../src/http/app.ts";
import { redact } from "../src/observability/redact.ts";
import { harness } from "./helpers.ts";

const GOOD = "sk-test-goodkey-0123456789abcdef";
const BAD = "sk-test-badkey-0123456789abcdef";

const keyCheck = (async (url: string, init: RequestInit) => {
  const h = new Headers(init.headers);
  const key = h.get("authorization")?.replace("Bearer ", "") ?? h.get("x-api-key");
  if (String(url).includes("typesafe")) {
    return key === "apikey_goodjev"
      ? Response.json({ answers: { intent: "policy_question", escalation: 0.1 } })
      : new Response("", { status: 401 });
  }
  return new Response("{}", { status: key === GOOD ? 200 : 401 });
}) as unknown as typeof fetch;

function setup() {
  const h = harness();
  return { h, app: createApp({ ...h.deps, liveFetch: keyCheck }) };
}

const post = (app: ReturnType<typeof createApp>, path: string, body: unknown) =>
  app.request(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

describe("live mode", () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
    config.allowByok = true;
  });

  test("a valid key starts a live session; the key is never echoed or stored", async () => {
    const { h, app } = setup();
    const res = await post(app, "/api/v1/sessions", { llm: { provider: "openai", api_key: GOOD } });
    expect(res.status).toBe(201);
    const text = await res.text();
    expect(text).not.toContain(GOOD);
    const { session_id, mode } = JSON.parse(text);
    expect(mode).toBe("openai:gpt-4o-mini");

    // The turn goes to the (faked) live OpenAI endpoint with the user's key.
    let usedKey = "";
    globalThis.fetch = (async (_url: string, init: RequestInit) => {
      usedKey = new Headers(init.headers).get("authorization") ?? "";
      return Response.json({
        choices: [
          {
            message: {
              content: JSON.stringify({
                type: "final",
                reply: "Unworn shoes can be returned within 30 days of delivery.",
                action: "answer",
                citations: ["kb-returns-001"],
                confidence: 0.9,
                clarification_fields: [],
              }),
            },
          },
        ],
        usage: { prompt_tokens: 100, completion_tokens: 20 },
      });
    }) as unknown as typeof fetch;
    const turn = (await (
      await post(app, `/api/v1/sessions/${session_id}/messages`, {
        message: "How long is the return window?",
      })
    ).json()) as { action: string; meta: { llm: string } };
    expect(turn.action).toBe("answer");
    expect(turn.meta.llm).toBe("openai:gpt-4o-mini");
    expect(usedKey).toBe(`Bearer ${GOOD}`);

    const dump =
      JSON.stringify(h.db.query("SELECT * FROM traces").all()) +
      JSON.stringify(h.db.query("SELECT * FROM sessions").all());
    expect(dump).not.toContain(GOOD);
  });

  test("an invalid key is rejected before a session exists", async () => {
    const { h, app } = setup();
    const res = await post(app, "/api/v1/sessions", { llm: { provider: "anthropic", api_key: BAD } });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe("llm_key_invalid");
    expect((h.db.query("SELECT COUNT(*) AS n FROM sessions").get() as { n: number }).n).toBe(0);
  });

  test("JEV key is probed; a bad one is rejected, a good one is bound", async () => {
    const { app } = setup();
    expect((await post(app, "/api/v1/sessions", { jev: { api_key: "apikey_badjev" } })).status).toBe(400);
    const ok = (await (
      await post(app, "/api/v1/sessions", { jev: { api_key: "apikey_goodjev" } })
    ).json()) as { mode: string };
    expect(ok.mode).toBe("jev");
  });

  test("live mode can be switched off for shared deployments", async () => {
    const { app } = setup();
    config.allowByok = false;
    expect((await post(app, "/api/v1/sessions", { llm: { provider: "openai", api_key: GOOD } })).status).toBe(
      403,
    );
    expect((await app.request("/api/v1/sessions", { method: "POST" })).status).toBe(201);
  });

  test("key checks are rate limited so the endpoint is not a key oracle", async () => {
    const { app } = setup();
    const codes: number[] = [];
    for (let i = 0; i < 12; i++)
      codes.push((await post(app, "/api/v1/sessions", { llm: { provider: "openai", api_key: BAD } })).status);
    expect(codes.slice(0, 10).every((c) => c === 400)).toBe(true);
    expect(codes.slice(10)).toEqual([429, 429]);
  });

  test("malformed live config is rejected", async () => {
    const { app } = setup();
    expect((await post(app, "/api/v1/sessions", { llm: { provider: "gemini", api_key: GOOD } })).status).toBe(
      400,
    );
    expect(
      (
        await post(app, "/api/v1/sessions", {
          llm: { provider: "openai", api_key: GOOD, model: "x; rm -rf" },
        })
      ).status,
    ).toBe(400);
  });

  test("API keys pasted into a message are redacted from storage", () => {
    expect(redact(`my key is ${GOOD}`)).toBe("my key is [api_key]");
    expect(redact("sk-ant-api03-abcdefghijklmnopqrstuv")).toBe("[api_key]");
  });
});

describe("ALLOW_BYOK parsing", () => {
  test("common spellings of on and off are understood; anything else keeps the default (on)", async () => {
    const { bool } = await import("../src/config.ts");
    for (const v of ["1", "true", "TRUE", " true ", '"true"', "yes", "on"]) expect(bool(v, false)).toBe(true);
    for (const v of ["0", "false", "False", "no", "off", "'false'"]) expect(bool(v, true)).toBe(false);
    for (const v of [undefined, "", "maybe"]) expect(bool(v, true)).toBe(true);
  });
});
