---
name: Monthly Expense Audit
description: Ledger scans, anomalies → digest → archive
version: 1.2.0
status: published
mode: task
skills: []
---

# Monthly Expense Audit

Audit last month's spend and produce the anomaly digest. Read-only against
external systems; the only write is the digest artifact.

## Steps

1. Collect last month's expenses from the ledger sources available to you.
2. Flag anomalies: new vendors, >20% month-over-month category swings,
   duplicate-looking charges, subscriptions with no linked owner.
3. Produce the digest: summary table + anomaly list with severity
   (low/medium/high) and a one-line recommended action per anomaly.
4. Archive the digest as an artifact and note completion with the count
   of anomalies by severity.
