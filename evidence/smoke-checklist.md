# Client smoke checklist

Run 2026-10-04 on macOS (Apple Silicon), Bun 1.3.14, server in mock mode.

## Web (http://localhost:8787)

| Check | Result |
| --- | --- |
| `bun run setup` seeds the DB and builds the client | pass |
| Chat: verified order shows status and tracking, pipeline replays 7 stages | pass |
| Chat: chargeback threat shows "Escalated", ticket ID, orange path in pipeline | pass |
| Chat: conversation survives switching tabs | pass |
| Escalations: new tickets appear within 5 s, status change persists | pass |
| Traces: sessions list, per-turn waterfall, raw JSON link | pass |
| How it works: each scenario animates the real route, auto play cycles | pass |
| `prefers-reduced-motion`: animations collapse to instant state changes | `ui_audit` reduced-motion rule passes; code path (MotionConfig `reducedMotion="user"`, canvas draws the final frame) reviewed, not checked by eye |
| JAL `ui_audit` at 320, 375, 414, 768, 1280 on all 4 screens | PASS, 0 violations |
| Path traversal on static files (`/%2e%2e/...`, `/..%2f..`) | serves `index.html`, no file outside `public/` |
| Security headers present (`x-frame-options`, `nosniff`, `referrer-policy`) | pass |

## Native

| Check | Result |
| --- | --- |
| macOS: `bunx tauri build --bundles app` in `apps/native` | pass, `Tapak Support.app` 3.37 MiB, release profile |
| macOS: app launches and reaches the local backend (`tauri://localhost` origin passes CORS) | pass, verified by a new row in `sessions` |
| Windows (.msi, .exe), Linux (.AppImage, .deb), universal .dmg | via `.github/workflows/native.yml`, not run locally |
| Android debug APK | via `native.yml` (`android` job), not run locally; emulator uses `http://10.0.2.2:8787`, cleartext enabled for that in CI |
