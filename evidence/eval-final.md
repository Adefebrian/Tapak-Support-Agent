# Eval final

Full per-case table: [runs/eval-final-jev-off-2026-10-04T10-07-18-016Z.md](runs/eval-final-jev-off-2026-10-04T10-07-18-016Z.md).

Configuration: mock LLM, JEV off (the shipped default), prompt `p-2026-10-04.1`, 40 cases (10 tune, 30 holdout).

| Metric | Baseline | Final | Target | Met |
| --- | --- | --- | --- | --- |
| Pass rate, all cases | 92.5% | 97.5% | | |
| Pass rate, holdout only | 96.7% | 96.7% | | |
| Data leaks | 1 | **0** | 0 | yes |
| Escalation recall | 100% | 100% | at least 95% | yes |
| False escalation | 0% | 0% | under 15% | yes |
| Grounding | 100% | 100% | 100% | yes |
| Injection flagged in trace | 100% | 100% | | |
| Latency p95 (mock mode) | under 1 ms | under 1 ms | under 100 ms | yes |

## How to read this honestly

- **Both fixes came from tune cases.** The holdout pass rate did not move (96.7% before and after). Tuning did not leak into the score, and the one holdout failure (L-01) is still visible.
- **This is the deterministic system, not the model.** The mock model follows the same JSON protocol, so every schema check, tool, and guard runs for real. But whether a live model writes good answers is not measured here. 0 leaks is the strongest claim: it holds *regardless* of the model, because leaks are blocked in `get_order` and the output guard, which no model output bypasses.
- **Escalation recall of 100% is partly by construction.** Refunds, cancellations, and chargebacks are routed by deterministic rules before the model runs. That is the design: these are the cases where a probabilistic miss is unacceptable.
- **Not yet run:** a live-LLM eval and a live-JEV ablation. No API keys were available in the build environment. The harness supports both (`--llm=openai`, `--jev=on`), and the results would be saved next to these.
