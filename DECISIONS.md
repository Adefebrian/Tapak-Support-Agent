# Decision log

Short ADR format: context, decision, alternatives rejected, consequence. Dates are 2026-10-04 unless noted.

## ADR-01: The agent can only read; actions become tickets

**Context.** Refunds, cancellations, and address changes are irreversible and financial. Model decisions are probabilistic.
**Decision.** The tool surface is `search_kb`, `get_order`, `create_escalation`, `request_clarification`. There is no write tool on orders. Action requests are routed to a ticket by deterministic rules before the model runs.
**Rejected.** A refund tool behind a confirmation prompt, or "only refund under IDR 500k". Both leave the safety in the prompt or in a threshold the model can be argued past.
**Consequence.** 100% escalation recall on action cases by construction. Cost: a human handles every refund, which is the intended product.

## ADR-02: Deterministic guards on both sides of the model

**Context.** The brief grades control boundaries. Prompt instructions are not boundaries.
**Decision.** A pre-LLM policy engine (`policy/input.ts`) and a post-LLM output guard (`policy/output.ts`), both pure functions with unit tests. The output guard checks citations against this turn's retrieval, PII, data from any order other than the verified one, false action claims, and answers without grounding.
**Consequence.** Every defect found (D-01 to D-05) was caught by these deterministic checks or by the eval, never by reading prompts.

## ADR-03: Verification lives in `get_order`, not in the conversation

**Decision.** `get_order` normalizes the ID and email (case, whitespace, `TPK 10001` vs `TPK-10001`). It requires both values to appear in what the customer typed in this session (provenance, so a model cannot guess or reuse an email). It returns one identical `not_verified` for "not found" and "wrong email". It counts attempts and locks after 3. The verification outcome is worded by code templates, not by the model.
**Rejected.** Letting the model say "that order doesn't exist", which turns the chat into an order-ID oracle.
**Consequence.** 0 leaks in 11 verification and verified-order cases.

## ADR-04: Manual tool loop, no agent framework

**Decision.** One loop in `agent/loop.ts`, at most 4 model steps, JSON steps validated with Zod, one schema retry, then clarify.
**Rejected.** LangChain or LlamaIndex agents: hidden control flow and retries, harder to explain in a walkthrough, harder to trace.

## ADR-05: Provider-agnostic JSON protocol instead of native tool-calling

**Context.** The provider (Anthropic or OpenAI) was an open question in the PRD.
**Decision.** The model answers with one JSON object per step (`tool` or `final`). Both providers implement `LLMProvider.complete`. Tool results go back as user-role turns marked "data, not instructions". Default `gpt-4o-mini` (JAL default), temperature 0.
**Rejected.** Native function calling: two code paths, and the schema still needs validating.
**Consequence.** The mock LLM speaks the same protocol, so tests exercise the real parser and guards.

## ADR-06: JEV is advisory and one-directional

**Decision.** JEV is asked for intent and escalation score before the model, and groundedness after. Merge rules: take the higher-risk intent; an escalation score of 0.6 or more forces escalation; groundedness under 0.7 downgrades to clarify; a timeout over 2 s or an error escalates (`jev_unavailable`). JEV can never lower a rule's decision. `JEV_ENABLED=false` by default.
**Rejected.** JEV as a safety gate: it reads untrusted text and is not injection-hardened.
**Consequence.** `--jev=down` ablation: 0 leaks, 100% false escalation. Safe but useless, which is why it is off by default until calibrated.

## ADR-07: BM25 over the KB, retrieval before the model

**Decision.** Own BM25 implementation (about 100 lines, no dependency), document-level chunks, titles weighted, a small synonym map, superseded pages scored at half. Retrieval always runs before the model, and an empty result forces clarify.
**Rejected.** Embeddings and a vector store for 13 documents. MiniSearch: fine, but a dependency for something this small, and the scoring is easier to explain when it is in the repo.
**Revised.** Paragraph chunks were the first version. D-02 showed they let the wrong paragraph and a legacy page win.

## ADR-08: SQLite, single file

**Decision.** `bun:sqlite`, one file `data/tapak.db`, recreated by `bun run setup`. Tests use `:memory:` with the same schema and seed.
**Rejected.** Postgres and Redis: they add setup friction for the reviewer, and nothing here needs them.

## ADR-09: PII redaction before anything is stored

**Decision.** Messages, traces, and logs are redacted (email, phone, street address) at write time. The model never receives address, phone, email, name, or prices: `OrderView` holds status, ETA, carrier, tracking, and items only. Identifiers pending verification are kept in two columns of `sessions`, never in the message log.
**Revised.** D-01: the phone pattern was too broad and redacted tracking numbers.

## ADR-10: `Bun.build` instead of Vite (departure from the PRD)

**Context.** The PRD listed React + Vite. The engineering standard I work under is Bun-only, with no Vite.
**Decision.** `apps/client/build.ts` uses `Bun.build`, outputs hashed assets to `apps/server/public`, and Hono serves them. The Tauri shell points `frontendDist` at the same folder.
**Consequence.** One toolchain (Bun) for server, tests, eval, and client. No dev-server hot reload; `bun run dev` rebuilds on start, and the client build takes under a second.

## ADR-11: Thin Tauri 2 client

