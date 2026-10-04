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
| macOS: `bunx tauri build --target universal-apple-darwin --bundles app,dmg` in `apps/native`, latest UI | pass, universal binary (x86_64 and arm64), `.dmg` 3.5 MB, new app icon confirmed inside the bundle |
| macOS: app launches and reaches the local backend (`tauri://localhost` origin passes CORS) | pass, verified by a new row in `sessions` |
| Windows (.msi, .exe), Linux (.AppImage, .deb), universal .dmg | built successfully in CI (`native.yml` runs 37199216968 and 37200057045); not smoke-tested on a real Windows or Linux machine. The CI-built `.dmg` itself was not opened; the local universal build of the same source was |
| Android APK | built successfully in CI as a signed release APK for arm64 and x86_64 (10.3 MB; APK signature v2 and v3 verified by `apksigner`; plain HTTP enabled for the release build so the emulator can reach `http://10.0.2.2:8787`). Not installed on a device or emulator |
