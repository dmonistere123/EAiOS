# Daily Planner: private 2EP prototype

## Start here

This branch is based on the verified code-only v0.1.26 candidate (54a6a8a3e9b83a1ccd70c3ccf6cdd0e6278139b8). That candidate includes Today’s E-CRM note follow-ups and the DCR actions. It is not Don’s live private build and contains no live state, ECP credentials, or Moxie connection. Source review for the ECP behavior used the committed local Daily Planner snapshot be3cb6742db8001a03a2ac1f2dff24e8ed8a5dba. The ECP checkout had existing pending auth/style edits and was not changed.

Run this **on the computer hosting the preview**, from the development checkout:

    cd app
    EAIOS_PLANNER_PREVIEW=1 npm run dev:planner

Open http://127.0.0.1:5284/daily-planner in the browser on that computer. Get the synthetic preview code locally in a separate terminal from the same checkout:

    cd app
    node -e 'process.stdout.write(require("../.local/daily-planner-preview/preview-access.json").executive + "\n")'

Copy it into “Preview access code.” Do not use a real account password. “second-user” in the same local file is a separate synthetic identity. The default preview starts empty and the sample E-CRM record belongs only to the first test user. Do not use real records or private file uploads. Ctrl+C stops the preview; an ordinary 2EP start or build never activates it. The preview binds to loopback with a strict port and does not load live env files or initialize Hermes, Outlook, Moxie, or ECP. To try flag-off, run the same preview command without EAIOS_PLANNER_PREVIEW.

### Quick walkthrough

1. Today shows what needs attention. Daily Planner appears directly below it. Sign in and add a task to The One, then confirm it appears in My Plan on Today.
2. Schedule a task for tomorrow, find it under Upcoming, and use an open task’s Done + follow-up action. The original completes and the new item is linked; the original retains its files.
3. Add the sample E-CRM follow-up from Today, choose a lane/date, and follow its link to the exact note. Repeating Add returns the same task, without changing the E-CRM reminder.
4. Use Delegate · preview on a task, choose Ally or the sample human, and explicitly choose context. Simulate a result. It stays open until accepted; rejection leaves the task open. This does not exercise the live delegation or approvals backend.
5. Try the journal and monthly time. A client rename does not rename already recorded entries.

## Architecture and parity

| Area | ECP behavior/reference reviewed | 2EP prototype behavior | Boundary |
| --- | --- | --- | --- |
| Navigation | Personal planning separate from strategy | Full page below Today and compact My Plan, using only title/status/aggregate counts | Corporate pages and roles remain untouched |
| One / Three / Five / Backlog | Active priority lanes, completed remain visible, explicit replacement | Owner/date scoped SQLite, serialized lane checks, explicit demotion, reorder and due dates | Existing personal source may contain older records that do not fit current lane policy |
| Calendar | Today, chosen date, future schedule, linked follow-up | Date picker, Upcoming, atomic complete-and-create, date/source separate from due date | Explicit time-zone validation; no automatic reminder generation |
| Carry / history | Active work carries; priority carry age tracked | Same task ID, prior dated placement and activity history; overflow goes to Backlog without replacing priorities | Compare account-specific archive and 12-month retention behavior before migration |
| Journal | Notes, time-stamped notes, Quick Hits, gratitude, ratings, reflection | All saved privately per date, including Legacy Impression; timestamped note add/remove | No visibility in Today, global search, staff, or agent context |
| Files | Supported PDF/Office/text/image types, 20 MB | Private DB BLOBs with SHA-256 and attachment-only download; notes/files not shared by default | Task files only; real ECP Storage export not connected |
| Time | Client creation, daily entries, monthly client totals, duration_seconds | Same workflow with stable client IDs, per-entry client name, exact seconds and DST checks | No invoicing or CRM client auto-creation |
| E-CRM | Existing Today follow-up links to exact note | Typed reference to a read-only synthetic source, no copied note body and no extra reminder | Preview CRM fixture only; real store permission/source availability not tested |
| Delegation | Separate human/AI work with owner acceptance | Simulated Ally/human, minimum selected context, one linked result, explicit accept/reject | Production routing, approval and handoff delivery are not connected |
| My Plays/shared work | Explicit corporate connections | No corporate import and no required ECP connection | Optional ECP links are not configured in this prototype |
| Import | One authorized personal source | SQL transaction, synthetic fixture boundary, ID/parent mapping, counts and attachment digest checks, exact monthly second reconciliation | No real ECP export, upload, credential, schema modification or activation |

