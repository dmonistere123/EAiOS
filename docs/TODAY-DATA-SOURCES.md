# Today data sources

Today reads existing tasks and approvals through the runtime adapter. It excludes
unassigned backlog from Priorities; the Saved tasks drawer preserves access and
assignment. Pending decisions and unfinished AI/human delegations cannot be hidden
by marking them reviewed. Explicit task relationships prevent duplicate priority
entries; similar titles are never treated as identity.

`GET /api/today/activity` reads each profile's `cron/executions.db` read-only,
showing runs completed or started in the trailing 24 hours. Job inventory supplies
names, not proof of execution. Missing or incompatible ledgers produce warnings.
Completed tasks in the last 24 hours remain in delivery history after review.
Schedule entries merge with task delivery only when an explicit `work_item_id`
exists in the ledger; legacy runs without that relationship stay independent.

Review markers are stored in `<HERMES_HOME>/eaios/today-state.db`. Writes use a
transaction, are safe across both dashboard processes, and require same-origin
JSON. Keys include the source revision or completion timestamp. Old markers are
pruned after seven days. Existing task dismissals are preserved but do not hide
pending obligations in the new queue.

The latest saved Executive Insights report supplies Delegatable. No generation,
assignment, email, or other provider write occurs merely by opening Today.
Discuss with Ally prepares a discussion in the Assistant; it does not execute it.

## Outlook calendars

`GET /api/today/meetings` uses Composio's verified active Outlook connections and
Microsoft Graph's read-only calendarView endpoint. It expands recurring events
for the browser's local calendar day, follows pagination, excludes cancellations
and declined invitations, and retains completed meetings. Each mailbox has its
own error state. Provider results are cached for one minute; mailbox discovery
for five minutes. Account switches affect the agenda and next-meeting metric.

By default, every verified connected Outlook mailbox is shown. To select specific
accounts on a box, create the private file
`<HERMES_HOME>/eaios/today-calendars.json`:

```json
{"emails":["executive@example.com","office@example.com"]}
```

Use the canonical mailbox addresses reported by Connections. Missing selected
accounts remain visible with a connection error. This file is private runtime
state and must never be copied into shared source or installer artifacts.
Calendar access requires the connected account's existing calendar read permission.
No permissions are granted by the Today page.

Microsoft reference: https://learn.microsoft.com/en-us/graph/api/calendar-list-calendarview
