# EAiOS — Session Transition 2026-08-29 (evening)

**Read this AFTER docs/HANDOFF.md.** This is the point-in-time state at the
close of the biggest single day of the project. HANDOFF carries the durable
gotchas; this file carries "where we stopped and what's next."

## Backups taken

| What | Where |
|---|---|
| Hermes home (profiles, state.db, kanban.db, sessions, config) | `~/hermes-backup-2026-08-29-150552.zip` (148M) |
| Repo working tree (uncommitted diff + untracked files) | `~/eaios-repo-backup-2026-08-29-1507.tar.gz` (51K; patch + file copies) |

**UNCOMMITTED WORK — a full day sits in the tree** (Don has not asked for a
commit; do NOT commit without his say-so, but he may say so on resume):
orbital Staff org chart (OrgChart/index.css/staff-org tests) · Phase 8.1 prod
server (`app/server/{apiCore,httpApi,prod}.ts`, prod-server.test.ts,
package.json `start` script) · 8.2 systemd (`install/systemd/*.tpl`,
`scripts/install-systemd-user.sh`) · 48K-cap fix (adapter, runtime, AppShell
badge, vite delegate, dogfood-kanban-cap tests) · delegated-run visibility
(`/api/kanban-runs`, DelegatedRunDrawer, Assistant rail runs +
Conversations-merge, Schedule click-to-read, dogfood-delegated-runs tests) ·
docs (HANDOFF/ROADMAP updates, phase8-brief, clean-install-guide, this file)
· `scripts/notify-completions.py`.

## Verified state at close

- **222/222 vitest + 8/8 sidecar green; `npm run build` clean.** (Full-suite
  shows intermittent single-test timing flakes on refresh-dependent
  assertions — known test-infra issue, HANDOFF #26d; re-run before believing
  a failure.)
- Services (systemd user units, all active+enabled, linger on):
  `eaios-hermes-serve` :9119 · `eaios-knowledge-sidecar` :9121 ·
  `eaios-server` :5200. Health: `systemctl --user status 'eaios-*'`.
- **vite dev :5173 = Don's demo path** (he demos next week). Prod :5200 is
  functionally identical (proven 2026-08-29). Flip to prod happens LAST,
  after the clean-box proof — his call.
- New cron: **"Delegated-work completion notifier"** (no-agent script, every
  5m → telegram portal; silent when nothing new; dedup
  `~/eaios/notify-state.json`, gitignored). Every completed kanban task is
  now telegrammed deterministically.
- Live truths added today: board read = `/api/kanban` (cli.exec caps at
  exactly 48000 chars — gotcha #27); slice degradation is VISIBLE (⚠ badge,
  gotcha #27); worker transcripts readable via resume+history and surfaced
  in rail/Schedule (gotcha #28); kanban notify-subscribe is DEAD on this box
  (host gap, gotcha #28a); standalone kanban daemon is DEPRECATED.

## Open threads for next session

1. **Don wipes openclawserver** (100.112.177.101) and walks
   `docs/clean-install-guide.md` TIMED (prices the install fee). He needs:
   a **Nous Portal/OpenRouter key for that box** (never copy this box's) and
   a **pet name** for the test main agent (`--name`). Tailscale SSH as root
   works (policy allows root only; create a regular user inside).
2. **Phase 8 remaining:** 8.3 installer (`install/eaios-install` —
   deterministic + idempotent; systemd step already written), 8.4 docs,
   8.5 clean-box gate. Brief: `docs/phase8-brief.md` (ratified, incl.
   "flip this box LAST").
3. **2 approvals still pending** (Investor update — 14 recipients CRITICAL;
   Partnership announcement HIGH) — deciding EXECUTES (approve = assign =
   dispatcher runs it).
4. **Unassigned board tasks** (~7: InsecureWeb credits t_13f9b356, Grok
   crew, Qualys, Kit, board-deck…) — they never run until assigned; each is
   pre-briefed for delegation.
5. **Register:** F22 (vite.config consolidation — do pre-flip, not before a
   demo), F24 (specialist worker transcripts = per-profile state.db join),
   plus polish F16/F17/F20/F21.
6. ~~Orbital-desync cosmetic~~ **DISMISSED by Don 2026-08-29** — was just a
   screen refresh artifact, not a bug. Off the list entirely; do not fix.

## To resume (what Don should paste)

> Continue EAiOS — read ~/eaios/docs/HANDOFF.md, ~/eaios/docs/BUILD-PLAN-v2.md,
> ~/eaios/docs/beta-readiness-plan.md, and ~/eaios/docs/TRANSITION-2026-08-29.md.
> Uncommitted work in the tree is intentional (see transition doc) — do not
> commit unless I say so. First check: systemctl --user status 'eaios-*',
> npm test in ~/eaios/app, git status in ~/eaios.

## If the tree were ever lost

`tar -xzf ~/eaios-repo-backup-2026-08-29-1507.tar.gz` (untracked files land
in place), then `git apply /tmp/eaios-uncommitted-2026-08-29.patch`
(included in the tarball as `eaios-uncommitted-2026-08-29.patch`), then
`npm test` to confirm. Hermes home restores from the 148M zip.