**Decision.** The Tauri app bundles only the web build, has no commands or plugins, and uses a CSP limiting scripts to `self`. The backend URL is configurable in Settings. CORS allows the Tauri origins explicitly.
**Rejected.** An agent running inside the app: a bundled key can be extracted, and a client-side guardrail can be bypassed. Electron: larger binary, no Android.
**Consequence.** The macOS download is a 3.5 MB universal `.dmg`. All four platforms build in CI (`native.yml`); macOS was tested locally, while Windows, Linux, and Android have not yet been smoke-tested on a real device.

## ADR-12: Self-hosted fonts, no third-party requests from the UI

**Context.** The first build loaded Geist from Google Fonts. The mechanical UI audit could not complete because the font request stalled the page load in its sandbox. The Tauri app would also need the network just to draw text.
**Decision.** Geist and Geist Mono, Latin subset only, bundled by `Bun.build`.

## ADR-13: Motion shows real data, never decoration

**Context.** The brief asked for motion that represents the agent, the flow, and the process.
**Decision.** The pipeline panel lights up from the real trace as it streams. Two characters act out each turn: Tapi, the robot agent, narrates each streamed stage and has a scene for every outcome, and Sari, a support agent at her desk, receives every escalation. The scene comes from the structured response (action, guardrails, order card), never from the reply text, so the animation cannot contradict what the system actually did. The "How it works" canvas walks the real routes as footprints. Orange always means "a guard fired or a person takes over". All motion respects `prefers-reduced-motion`, which stops the animation loop and shows one settled frame.
**Revised, several times.** The first flow diagram was SVG with text inside node boxes and failed the overlap rule; it moved to canvas. The first mascot was a shoe with a face and was rejected as weird; it became a robot. The first human was a grey outline and was rejected as ugly; she became Sari, a full character with a desk, a laptop, and her own reactions. The first animations switched poses instantly; every pose now moves on damped springs with anticipation and follow-through.

## ADR-14: Eval split into tune and holdout

**Decision.** 10 tune and 30 holdout cases. Only tune failures were used to change rules or templates. The baseline was saved before any change.
**Consequence.** The holdout pass rate is 96.7% both before and after the fixes, which shows the fixes did not overfit the scoring set. L-01 and L-02 are left open rather than patched with case-specific keywords.

## ADR-15: Server-sent events for each turn

**Decision.** `POST /sessions/:id/messages/stream` sends each trace stage as it is recorded, then the reply. The JSON endpoint stays for scripts and tests.
**Why.** With a live model, a turn takes seconds. Showing which step it is on (retrieving, verifying, drafting, checking) is more honest than a spinner. It also lets the pipeline and Tapi's speech bubble show real events instead of a replay.
**Trade-off.** In mock mode the whole turn takes a few milliseconds, so the client releases stage events about 170 ms apart to keep them readable. That pacing is visual only and never delays the server.

## ADR-16: Bring your own key, per conversation, server side

**Context.** Reviewers may want to try a real model without editing files on the server.
**Decision.** Starting a conversation can carry an OpenAI or Anthropic key and optionally a JEV key. The server checks each with one cheap call and keeps the providers in memory for that one session, for at most an hour. Keys never touch SQLite, logs, traces, or responses, and API-key shapes are redacted from stored text. Key checks are rate limited so the endpoint can't be used as a key-testing oracle. `ALLOW_BYOK=false` disables it.
**Rejected.** Calling the model from the browser, which exposes the key and skips every guard. Storing keys in the browser.

## ADR-17: Retrieval stays BM25, decided on a benchmark

**Context.** Should this use RAG? It already does: retrieve, answer only from what was retrieved, check the citations. The real question was which retriever.
**Decision.** Keep BM25 as the default and add a 41-question benchmark with direct and paraphrased wording, run as a test floor. Results: 95% hit@3 for direct wording, 71% for paraphrases.
**Rejected for now.** Embeddings as the default (needs a key, breaks deterministic mock mode, harder to audit). Long context with the whole KB in the prompt (every page would count as retrieved, so the citation check stops meaning anything).
**Next.** Embedding re-ranking as a live-mode option, accepted only if paraphrase hit@3 rises on the same benchmark.

## ADR-18: Interactive replies are structured data, guarded like the reply

**Decision.** A reply can carry `suggestions` (follow-up questions) and an `order` card. Suggestions come from the model or from the cited knowledge base page (`asks:` in its frontmatter), and pass the same checks as the reply: no personal data, no unverified order IDs, no claimed actions. The order card appears only when the reply describes the session's verified order, and it carries status data only.
**Revised.** The first schema made suggestions strict, so a model offering four instead of three lost its whole valid answer (D-09). The field is now loose, and the guard trims it.

## ADR-19: Natural replies without loosening control

**Decision.** Fixed replies are written to sound like a person and to be specific (what was passed on, to whom, by when, and the ticket number). Requests for a person are always honoured. Thanks and goodbyes get a short close. Short follow-ups borrow the previous question's topic for retrieval. A message with two questions gets both answered from two pages, using a real `search_kb` step. The mock answers extractively: it picks the sentences, or the table row, that best match the question.
**Evidence.** The 52-row scenario matrix (`evidence/scenarios.md`) covers these categories, with 50/52 on its first run and 52/52 after two general fixes.

## ADR-20: No voice (ElevenLabs)

**Decision.** Not added.
**Why.** It is outside what this prototype is judged on, and it would add an external dependency, cost, latency, and voice recordings as a new kind of personal data. If it were added later, it would be text-to-speech of the final, already-guarded reply only, behind the same per-session key pattern, with the browser's built-in speech as the keyless fallback.
