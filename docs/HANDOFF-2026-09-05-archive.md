# EAiOS — Session Handoff

**Updated:** 2026-09-04 · **Repo:** `~/eaios` · **Branch:** `master` · **Head:** `b881578`

## What just happened

This session shipped the **browser-automation travel booking foundation** (t_a0417617) on top of the existing Travel page (F31).

- New `server/travelBrowser/` module:
  - AES-256-GCM encrypted credential vault (`vault.ts`).
  - Encrypted per-site cookie/session store (`sessions.ts`).
  - Per-site playbook registry (`playbooks.ts`) with Kayak generic playbooks for hotels/cars and stubs for IHG, Marriott, OpenTable, Resy.
  - Python browser-use runner bridge (`runner.ts` + `runner.py`) invoked via subprocess.
  - Approval-gated `executeBooking()` that stops before final checkout.
  - `/api/travel/browser-status` + `/api/travel/browser-vault/sites` endpoints.
- `server/travel.ts` wired to use the new module for hotel/car/restaurant searches and to execute browser-use bookings on approval.
- `Travel.tsx` shows a dynamic browser-provider status banner.
- `TravelApproval` gained `resultId` so approved bookings can replay the original search offer.
- Design doc: `docs/design-browser-booking-2026-09-05.md`.
- Tests: `src/tests/travelBrowser.test.ts` (+10 tests); full suite 261/261 vitest green.
- Build clean; prod server smoke-tested on :5201 with env vars.

## Current state

- **Tests:** 261/261 vitest + 8/8 sidecar unittest green.
- **Build:** clean production build in `~/eaios/app/dist`.
- **Services:** all four `eaios-*` systemd user services active:
  - `eaios-hermes-serve` :9119
  - `eaios-knowledge-sidecar` :9121
  - `eaios-server` :5200
  - `eaios-server-5173` :5173 (vite dev proxy)
- **Commits:** uncommitted work in progress from this session (`git status` shows changes). There is **no remote configured**.
- **Browser booking:** NOT YET ENABLED in production. To enable, add to `eaios-server.service` Environment lines (or a drop-in):
  - `TRAVEL_BROWSER_USE=1`
  - `CHROME_BIN=/home/ally-landry/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome`
  - `TRAVEL_BROWSER_VAULT_KEY=<base64 32-byte AES key>`
  - `OPENROUTER_API_KEY=<existing key from ~/.hermes/.env>`
  Then `systemctl --user daemon-reload && systemctl --user restart eaios-server`.

## Git log (recent)

```
(work in progress on t_a0417617; not yet committed)
```

## What to tell the next Ally

Start the new session with:

> "Continue EAiOS from the 2026-09-05 handoff. Read `~/eaios/docs/HANDOFF.md`, `~/eaios/docs/ROADMAP.md`, `docs/design-browser-booking-2026-09-05.md`, and `~/eaios/docs/TRANSITION-2026-09-04.md`. Verify services with `systemctl --user status 'eaios-*'` and run `cd ~/eaios/app && npm test` before making changes."

If the next task is one of these, include it explicitly:

- **Browser booking per-site hardening:** pick one of IHG / Marriott / OpenTable / Resy and make the search + stop-before-checkout playbook reliable.
- **Password-manager vault backend:** replace the file vault with Bitwarden/1Password/keychain integration while keeping the same adapter interface.
- **In-app credential manager:** a drawer/page to add/edit/delete site credentials and view browser-provider status.
- **Enable browser booking in prod:** add the Environment lines to the systemd unit (requires Don approval).
- **Telephone voice access (F32):** PSTN/SIP inbound voice via Twilio/Telnyx/Vonage + STT/TTS + messaging gateway integration.
- **Push commits:** add a git remote and push `master`.
- **New functional fix:** state the page and the exact behavior wanted.

## Open items for Don

- Decide whether to enable browser booking in `eaios-server.service` (env vars above).
- Decide whether to add a git remote and push.
- Approve / review child tasks spawned from t_a0417617 for per-site playbook hardening.

## Historical handoffs

Older session state is preserved in `docs/HANDOFF-2026-08-30-archive.md` and `docs/TRANSITION-2026-09-04.md`.
