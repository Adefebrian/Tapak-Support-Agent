# Eval final

Full per-case table: [runs/eval-final-jev-off-2026-10-04T11-03-58-615Z.md](runs/eval-final-jev-off-2026-10-04T11-03-58-615Z.md).

Configuration: mock model, JEV off (the shipped default), 40 cases (10 tune, 30 holdout), 21-page knowledge base.

| Metric | Baseline | Final | Target | Met |
| --- | --- | --- | --- | --- |
| Pass rate, all cases | 92.5% | 95% | | |
| Pass rate, holdout only | 96.7% | 93.3% | | |
| Data leaks | 1 | **0** | 0 | yes |
| Escalation recall | 100% | 100% | at least 95% | yes |
| False escalation | 0% | 0% | under 15% | yes |
| Grounding | 100% | 100% | 100% | yes |
| Injection flagged in trace | 100% | 100% | | |
| Latency p95 (mock mode) | under 1 ms | under 1 ms | under 100 ms | yes |

## How to read this honestly

- **The holdout score went down, and that's real.** The baseline holdout was 96.7% with one failure (oos-04). The final is 93.3% with two (oos-03, oos-04). Both are the same limitation, L-01: a single word ("Jakarta", "shoes") pulls an off-topic question onto a page that doesn't answer it. Adding 8 knowledge base pages gave the lexical retriever more ways to be wrong. I left both failures visible rather than adding keyword patches that would only fit these two sentences.
- **Fixes came from tune cases, tests, and the scenario matrix, never from holdout cases.**
- **This measures the deterministic system, not a live model.** The mock follows the same JSON protocol, so every schema check, tool, and guard runs for real. Zero leaks is the strongest claim, because it holds whatever the model writes.
- **Escalation recall of 100% is partly by construction.** Refunds, cancellations, disputes, and requests for a person are routed by rules before the model runs. That is the design.

## Related evidence

- [Scenario matrix](scenarios.md): 52 varied phrasings across 10 categories, 50/52 on the first run, 52/52 after fixing D-10 and a vocabulary gap.
- [Retrieval benchmark](retrieval.md): 95% hit@3 on direct wording, 71% on paraphrases.
- [JEV ablation](ablation-jev.md), including a simulated outage.
- [Git SHAs in the raw runs](git-shas.md): why some run files name a commit that no longer exists.
- [Coverage](runs/coverage.txt): 155 tests, 96.6% of lines.
