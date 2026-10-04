# Tapak Support Agent

A customer support agent for a fictional shoe store, Tapak Footwear. It answers policy questions from a knowledge base with citations, shows an order's status only after the order ID and email both match, and hands everything else (refunds, cancellations, exceptions, disputes, medical questions) to a human through an escalation queue.

The agent can only read and explain. Every action that moves money or changes an order becomes a ticket, and that limit is enforced by code, not by the prompt: the refund and cancel tools do not exist.

## Setup (under 5 minutes, no Docker, no API key)

Requires [Bun](https://bun.sh) 1.2 or newer.

```bash
bun install
bun run setup     # creates data/tapak.db with seed data, builds the web client
bun run dev       # http://localhost:8787
```

Everything runs in mock mode by default: a deterministic mock LLM and no JEV. Every guard, tool, schema check, and trace path still runs for real.

```bash
bun run test                                  # 57 unit, guardrail, and API tests, no keys
bun run eval --llm=mock --jev=off             # 40 labeled cases, writes evidence/runs/
bun run eval --llm=mock --jev=down            # simulates a JEV outage (fail closed)
```

To build the submission archive from the committed tree (excludes `node_modules`, `target/`, `dist/`, `data/*.db`, `.env`):

```bash
bun run package   # dist/tapak-support-agent.zip
```

For a live model, copy `.env.example` to `.env` and set `LLM_PROVIDER=openai` with `OPENAI_API_KEY` (default model `gpt-4o-mini`), or `LLM_PROVIDER=anthropic`. Run `bun run eval --llm=openai` for a live eval.

### Try these in the chat

The welcome screen has one button per scenario from the brief: policy question, verified order, missing email, someone else's order, refund, chargeback, medical question, prompt injection, and an ambiguous message. Seed customers are in `data/seed.ts`, for example order `TPK-10001` with `rina.putri@example.com`.

The right-hand panel replays each turn's real trace: input guard, decision layer, retrieval scores, model steps, tools, output guard, final action. The **How it works** tab animates every route through the system, and **Traces** shows every stage of every turn.

## Architecture

```
customer message
  -> input guard (deterministic)      intent rules, injection flags, verification state,
                                       forced routes: refund/cancel/chargeback/medical never reach the model
  -> decision layer (JEV, advisory)    intent + escalation score; can only add caution; timeout = escalate
  -> retrieval (BM25 over kb/*.md)     always before the model; empty result = clarify, never guess
  -> model loop (max 4 steps)          JSON steps validated by Zod: tool call or final answer
       tools: search_kb, get_order, create_escalation, request_clarification   (read only)
  -> output guard (deterministic)      citations must be retrieved this turn, no PII, no other order's data,
                                       no "I refunded you" claims, groundedness >= 0.7
  -> response { reply, action, citations, escalation_id, clarification_fields, trace_id }
```

Every arrow can end the turn in `clarify` or `escalate`. No path from a probabilistic component reaches the customer without passing the output guard.

| Area | Where |
| --- | --- |
| Turn orchestration | `apps/server/src/agent/loop.ts` |
| Input rules, output guard | `apps/server/src/policy/input.ts`, `policy/output.ts` |
| Tools (verification, enumeration-safe errors, provenance) | `apps/server/src/tools/index.ts` |
| LLM providers (OpenAI, Anthropic, mock) and JEV providers (live, mock, noop) | `apps/server/src/providers/` |
| BM25 retrieval | `apps/server/src/retrieval/` |
| PII redaction, traces, logs | `apps/server/src/observability/` |
| HTTP API (`/api/v1`) | `apps/server/src/http/app.ts` |
| Web client (also the Tauri UI) | `apps/client/` |
| Tauri 2 shell (macOS, Windows, Linux, Android) | `apps/native/` |
| Eval harness and 40 cases | `eval/` |
| Evidence: baseline, final, ablation, defects, smoke | `evidence/` |

**Stack:** Bun, TypeScript strict, Hono, `bun:sqlite`, Zod, React with Framer Motion, bundled by `Bun.build`. The server has two runtime dependencies: Hono and Zod.

### API

All under `/api/v1`. Every response carries `x-trace-id`.

| Method | Path | Purpose |
| --- | --- | --- |
| POST | `/sessions` | New session |
| POST | `/sessions/:id/messages` | Send a message, get the agent's reply (`action` drives the UI) |
| GET | `/sessions/:id/messages` | Redacted history |
| GET | `/escalations` | Queue for support staff |
| PATCH | `/escalations/:id` | `open`, `in_progress`, `resolved` |
| GET | `/traces/:session_id` | Every stage of every turn |
| GET | `/health` | DB, LLM provider, JEV provider |
| GET | `/metrics` | Escalation rate, latency p50/p95, guardrail counts, JEV disagreement |

Limits: 2,000 characters per message (413), 20 messages per minute per session (429), last 10 turns sent to the model, LLM timeout 20 s with 1 retry, JEV 2 s with no retry, tools 3 s.

### Native apps

`apps/native` wraps the same web bundle with Tauri 2 as a thin client. It holds no agent logic and no keys, and it calls the server over HTTP. The backend address is set in **Settings** (defaults: `http://localhost:8787` on desktop, `http://10.0.2.2:8787` on the Android emulator).

```bash
cd apps/native && bun install && bunx tauri build     # local desktop build
```

The macOS build was produced and smoke-tested locally (see `evidence/smoke-checklist.md`). Windows, Linux, universal macOS, and the Android debug APK are built by `.github/workflows/native.yml`. Binaries are workflow artifacts and are not included in the source ZIP.

## Assumptions

- Verification is order ID plus the email on the order, as specified. No accounts or login.
- Policies and orders are fictional. Accuracy of the data is not the point; the boundaries are.
- English only.
- One server instance. Rate limiting and sessions are in-process.
- An escalation is a row in a local table shown in the queue. No helpdesk integration.

## Limitations (known, not hidden)

- **No live-model eval yet.** The build environment had no API keys, so every number in `evidence/` uses the deterministic mock model. The mock exercises every guard and tool, but answer quality from a real model is unmeasured.
- **No live JEV ablation.** The JEV client follows the documented TypeSafe System One request shape, but its answer format is parsed defensively and was not verified against the live service. The mock JEV agrees with the rules 100% of the time, so the ablation proves the fail-closed wiring, not JEV's value.
- **Lexical retrieval.** BM25 with a small synonym map. Off-topic questions that share a rare word with a page can be answered from that page (L-01 in `evidence/DEFECTS.md`, left open).
- **Rule-based intent misses paraphrases.** "Give me my money back" and "I would like to get reimbursed for TPK-10002" route to escalation, but "I want my cash returned" and "can you take these back" fall through to the policy path (L-02 in `evidence/DEFECTS.md`). The customer then gets the return policy instead of a ticket. Nothing unsafe happens, because there is no refund tool to misuse, but it is a missed escalation. A live JEV escalation score is meant to be the second net for this; the mock JEV shares the rules' keywords and misses it too, so that is unproven.
- **Injection detection is pattern-based.** It is a tripwire for the trace, not the defence. The defence is that there is nothing dangerous to call: no write tools, verification in code, and an output guard.

## Technical judgment

### 1. What is unsafe to automate, and why?

Refunds, cancellations, address changes, exchanges, policy exceptions, showing an order without full verification, and medical, legal, or safety advice. The first group moves money or changes a commitment and cannot be undone. Unverified order access leaks personal data. Advice can hurt someone. A model that is right 99% of the time is still wrong on the hundredth refund, and nobody can explain that mistake afterwards.

So these are enforced structurally. The refund and cancel tools do not exist (`tools/index.ts` lists all four tools; none of them writes to orders). `get_order` checks the ID and email in code, normalizes both, requires both to have been typed by the customer in this session, returns the identical `not_verified` result for "no such order" and "wrong email", and locks after 3 attempts. Action requests are routed to a ticket before the model is called. Evidence: eval categories `action` and `verification` (12 cases, all pass, 0 leaks), and the tests "someone else's order gets the same neutral reply as a non-existent order" and "get_order refuses identifiers the customer never typed".

### 2. What will most likely fail first in production, and how would you detect and contain it?

Retrieval coverage. Customers will ask about things the KB does not cover (a new promo, a store location, a product question), and lexical retrieval will either find nothing (the agent clarifies, and the escalation rate climbs) or find a weak match (L-01: an on-topic-looking answer to the wrong question). The second case is worse because nothing alarms.

Detection: `/metrics` and the traces already record empty-retrieval rate, escalation rate, clarify rate, guardrail counts per rule, and JEV disagreement. The proposed alerts are: escalation rate over 2x the hourly baseline, schema failures over 2%, JEV timeouts over 5%, and empty retrieval over 20% (stale KB or a new topic). For the silent case, sample `answer` turns for human review, and add a JEV relevance check (does the passage answer *this question*, not just "is the draft grounded").

Containment: everything already fails closed into clarify or escalate. Model drift that breaks the schema gets one retry and then clarifies. JEV is behind `JEV_ENABLED`. The model and prompt version are recorded in every trace (`prompt_version`) so a regression can be pinned to a change.

### 3. Architecture and product choices, the alternatives rejected, and the evidence

- **Manual loop instead of an agent framework.** The whole turn is one readable file (`agent/loop.ts`) where every exit is explicit. A framework's hidden loop is exactly where "the model decided to call a tool we did not expect" lives. Evidence: tests drive malformed JSON, invalid tool arguments, timeouts, and step limits through it and each lands on a known action.
- **Deterministic guards around the model instead of prompt rules.** The prompt asks for good behaviour; the code enforces it. Evidence: D-01 to D-05 were all caught by deterministic tests or eval checks, not by prompt review.
- **BM25 instead of embeddings.** 13 short documents; lexical scores are inspectable in the trace (the UI shows the bars). Defect D-02 shows the cost: chunking and IDF mattered and had to be fixed. L-01 is the remaining cost.
- **SQLite instead of Postgres + Redis.** The reviewer runs it in one command with no Docker. Traces, tickets, and eval runs live in one file.
- **Thin Tauri client instead of a local agent.** A key bundled in a binary can be extracted, and a guardrail on the client can be skipped. The macOS app is 3.37 MiB and holds nothing sensitive.
- **JEV advisory, not a gate.** It reads untrusted text, so it must not be able to unlock anything. Evidence: `evidence/ablation-jev.md`, the "score 0" attack test, eval case inj-03.
- **`Bun.build` instead of Vite.** One toolchain for server, tests, and client; recorded in `DECISIONS.md` as a deliberate departure from the PRD.

### 4. AI output I rejected, corrected, or improved

Details are in `AI_USAGE.md`. The most instructive cases:
- The example order ID in a clarification template was taken from the seed data, so the agent showed a real customer's order ID to an unverified user (D-04). It looked like harmless placeholder text in review. The eval leak check found it.
- The PII regex was written to catch phone numbers broadly and blocked every tracking number, which made order status unusable (D-01). It was caught because the scenario test asserted the positive path, not just the blocking path.
- First-pass chunking was paragraph-level, which let a "how to start a return" paragraph outrank the actual 30-day rule and let a superseded page win (D-02).
- I kept the refund and cancel tools out entirely rather than adding them "behind a confirmation". The prompt-only version of that guardrail is the pattern the brief warns about.

### 5. What gives me confidence today, what is unproven, and what I would do with one more day

Confident: 0 leaks across all 40 eval cases and all tests, enforced in code paths no model output bypasses. 57 tests pass without any API key. Every turn has a trace ID, and each stage is reconstructable. Fail closed is measured, not assumed (`--jev=down`: 0 leaks, 100% escalation). All four screens pass the mechanical UI audit at five widths. The macOS app builds and talks to the server.

Unproven: answer quality with a live model; JEV's real added value and the 0.6 and 0.7 thresholds (uncalibrated); behaviour against more sophisticated injection and paraphrase; Windows, Linux, and Android builds (CI workflows written, not run).

With one more day: run the live eval with `gpt-4o-mini` and a JEV ablation, and calibrate both thresholds against the labels. Add a JEV relevance question to close L-01. Grow the eval set from anonymized real conversations, keeping a strict holdout. Add sampled human review of `answer` turns, because those are the turns that fail silently.

## Repository map for the submission

| Asked for | Where |
| --- | --- |
| Source and how to run | `apps/`, this README (Setup) |
| README: setup, architecture, assumptions, limitations | this file |
| Decision log | `DECISIONS.md` |
| Testing evidence, including failures | `evidence/` (raw runs in `evidence/runs/`) |
| A defect and the guardrail or test that answers it | `evidence/DEFECTS.md`, headline D-01 |
| AI usage disclosure | `AI_USAGE.md` |
| The five technical answers | this file, Technical judgment |
