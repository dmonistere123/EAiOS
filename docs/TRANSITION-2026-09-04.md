# EAiOS — Session Transition 2026-09-04 (midday)

**Read this AFTER docs/HANDOFF.md.** Supersedes TRANSITION-2026-08-29.md as
the current point-in-time state. The 08-29 doc stays for its backup/restore
instructions. This conversation ran Aug 30 → Sep 4 — below is everything it
changed and what the next session inherits.

## Verified state at close

- **234/234 vitest + 8/8 sidecar green; `npm run build` clean.**
- Services (systemd user units, all active): `eaios-hermes-serve` :9119 ·
  `eaios-knowledge-sidecar` :9121 · `eaios-server` :5200 ·
  **`eaios-server-5173`** (prod.ts front door, sibling session added — 5173
  is prod now, NOT vite dev; the `eaios-vite-dev` question is likely moot).
- **Uncommitted tree is intentional and bigger now** — do NOT commit without
  Don's say-so. New this session: `config/rate-card.json`,
  `scripts/spend-watchdog.py`, `src/tests/usage-daily.test.tsx`, concierge
  widget + test changes, Usage page + apiCore/httpApi/vite.config/adapter/
  runtime/fixtures daily-spend work.

## What landed this session

1. **Concierge New-chat (Aug 30, t_09cc51e8)** — header "New" button (was ↺,
   then text per Don), subtitle shortened to "Ally's Guide" (was crowding the
   button); fresh concierge lane via generalized `startNewAssistantChat(agentId)`;
   example chips resurface on clear; live-probed (`scripts/verify-concierge-newchat.mjs`).
2. **Token-spend audit (t_9021929d)** — Sep 2 = **$11.35** at public K3 rates
   (matches Don's ~$12 bill); >50% was ONE 10-day-old Telegram thread
   ("Casual check-in" $5.96). Long threads are THE cost driver; background
   is a drip. Method: `session_model_usage` across profile DBs, fresh in+out
   only, cache excluded (validated vs real bill within ~5%).
3. **Tiered model routing (F30, in progress)** — OpenRouter key user-installed
   (agent can't write `~/.hermes/.env` or config.yaml by design; Don ran the
   echo himself after two quoting fumbles — keys need NO quotes in echo).
   Services restarted to re-read .env (**file-loaded at startup, not inherited
   env**). All 3 weekday-7am crons pinned `openrouter/deepseek-v4-flash` via
   `cron edit --provider/--model` (verified supported). Global fallback chain
   set via `hermes config set`: **kimi-k3 → openrouter deepseek-v4-flash**.
   Live cron fire proved end-to-end: DeepSeek scanned 200 emails, created 3
   CORRECT unassigned approval envelopes, delivered to Telegram — **$0.011/run**
   (was ~$0.15-0.20 on K3).
4. **F29 spend watchdog** — no-agent cron `d0f0f4fb3ba9` daily 06:30 →
   Telegram, silent under **$5/day** (Don's threshold). Plus **in-app**: Usage
   page "Daily estimated spend" card (14-day bars, breach flags, day→top-
   sessions drill-down, threshold editor). Single source of truth:
   **`config/rate-card.json`** (app + watchdog) and
   **`settings.local.json dailySpendAlertUsd`** (threshold — page edits it,
   watchdog reads it). `/api/usage/daily` rides the shared router like
   /api/kanban (+ vite delegate passthrough — inline usage middleware skips
   `/daily`).
5. **Ally model trial STARTED** — Don set the default profile to
   **`kimi-k2.7-code-highspeed`** via the Staff page (verified live:
   config.yaml updated, one-shot answered). Highspeed = $1.90/$8.00 (2×
   standard k2.7-code $0.95/$4.00, still ~40% under K3). Rate card updated
   (highspeed entry BEFORE kimi-k2.7 — first match wins). **Next session IS
   the trial: judge orchestration quality; revert = Staff picker → kimi-k3.**
6. **Hermes update pending — 6,672 commits behind** (v0.20.5, Aug 19 build).
   Deferred deliberately (Don's box flips last; EAiOS rides probed RPC shapes
   that may drift). Planned path: `hermes backup` → `hermes update` → restart
   eaios units → re-run probe scripts + full vitest. Pick a quiet window.

## New host gotchas (not yet in HANDOFF)

- **Box desktop is WAYLAND** — computer_use sees ZERO windows via X11
  (capture fails XGetImage BadMatch; doctor green but useless). Experimental
  backend: `CUA_DRIVER_RS_ENABLE_WAYLAND=1` (opt-in, not enabled).
  browser-use needs Chrome; only snap Firefox installed. **Don drives his own
  browser for GUI tasks.**
- **`hermes cron edit` supports `--model/--provider`** — no recreate needed.
- **config.yaml + ~/.hermes/.env are agent-write-protected** — use
  `hermes config set` (works for fallback_model) or ask Don.
- **`session_model_usage` has `billing_provider`** — openrouter rows are
  distinguishable from kimi-coding rows (watchdog/rate card rely on model id).
- **"Delegated-work completion notifier" cron is GONE** (was every-5m
  telegram of completed kanban tasks; vanished between Aug 30 and Sep 4 —
  only the 3 briefings + the new watchdog exist). The governance-v3 delivery
  guarantee is currently SOUL-compliance-only again. `scripts/notify-completions.py`
  is still in the repo — **decide whether to recreate it.**

## Open threads for next session

1. **Ally trial (k2.7-code-highspeed)** — judge quality; revert path above.
   If highspeed feels pricey, standard `kimi-k2.7-code` = 2× cheaper.
2. **Monday 7am:** first DeepSeek briefings — judge floor-model quality.
   First watchdog run: tomorrow 06:30 (silent unless a day exceeds $5).
3. **Approvals waiting (approve = EXECUTE):** 3 from today's email triage
   (t_9c41f1ef Waterford HOA draw reply, t_09185843 Breakcold annual pricing,
   t_5c12e080 GLG interest) + the 2 older ones (Investor update — 14
   recipients CRITICAL; Partnership announcement HIGH) — verify board state.
4. **Don wants EAiOS issue-fixing** — candidates: ~7 unassigned pre-briefed
   board tasks (InsecureWeb credits t_13f9b356, Grok crew, Qualys, Kit,
   board-deck…), F22 (vite.config consolidation — 5173 is prod now, so this
   may be FREEABLE), F24 (specialist worker transcripts), polish F16/F17/
   F20/F21, recreate completion-notifier decision, Hermes update window.
5. **Phase 8.3** — Don wipes openclawserver, walks clean-install-guide timed
   (needs fresh Nous/OpenRouter key for THAT box + pet name).

## To resume (what Don should paste)

> Continue EAiOS — read ~/eaios/docs/HANDOFF.md, ~/eaios/docs/BUILD-PLAN-v2.md,
> ~/eaios/docs/beta-readiness-plan.md, and ~/eaios/docs/TRANSITION-2026-09-04.md.
> Uncommitted work in the tree is intentional — do not commit unless I say so.
> First check: systemctl --user status 'eaios-*', npm test in ~/eaios/app,
> git status in ~/eaios. Note: I keep my own roadmap notes at
> ~/Desktop/EAiOS-ROADMAP.md — check it for new items and reconcile into
> docs/ROADMAP.md. I want to fix issues on EAiOS — check the board and the
> transition doc's open threads.
