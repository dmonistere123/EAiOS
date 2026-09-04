# EAiOS — Session Handoff

**Updated:** 2026-09-04 · **Repo:** `~/eaios` · **Branch:** `master` · **Head:** `b881578`

## What just happened

This session shipped **6 functional beta fixes** and deployed them to the local prod server on `http://127.0.0.1:5200`.

1. **Schedule → Completed last 3 days** (was 24h).
2. **Knowledge upload → pick target agent** for source scope.
3. **Approval inspector → edit the prepared payload**, save, then approve.
4. **Schedule right rail → delete** for Calendar / Agent schedules / Cron jobs.
5. **Assistant chat → attach a document** (text inline, binary as base64 note).
6. **Skills & Playbooks → Disable/Enable + Delete** actions.

Also:
- Updated Hermes Agent from `v0.20.5` → `v0.21.0` via `hermes update`.
- Rebuilt the app and restarted `eaios-server.service` so the changes are live on `:5200`.
- Added roadmap items **F31 (Travel)** and **F32 (Telephone voice access)** with UX direction.

## Current state

- **Tests:** 243/243 vitest + 8/8 sidecar unittest green.
- **Build:** clean production build in `~/eaios/app/dist`.
- **Services:** all four `eaios-*` systemd user services active:
  - `eaios-hermes-serve` :9119
  - `eaios-knowledge-sidecar` :9121
  - `eaios-server` :5200
  - `eaios-server-5173` :5173 (vite dev proxy)
- **Commits:** everything is committed locally. There is **no remote configured** — commits are on this box only.
- **Uncommitted tree:** none.

## Git log (recent)

```
b881578 docs(roadmap): Travel page UX direction - cards + upcoming trips with tabs
5194e23 docs(roadmap): F31 travel deserves dedicated left-nav page
c7d1ac0 feat: 6 functional beta fixes
423fe5d fix: use .ts extension for authoring import so prod server resolves at runtime
```

## What to tell the next Ally

Start the new session with:

> "Continue EAiOS from the 2026-09-04 handoff. Read `~/eaios/docs/HANDOFF.md`, `~/eaios/docs/ROADMAP.md`, and `~/eaios/docs/TRANSITION-2026-09-04.md`. Verify services with `systemctl --user status 'eaios-*'` and run `cd ~/eaios/app && npm test` before making changes."

If the next task is one of these, include it explicitly:

- **Travel page (F31):** build a left-nav "Travel" page mirroring Schedule — top cards for Flights / Hotels & Cars / Restaurants, Upcoming trips list below, tabs per trip (Itinerary / Confirmations / Approvals). Use Amadeus Self-Service API for flights/hotels/cars and OpenTable partner API for restaurants; wrap bookings as EAiOS approval envelopes.
- **Telephone voice access (F32):** PSTN/SIP inbound voice via Twilio/Telnyx/Vonage + STT/TTS + messaging gateway integration.
- **Push commits:** add a git remote and push `master`.
- **New functional fix:** state the page and the exact behavior wanted.

## Open items for Don

- Google Calendar OAuth (executive calendar live).
- Composio app linking for Gmail/Outlook/LinkedIn (Connections page works; apps need auth configs in Composio).
- Decide whether to add a git remote and push.
- Approve Telegram summary task `t_9090d2bf` if it hasn't been sent yet.

## Historical handoffs

Older session state is preserved in `docs/HANDOFF-2026-08-30-archive.md` and `docs/TRANSITION-2026-09-04.md`.
