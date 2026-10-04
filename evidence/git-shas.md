# Git SHAs in the raw runs

The raw run files in `runs/` are kept exactly as they were written. Some record a `git_sha` that no longer exists in this repository: the history was rewritten once (author fix, before v0.1.0 was published), which changed every commit SHA. The content of the commits did not change.

| SHA in a run file | Files | Same content in the current history |
| --- | --- | --- |
| `c037192` | `runs/eval-baseline-2026-10-04T09-47-40-593Z.json` | `b785912` (backend, guards, tools, and tests) |
| `04217cf` | `runs/eval-final-jev-off-2026-10-04T11-03-58-615Z.json`, `runs/eval-final-jev-mock-2026-10-04T11-03-58-675Z.json`, `runs/eval-ablation-jev-down-2026-10-04T11-03-58-728Z.json` | `1a0fda0` (live mode). These three runs were made on an uncommitted working tree on top of that commit; those changes were committed next, as `81d3722` |
