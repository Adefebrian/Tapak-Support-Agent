# AI usage disclosure

I built this project with an AI coding assistant (Claude, in Claude Code) as a pair programmer. It wrote most of the first-draft code and documents from my PRD. I set the architecture and the control boundaries, reviewed the output, ran every test and eval, and decided what shipped. Below is what was rejected, corrected, or improved, and how each problem was found.

## What the AI was used for

- Scaffolding the Bun workspace, the Hono API, the SQLite schema, and the seed data.
- First drafts of the agent loop, policy engine, tools, providers, eval harness, and the 40 eval cases.
- The web client and its motion design.
- First drafts of these documents.

## Rejected or corrected output

| What the AI produced | Problem | How it was found | Outcome |
| --- | --- | --- | --- |
| A broad phone-number regex for PII redaction | Matched carrier tracking numbers, so the output guard blocked every valid order-status answer | Scenario test 2 failed on the first run | D-01, fixed, 2 regression tests |
| Paragraph-level KB chunks | The wrong paragraph and a superseded page outranked the actual 30-day rule | Scenario test 1 | D-02, document-level chunks, superseded flag |
| Intent rules that ignored a bare email | Multi-turn verification broke on turn 3 | Scenario test 9 | D-03, fixed |
| A clarification template with the example ID `TPK-10001` | It is a real seeded order, shown to an unverified user | Eval leak check (ver-06) | D-04, fixed, a test scans all templates for real IDs |
| An injection path that flagged and then answered anyway | It looked like the agent cooperating with the attack | Eval (inj-01) | D-05, boundary reply |
| A README sentence claiming "I want my cash returned" is caught | False. It is routed to the policy path | I asked for the claim to be checked before keeping it | Corrected, logged as L-02 (open) |
| Test assertions that were themselves wrong (a regex that matched a tracking number as a phone suffix; assuming a document was not retrieved) | The tests, not the code, were wrong | Reading the failures | Tests corrected, noted in the first-run log |
| An SVG architecture diagram with labels inside node boxes, and a packet drawn on top of the labels | Violated the no-overlap UI rule | Screenshot review and `ui_audit` | Redrawn on canvas, packet beneath the nodes |
| A tab bar that clipped "Escalations" on phones, 40px tab targets, a composer wider than the form cap | UI rule violations | `ui_audit` at 5 widths | Bottom tab bar on mobile, 44px+ targets, capped chat column |
| Google Fonts loaded from the CDN | The audit's page load stalled, and the native app would need the network | `ui_audit` timeout | Self-hosted Latin subset (ADR-12) |
| A shoe-shaped mascot, then a grey outline for the human support agent | Weird and ugly, by my own review; the human had no personality | Looking at it | A robot agent (Tapi) and a full human character (Sari) with her own reactions |
| Character poses that switched instantly between states | Felt mechanical, not smooth | Watching it | Damped-spring rig for every pose, eased blinks, anticipation before a hop, a Bezier path for the ticket with a landing bounce |
| Optional suggestions field validated strictly (max 3) | One extra suggestion threw away a valid answer | Test | D-09, field loosened, trimmed by the guard |
| Template replies like "I cannot issue refunds myself, so I have created a ticket" | Correct but robotic | Reading conversations end to end | Warmer, specific replies that say what was passed on, by when, and the ticket number |
| A mock that answered with the first sentences of the top page | Often off-target ("US men's 9" returned unrelated rows) | Conversation probes | Extractive answers that pick the matching sentences or table row, with a phrase bonus for adjacent words |
| New KB pages written with the phrase "return window" while the return policy page never used it | Broke existing answers | 8 tests failed at once | D-08, customer vocabulary on the source page, plus a retrieval benchmark floor in CI |
| A static file handler using `normalize` | Not obviously safe against encoded `../` | Review | `resolve` + a containment check + safe decode, verified with raw `%2e%2e` requests |

## Things I deliberately did not let the AI decide

- Whether refund or cancel tools should exist. They do not (ADR-01).
- Whether JEV can unlock anything. It cannot (ADR-06).
- Whether to patch the open limitations L-01 and L-02 with case-specific keywords to raise the score. Not done, because that would overfit the eval.
- Commit authorship: commits are mine. This file is the disclosure.

## Verification I did not get to

No live-model or live-JEV run: no keys were available in the build environment. Every number in `evidence/` is from the deterministic mock model, and each document says so.