The code-only build’s server identity is the box/display identity, not a signed-in per-user principal. No browser-supplied user ID is trusted. The prototype’s narrowly scoped session identities exist only in the dedicated loopback preview. Before enabling a real pilot, review and implement how production’s serving boundary will authenticate and map the authorized owner. Do not reuse sample access codes as production authentication.

## Data and recovery

The normal preview stores its SQLite database, including file bytes, under .local/daily-planner-preview/planner-data. This is separate from 2EP’s live data, browser storage, and ECP. Access codes are local and private. Closing and reopening the preview preserves the database but intentionally clears browser sessions. Only identifiers and the minimal summary go to Today; no time entry, journal, attachment or task body is in the summary response. Turning the flag off does not delete state.

For a **synthetic** backup, stop the preview first and copy its planner-data directory to a new private backup directory. To rehearse restore, use a different empty private preview state or the automated restore fixture; validate the row counts, monthly total, attachment hashes and parent links, then reopen. Do not overwrite an existing data directory as a test. Access codes are not necessary to back up the database; a new private preview can generate fresh codes. Ordinary production backup and updater packaging were not modified. For a real cutover, implement and prove the supported backup inclusion first.

The importer is deliberately not an HTTP endpoint or a live export path. The automated fixture verifies an explicit owner mapping, dry-run rollback, application, replay without duplication, bad-file rollback, ID/parent preservation, exact total, attachment bytes and restore. Before any future real use, validate the actual ECP personal schema and available history/attachments, add a user-scoped adapter, rehearse on an approved protected staging copy, reconcile by record type/date/month and checksum, and preserve the source intact. Live import, changes to the source, production deployment, installer work, and public distribution are outside this branch.

## Checks

Run from app:

    npm test -- src/tests/planner-preview.test.ts
    npm test
    npm run lint
    npm run build

Browser QA uses the dedicated port, an isolated fixture run ID, synthetic identities and a browser context that blocks every off-origin request. Launch with EAIOS_PLANNER_PREVIEW=1 and EAIOS_PLANNER_BROWSER_TEST_RUN set to the same unique lowercase fixture ID in both processes. Start npm run dev:planner in one terminal, then run node scripts/planner-browser-qa.mjs in the other. Stop the test server before launching the normal preview.

## Review refinements, November 23, 2026

- The One, The Three, The Five and Backlog are stacked in the center column. Timestamped Notes and its timeline sit immediately beneath Backlog. The right-hand Daily Journal keeps Notes for the Day, Gratitude, Quick Hits, Legacy Impression, Reflection and the ECP-style day rating. Journal edits autosave. At narrow widths, the Journal is available as a collapsible section without duplicating a draft.
- Complete from the task checkbox or status control to finish now or schedule a dated Backlog follow-up. Plan Tomorrow, carry forward from the most recent unfinished day and the Scheduled list are visible in the day plan. Past days supports prior-year archiving without deletion; Archived days retains access. Repeat options are daily, weekdays, weekly and monthly, with separate occurrences; shareable CSV requires explicit selection and excludes task notes, journal and attachments.
- These refinements use the inspected ECP source as a behavior reference without connecting to its live account. The private preview still uses synthetic CRM and delegation, and does not implement ECP workspace handoffs or real data import. Archive navigation and some historical controls still differ. This is not full ECP parity or a production release.
