# Changelog

## v0.1.1

Pre-submission revision. No changes to the agent's behaviour, prompts, rules, knowledge base, or eval cases.

### Fixed
- `ALLOW_BYOK` parsing: `yes`, `on`, quoted values, and surrounding spaces are now understood, and an unrecognised value falls back to the default (live mode available) instead of silently turning live mode off. One test added (155 tests).
- Release workflow: bundle names with spaces no longer break the release step, and Android is built as a signed release APK for arm64 and x86_64 (10.3 MB) instead of a 440 MB debug build. The APK change produced the APK in the v0.1.0 release. The fix for names with spaces had not run yet: the v0.1.0 release was assembled by hand from the CI build files.
- Release checksums: files are renamed to the dotted names GitHub shows before `SHA256SUMS.txt` is written, so every line matches a download.

### Documentation
- README, `DECISIONS.md` (ADR-11), and `evidence/smoke-checklist.md` now state the native build status as it is: all four platforms build in CI, macOS was tested locally, and Windows, Linux, and Android have not yet been smoke-tested on a real device. The macOS size is the 3.5 MB universal `.dmg`.
- README: a section on the public demo at https://tapak.adefebrian.com (mock by default, bring-your-own-key enabled, limits).
- `evidence/ablation-jev.md`: the JEV outage pass rate is now the measured 32.5%.
- `evidence/git-shas.md`: explains why some raw run files name commit SHAs that no longer exist (history rewritten once to fix the commit author).
- `AI_USAGE.md`: notes that the PRD was drafted with Claude, and what the `.claude/` folder is.

### Repository
- The PRD moved from the repo root to `docs/PRD.md`.
- `.gitattributes` removed, so the source ZIP, the GitHub release, and the repository contain the same files.
- Version 0.1.1 in `tauri.conf.json`, `Cargo.toml`, and `Cargo.lock`.

## v0.1.0

First release: agent server, web client, Tauri apps for macOS, Windows, Linux, and Android, eval harness, and evidence.
