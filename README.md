# Tapak Support Agent

A customer support agent for a made-up shoe shop, Tapak Footwear. It answers questions from a 21-page policy and product knowledge base and cites its sources. It shows an order's status only after the order ID and email both match. Everything it isn't allowed to do (refunds, cancellations, exceptions, disputes, medical questions) goes to a person through an escalation queue.

The core rule: the agent can read and explain, and nothing else. That rule lives in code, not in the prompt. There is no refund tool or cancel tool for the model to misuse.

Deployment : https://tapak.adefebrian.com/

## Setup

You need [Bun](https://bun.sh) 1.2 or newer. No Docker, no API key.

```bash
bun install
bun run setup     # creates data/tapak.db with seed data and builds the web client
bun run dev       # http://localhost:8787
```

By default it runs in **mock mode**: a deterministic stand-in for the model, no JEV. Every guard, tool, schema check, and trace still runs for real, so the whole system can be tested without a key.

```bash
bun run test                         # 155 tests, no keys, 96.6% line coverage
bun run eval --llm=mock --jev=off    # 40 labelled cases -> evidence/runs/
bun run eval --jev=down              # simulates a JEV outage to show fail-closed behaviour
bun run eval:retrieval               # retrieval benchmark: hit@1 / hit@3, direct vs paraphrased
bun run package                      # dist/tapak-support-agent.zip from the committed tree
```

### Public demo

A demo runs at https://tapak.adefebrian.com. It starts every conversation in mock mode, so it works without a key. Live mode (bring your own key) is enabled there: choose Live in the mode dialog and paste your own OpenAI or Anthropic key. The key is used for that one conversation only, held in the server's memory for at most an hour, and never stored. Limits are the same as below: 20 messages a minute per conversation, and 10 key checks a minute for the whole server.

### Trying it with a real model (live mode)

1. **In the app.** Click the mode button (top right), choose Live, pick OpenAI or Anthropic, paste a key, and optionally add a JEV key. The server checks each key with one cheap call and ties it to that one conversation, in memory, for at most an hour. Keys are never written to the database, logs, traces, or any response. `ALLOW_BYOK=false` turns this off for a shared deployment.
2. **Server-wide.** Copy `.env.example` to `.env` and set `LLM_PROVIDER=openai` with `OPENAI_API_KEY` (default `gpt-4o-mini`) or `LLM_PROVIDER=anthropic`. For JEV, set `JEV_ENABLED=true`, `JEV_PROVIDER=jev`, `JEV_API_KEY`. Then `bun run eval --llm=openai --jev=on` runs the live eval.

### What to look at

- **Chat.** Sixteen ready-made scenarios, grouped as answers, orders, and boundaries, or type your own. Replies come with sources you can open, an order card with a progress timeline when an order is verified, and suggested next questions you can tap.
- **Tapi and Sari.** Tapi, the robot agent, narrates each stage of the real trace as it streams in ("Found 2 policy pages", "Verifying the order", "Guard: injection boundary") and then reacts. Each outcome has its own scene: a hop for an answer, a parcel for a found order, a padlock when an order can't be verified, a shield for an injection attempt, a raised hand for a refusal. On an escalation he hands a ticket to Sari, the support agent at her desk, who looks up, catches it, and waves. Poses move on damped springs, so nothing snaps. The full set is on the How it works page.
- **Pipeline panel.** Lights up stage by stage over server-sent events: input guard, decision layer, retrieval with BM25 scores, model loop, tools, output guard, response.
- **Escalations.** The queue a support person works from, with reason and priority for every ticket.
- **Traces.** Every stage of every turn, plus the metrics from the PRD.
- **How it works.** An animated map of the routes a message can take (it walks the route as footprints, since "tapak" means footprint), every character scene with the scenario that triggers it, and the control boundary table.

Seed customers are in `data/seed.ts`, for example order `TPK-10001` with `rina.putri@example.com`.

## Architecture

```
message
  -> input guard (rules)        intent, injection flags, verification state. Refunds, cancellations,
                                 disputes, requests for a person, and medical questions are routed here
                                 and never reach the model.
  -> decision layer (JEV)       intent + escalation score. Advisory: it can only add caution. Timeout = escalate.
  -> retrieval (BM25)           always before the model. Short follow-ups borrow the previous question's
                                 topic. Nothing relevant = clarify, never guess.
  -> model loop (max 4 steps)   one JSON step at a time, checked with Zod: a tool call or a final answer.
       tools: search_kb, get_order, create_escalation, request_clarification   (all read only)
  -> output guard (rules)       citations must come from this turn's retrieval; no personal data, no other
                                 customer's order data, no "I refunded you"; groundedness >= 0.7.
                                 Suggested follow-ups go through the same checks.
  -> reply { reply, action, citations, suggestions, order, escalation_id, trace_id }
```

Any step can end the turn in `clarify` or `escalate`. Nothing the model writes reaches the customer without passing the output guard.

| Area | Where |
| --- | --- |
| One turn, start to finish | `apps/server/src/agent/loop.ts` |
| Input rules and output guard | `apps/server/src/policy/` |
| Tools (verification, enumeration-safe errors, provenance) | `apps/server/src/tools/index.ts` |
| Model providers (OpenAI, Anthropic, mock), JEV providers (live, mock, off), live mode | `apps/server/src/providers/` |
| Retrieval and the knowledge base | `apps/server/src/retrieval/`, `kb/` |
| Redaction, traces, logs | `apps/server/src/observability/` |
| HTTP API and server-sent events | `apps/server/src/http/app.ts` |
| Web client (also the desktop and Android UI) | `apps/client/` |
| Tauri 2 shell | `apps/native/` |
| Eval, retrieval benchmark, scenario matrix | `eval/` |
| Evidence | `evidence/` |

**Stack:** Bun, TypeScript (strict), Hono, `bun:sqlite`, Zod, React and Framer Motion bundled with `Bun.build`. The server has two runtime dependencies: Hono and Zod.

### API

Everything is under `/api/v1`, and every response carries `x-trace-id`.

| Method | Path | Purpose |
| --- | --- | --- |
| POST | `/sessions` | New conversation. An optional body switches it to live mode |
| POST | `/sessions/:id/messages` | Send a message, get the reply as JSON |
| POST | `/sessions/:id/messages/stream` | Same turn as server-sent events: each stage as it happens, then the reply |
| GET | `/sessions/:id/messages` | Redacted history |
| GET | `/escalations`, PATCH `/escalations/:id` | The support queue |
| GET | `/traces/:session_id` | Every stage of every turn |
| GET | `/kb`, `/kb/:id` | Knowledge base pages, so citations can be opened |
| GET | `/metrics`, `/health` | Metrics computed from traces; DB, model, and JEV status |

Limits: 2,000 characters per message, 20 messages a minute per session, the last 10 turns sent to the model, a model timeout of 20 s with one retry, JEV 2 s with no retry, tools 3 s.

### Desktop and Android

`apps/native` wraps the same web build with Tauri 2. It is a thin client: no agent logic and no keys inside, and the server address is set in the app. All four platforms (macOS universal `.dmg`, Windows `.msi` and `.exe`, Linux `.AppImage` and `.deb`, and a signed Android `.apk` for arm64 and x86_64) are built in CI by `.github/workflows/native.yml` and attached to the GitHub release. macOS was tested locally: a universal build of the same source launched and connected to the server. Windows, Linux, and Android have not yet been smoke-tested on a real device.

## Assumptions

- Verification means order ID plus the email on the order, as the brief says. No login.
- The data is invented. The boundaries are what matter.
- English only.
- One server. Rate limits and live-mode keys live in that process's memory.
- An escalation is a row in a local table that shows up in the queue. No helpdesk integration.

## Known limitations

- **No live-model numbers yet.** I had no API keys while building, so every number in `evidence/` comes from the mock model. The mock exercises every guard and tool and answers extractively from the right page, but how well a real model writes answers is still unmeasured. Live mode is ready for it.
- **Lexical retrieval misses paraphrases.** The retrieval benchmark gets 95% hit@3 when a question uses the knowledge base's own words, and 71% when it doesn't. Two eval cases fail because a word like "Jakarta" or "shoes" pulls in a page that doesn't answer the question (L-01).
- **Intent rules miss some phrasings.** "Give me my money back" is escalated, while "I want my cash returned" falls through to the policy path (L-02). Nothing unsafe happens, because no refund tool exists, but the customer gets policy text instead of a ticket.
- **The mock can't resolve pronouns across topics.** After "which shoe is best for walking?", the follow-up "how do I clean it?" finds the care page but doesn't know "it" means a mesh shoe. A live model gets the history and can. The mock can't.
- **JEV is wired and tested against its documented request shape, but not against the live service.** The mock JEV agrees with the rules every time, so the ablation proves the fail-closed wiring, not JEV's value.
- **Injection detection is pattern based.** It flags attempts for the trace. The real defence is that there is nothing dangerous to call.

## Technical judgment

### 1. What did you decide was unsafe to automate, and why?

Anything that moves money, changes an order, or can hurt someone: refunds, cancellations, address changes, exchanges, policy exceptions, showing an order before it's verified, and medical, legal, or safety advice. A model that's right 99 times out of 100 is still wrong on the hundredth refund, and you can't take that one back or explain it afterwards.

So none of these depend on the prompt. There's simply no refund or cancel tool. Those requests are turned into a ticket before the model is even called. `get_order` checks the ID and email in code, only accepts values the customer actually typed, gives the same answer for "no such order" and "wrong email", and locks after three tries. Asking for a person is always honoured too. The verification and action cases in the eval and the scenario matrix all pass with zero leaks.

### 2. What would most likely fail first in production, and how would you detect and contain it?

Retrieval, quietly. Real customers ask things the knowledge base doesn't cover, or phrase things differently from how the pages are written. I've watched it happen while building this. Adding eight pages pushed the right answer out of first place for a "return window" question (D-08). "What time is support open?" landed on the shipping page because the support page never used the word "open". And "what's the weather in Jakarta" now gets the stores page. The loud version of this failure is fine: the agent clarifies and the escalation rate rises. The quiet version is the problem: a confident answer to the wrong question.

To detect it, I'd watch empty-retrieval, clarify, and escalation rates from `/metrics`, run the retrieval benchmark and scenario matrix in CI on every knowledge base change (both are tests now), and sample answered turns for human review. To contain it, everything already fails closed into clarify or escalate, JEV sits behind a flag, and every trace records the prompt version, so a regression can be traced back to the change that caused it.

### 3. What important architecture or product choices did you make, what alternatives did you reject, and what evidence informed those decisions?

- **A hand-written loop, not an agent framework.** The whole turn is one file where every exit is visible, and tests push bad JSON, bad tool arguments, timeouts, and step limits through it.
- **Rules on both sides of the model, not prompt instructions.** Every defect I found was caught by a deterministic test or an eval check, not by reading prompts.
- **BM25 instead of embeddings, for now.** This is still RAG: retrieve, then answer only from what was retrieved, with citations checked. With 21 short pages, lexical scores are cheap, need no key, and show up in the trace. The benchmark shows the cost (71% hit@3 on paraphrases), which is why the next step is embedding re-ranking as a live-mode option rather than a rewrite. Putting the whole knowledge base in the prompt would avoid misses but break the citation check, since every page would count as retrieved.
- **SQLite instead of Postgres and Redis.** The reviewer runs one command.
- **A thin Tauri client instead of a local agent.** A key inside a binary can be extracted, and a guard on the client can be skipped. The macOS download is a 3.5 MB universal `.dmg`.
- **JEV as an advisor, never a gate.** It reads untrusted text. When I simulated it timing out, the system stayed safe (zero leaks) and became useless (everything escalated). That's why it's off by default until it's calibrated.
- **Bring-your-own-key per conversation, not keys in the browser.** The browser never calls a model provider. The key goes to the server once, lives in memory for one conversation, and the same guards apply.
- **No voice (ElevenLabs).** It's outside what's being judged, and it would add an external dependency, cost, and a new kind of personal data.

### 4. What did an AI tool suggest or generate that you rejected, corrected or improved? How did you identify the problem?

I built this with Claude as a pair programmer, and a fair amount of what it wrote first was wrong in ways that only showed up under tests. The one I'd point to first: its PII filter treated any long run of digits as a phone number, so it blocked every tracking number, and with it every valid order-status answer. The guard was "safe" and the feature was dead. A scenario test caught it because it checked the happy path, not just the blocking path.

A few others. A reply template used `TPK-10001` as an "example" order ID, which is a real order belonging to the customer in that eval case (the eval's leak check found it). It made the optional suggestions field strict, so a model that offered four follow-ups instead of three had its whole valid answer thrown out (a test found it). It drew the support agent as a grey outline with no personality, and I asked for a real character. And it once wrote a README sentence claiming a refund phrasing was caught when it wasn't. I had the claim checked before keeping it, it failed, and that became L-02. The full list is in `AI_USAGE.md`.

### 5. What evidence makes you trust the system today, what remains unproven, and what would you improve first with one additional day?

What I trust: zero leaks across the 40-case eval, the 52-case scenario matrix, and 155 tests, enforced in code that no model output can get around. Escalation recall is 100% on the cases that must escalate. Every turn can be rebuilt from its trace. The fail-closed path is measured, not assumed. The UI passes a mechanical layout audit on every screen at five widths, all four native apps build in CI, and the macOS app launches and talks to the server.

What's unproven: how a real model actually answers, whether JEV adds anything and where its thresholds should sit, how the agent holds up against cleverer injection and paraphrasing, and whether the Windows, Linux, and Android apps (built in CI) work on a real device.

With one more day, I'd run the live eval with `gpt-4o-mini` and a JEV ablation, then calibrate both thresholds against the labels. Then I'd add embedding re-ranking and a relevance check in live mode and see whether paraphrase hit@3 actually moves. And I'd grow the eval set from anonymised real conversations, keeping a strict holdout.

## Where everything is

| The brief asks for | Where |
| --- | --- |
| Complete source code and how to run it | `apps/`, `kb/`, `data/`, `eval/`, and Setup above |
| The original product requirements | `docs/PRD.md` |
| README: setup, architecture, assumptions, known limitations | This file |
| Decision log | `DECISIONS.md` |
| Testing evidence, including failures | `evidence/`: baseline before tuning, final eval, ablation, retrieval benchmark, scenario matrix (first run with its failures, and final), coverage, raw runs |
| A defect and the test or guardrail added in response | `evidence/DEFECTS.md`, headline D-01 |
| AI usage disclosure | `AI_USAGE.md` |
| The five technical answers | Technical judgment, above |
