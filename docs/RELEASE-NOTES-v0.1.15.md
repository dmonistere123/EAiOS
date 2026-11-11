# EAiOS v0.1.15 — Approval routing and Full-edition ticker

- Approvals preserve an explicitly selected, valid specialist instead of replacing
  it with the default orchestrator. Ordinary tasks still route to Ally. Recovery
  retains the existing approval and reviewed content and displays the executor.
- Full includes the Ticker dashboard, watchlist settings, and compact footer.
  US stock movers and selected Bitcoin widgets start expanded. Hide, show, retry,
  pause, and saved selections remain available. Other stock widgets retain their
  existing initial state. Third-party market data may be delayed or unavailable.
- Core receives the approval fix but excludes the ticker page, footer, settings,
  and data endpoint. No ticker feed is requested by the Core interface.
- Full and Core installers, and deliberate Settings updates, include this release.
  Existing edition choices, agents, credentials, instructions, conversations,
  schedules, and application data stay in place. No existing approvals are
  replayed, no specialist profiles are installed, and Bitcoin is not enabled for
  users who have not selected it.

Ticker sports coverage uses the public cached Allygnment feed; market widgets use
TradingView. Supported sports and coverage limitations are shown in the interface.
This release does not change the standalone ticker website or its providers.
