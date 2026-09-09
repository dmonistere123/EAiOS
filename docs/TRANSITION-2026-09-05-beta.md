# EAiOS → Beta Transition Document

**Date:** 2026-09-05 · **Repo:** `https://github.com/dmonistere123/EAiOS` · **Branch:** `main` · **Local commit:** `38dd2ee`

## What is ready for beta

| Area | Status |
|---|---|
| Core app shell + routing | ✅ |
| Schedule / Today / Staff / Knowledge pages | ✅ |
| My Assistant page with voice I/O (mic + read-aloud) | ✅ |
| Travel page (F31) as roadmap demo | ✅ |
| Live flight search via Duffel | ✅ |
| Ask Ally natural-language travel search | ✅ |
| Mock/live adapter symmetry | ✅ |
| Installer (`install/install.sh`) with Node + Hermes + EAiOS setup | ✅ |
| Configurable orchestration agent name (`VITE_AGENT_NAME`) | ✅ |
| Tests | 304 passed, 10 skipped |
| Production build | ✅ |

## What must happen before beta

### 1. Push current local commits to GitHub
- Local `main` is **2 commits ahead** of `origin/main`:
  - `a8f3522` — F31 Travel, Ask Ally, voice I/O, installer
  - `38dd2ee` — configurable agent name
- Approval task: **t_81f476c8** (`cd /home/ally-landry/eaios && git push origin main`)

### 2. Fresh-box installer validation
- Run `install/install.sh` on a real fresh VM/box end-to-end.
- Verify all four `eaios-*` services start and `:5200` responds.
- Confirm the agent-name prompt works and the UI reflects the chosen name.

### 3. Environment / secrets
- Decide which live APIs will be in beta:
  - Duffel flights ✅
  - Hotels / cars / restaurants — still mock/demo only
- Provide real keys for the beta box's `app/.env.local`:
  - `VITE_HERMES_TOKEN`
  - `COMPOSIO_API_KEY`
  - `DUFFEL_API_KEY`
- Confirm `~/.hermes/.env` has `OPENROUTER_API_KEY` for Ask Ally intent parsing.

### 4. Hermes profile setup on beta box
- Install Hermes or let the installer do it.
- Create/configure the Hermes profile for the chosen agent name.
- Link the Hermes gateway token to `VITE_HERMES_TOKEN`.

### 5. Travel provider decision
- Option A: keep Travel as roadmap demo (`Travel (RM)`) and add live providers later.
- Option B: integrate a T&E platform (Navan/Spotnana/TravelPerk) or Booking.com browser automation.
- **Recommendation:** keep Option A for beta; travel booking is a post-beta feature.

### 6. Browser-automation booking
- Currently deferred and tests skipped.
- Before beta, decide whether to:
  - Remove the skipped tests and `server/travelBrowser/` code, OR
  - Keep it as a documented roadmap spike.

### 7. Documentation / copy review
- Update `docs/INSTALL.md` with final repo URL and any beta-specific notes.
- Review `docs/HANDOFF.md` for accuracy.
- Ensure no hardcoded "Ally" remains in user-facing strings (comments OK).

### 8. Telemetry / spend watchdog
- Verify the existing `scripts/spend-watchdog.py` cron is configured on the beta box.
- Confirm OpenRouter/model spend limits are acceptable.

## What is intentionally out of beta scope

- Live hotel / car / restaurant booking
- Browser-automation reservation flow
- Encrypted credential vault for consumer-site logins
- Multi-CEO packaging (Hermes profile per CEO)

## Files that changed since last push

```
app/.env.local.example
app/src/config.ts
app/src/pages/Assistant.tsx
app/src/pages/Schedule.tsx
app/src/pages/Today.tsx
app/src/pages/Travel.tsx
docs/INSTALL.md
install/install.sh
```

## Exact command for the next session

> "Continue EAiOS beta prep from the 2026-09-05 transition. Read `~/eaios/docs/TRANSITION-2026-09-05-beta.md` and `~/eaios/docs/HANDOFF.md`. Approve and push the pending GitHub approval task `t_81f476c8`, then validate the installer on a fresh box, configure beta secrets, and finalize the go/no-go list."

## Risk summary

| Risk | Level | Mitigation |
|---|---|---|
| Installer untested on a truly fresh box | Medium | Run end-to-end on a clean VM before beta |
| Secrets not yet on beta box | Medium | Copy `.env.local` and `~/.hermes/.env` securely |
| Travel is demo-only | Low | Label is `Travel (RM)`; set expectations |
| Browser-automation code skipped | Low | Remove or keep documented before beta |
