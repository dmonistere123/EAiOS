# Today data sources

Today shows only unfinished records with recorded activity in the trailing 24 hours,
including pending approvals. Older records stay in their source modules. Completed
AI/human tasks, completed schedule runs, canceled tasks and archived approvals are
excluded from both the queue and its counts. The delivered section is no longer on Today.
Saved unassigned tasks remain accessible through Saved tasks. Placeholder assignees
such as `none` and `unassigned` are treated as unassigned, not AI agents.

Approval recency uses the latest recorded creation, decision, start or completion
time. Other work uses its recorded start/completion time or creation time when no
later timestamp exists; merely reading a record never makes it recent. Human work
uses its recorded update time. Source identities and explicit relationships prevent
duplicate priority entries; similar titles are never treated as identity.

`GET /api/today/activity` reads each profile's `cron/executions.db` read-only.
Recent failed or still-running schedules can appear; successful background checks
and completed runs cannot. Inventory supplies names, not proof of execution.
Missing or incompatible ledgers produce warnings.

Legacy review markers and dismissal records are preserved. Today no longer offers
mark-reviewed actions for unfinished work. This filter does not change task statuses,
archive old tasks, execute delegations or mark business actions complete.

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
