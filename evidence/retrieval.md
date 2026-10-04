# Retrieval benchmark

41 labelled questions in [`eval/retrieval.yaml`](../eval/retrieval.yaml), one or two per knowledge base page, each written once in the page's own words ("direct") and once the way a customer might say it instead ("paraphrase"). Run with `bun run eval:retrieval`. A floor runs in the test suite: at most one direct question may fall out of the top 3, and overall hit@3 must stay at or above 80%.

| Metric | BM25 (shipped) |
| --- | --- |
| hit@1 | 73.2% |
| hit@3 | 82.9% |
| hit@3, direct wording | 95% |
| hit@3, paraphrased | 71.4% |

Full list of misses: [runs/retrieval-bm25-baseline.md](runs/retrieval-bm25-baseline.md). This is the first and only run. I did not tune synonyms against it, because that would turn a benchmark into a fitted curve.

## What it decided

The agent already does retrieval-augmented generation: it retrieves first, answers only from what it retrieved, and has its citations checked. The open question was which retriever to use. The 24-point gap between direct and paraphrased questions is the evidence for the next step: keep BM25 as the default (deterministic, no key, scores visible in the trace) and add embedding re-ranking as a live-mode option, judged by whether paraphrase hit@3 actually rises on this same benchmark. Putting the whole knowledge base in the prompt was rejected because every page would count as "retrieved", and the citation check would stop meaning anything.
