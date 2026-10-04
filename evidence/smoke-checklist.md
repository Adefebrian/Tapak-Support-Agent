# Client smoke checklist

Run 2026-10-04 on macOS (Apple Silicon), Bun 1.3.14, server in mock mode.

## Web (http://localhost:8787)

| Check | Result |
| --- | --- |
| `bun run setup` seeds the DB and builds the client | pass |
| Chat: verified order shows status, order card timeline fills, pipeline lights stage by stage over SSE | pass |
| Chat: Tapi's bubble narrates each streamed stage; each outcome plays its own scene (hop, parcel, padlock, shield, raised hand, handover to Sari) | pass, checked by eye, all 11 scenes on the How it works page |
| Chat: citation chip opens the source page (lists and tables rendered); quick replies send the follow-up | pass |
| Live mode dialog: key fields are password inputs, nothing written to storage | pass (checked in the UI). Key validation, rejection, binding, and the kill switch are covered by `live-mode.test.ts` against a stubbed provider. Not tried in the browser with a real or fake key, since that would call an external API |
| Chat: chargeback threat shows "Escalated", ticket ID, orange path in pipeline | pass |
| Chat: conversation survives switching tabs | pass |
| Escalations: new tickets appear within 5 s, status change persists | pass |
| Traces: sessions list, per-turn waterfall, raw JSON link | pass |
| How it works: each scenario animates the real route, auto play cycles | pass |
| `prefers-reduced-motion`: animations collapse to instant state changes | `ui_audit` reduced-motion rule passes; code path (MotionConfig `reducedMotion="user"`, canvas draws the final frame) reviewed, not checked by eye |
| JAL `ui_audit` at 320, 375, 414, 768, 1280 on all 4 screens, final build | PASS, 0 violations (including the reduced-motion rule: the character canvas stops its loop and draws one settled frame) |
| Path traversal on static files (`/%2e%2e/...`, `/..%2f..`) | serves `index.html`, no file outside `public/` |
| Security headers present (`x-frame-options`, `nosniff`, `referrer-policy`) | pass |

## Native

| Check | Result |
| --- | --- |
| macOS: `bunx tauri build --bundles app` in `apps/native` | pass, `Tapak Support.app` 3.37 MiB, release profile. Built before the final UI changes; the Tauri config has not changed since, and the app loads whatever web build it is given |
| macOS: app launches and reaches the local backend (`tauri://localhost` origin passes CORS) | pass, verified by a new row in `sessions` |
| Windows (.msi, .exe), Linux (.AppImage, .deb), universal .dmg | via `.github/workflows/native.yml`, not run locally |
| Android debug APK | via `native.yml` (`android` job), not run locally; emulator uses `http://10.0.2.2:8787`, cleartext enabled for that in CI |
