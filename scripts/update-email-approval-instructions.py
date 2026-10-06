#!/usr/bin/env python3
"""Explicit opt-in patch for the email workflow; never run by application updates.
Preserves unrelated user instructions, fails closed if the expected sections differ.
"""
import argparse
from datetime import datetime, timezone
from pathlib import Path

START = 'The structural fix: **every approval-envelope task'
END = '\n## When to Use'
PROVENANCE = '### Pre-flight provenance check (required before every send-execution)'
RULES = '\nRules:\n- Include the **full draft**'
GATE = '''The structural fix: **every approval-envelope task is created with
`--initial-status blocked` and no `--assignee`.** Then classify the task:
`hermes kanban block <task-id> --kind needs_input "Awaiting executive approval"`.
This classification leaves it blocked and unassigned while making its review
purpose explicit. Never unblock or assign it to make it visible in Approvals.

1. The scheduled/drafting run prepares and files the draft, then stops.
2. Don reviews the draft in EAiOS Approvals.
3. Don presses **Approve**. EAiOS records `decision: approved` and the
   `approval_decided` audit event with `actor: eaios-executive`, then releases
   and assigns the task to `requestedBy` in the same transaction.
4. Reject and Request Changes leave the task blocked and unassigned.
5. The subsequent executor verifies that decision and its audit provenance
   before executing exactly the reviewed payload.

Standing rules:
- The inbox scanner/drafting run NEVER sends, assigns, unblocks, or writes
  approval decisions. It stops after filing the blocked draft.
- Assignment alone is NOT authorization. A subsequent worker, including the
  requesting profile, may execute only after Don's recorded Approve action.
- Never fabricate approval events, bypass the gate with CLI commands, or
  automatically replay an uncertain send. Surface uncertain outcomes to Don.
'''
CHECK = '''### Pre-flight provenance check (required before every send-execution)

Read the current envelope and task events before executing:
1. Require `decision: approved` in the envelope.
2. Require an `approval_decided` event with `decision: approved` and
   `actor: eaios-executive`, followed by `unblocked` and `assigned` events
   from that actor. These are written by the EAiOS Approve transaction.
3. The assigned profile must match `requestedBy`. The task must be ready
   or running. Blocked, rejected, changes-requested and undecided drafts
   must never execute.
4. A subsequent worker under the requesting profile may execute after this
   human decision. The creating/scanning run cannot approve its own work.
5. Use only the reviewed payload. Save the real provider receipt; if a send
   has an uncertain outcome, investigate before retrying. Never mark an
   unsent draft completed.
'''
MARKER = '<!-- EAiOS approval gate v2: explicit install -->'

def patch(text):
    if MARKER in text:
        return text
    if any(text.count(marker) != 1 for marker in [START, END, PROVENANCE, RULES]):
        raise ValueError('Workflow differs from expected sections; review manually, do not overwrite it.')
    a, b = text.index(START), text.index(END)
    text = text[:a] + GATE + text[b:]
    a, b = text.index(PROVENANCE), text.index(RULES)
    text = text[:a] + CHECK + text[b:]
    command = 'hermes kanban create "<Reply — recipient/thread>" --body \'<envelope-json>\' --initial-status blocked --priority <1-4>'
    if text.count(command) != 1:
        raise ValueError('Creation recipe differs; review manually.')
    text = text.replace(command, command + '\nhermes kanban block <task-id> --kind needs_input "Awaiting executive approval"')
    text = text.replace('Don explicitly unblocks then assigns to\n  trigger execution.', 'Don presses Approve in EAiOS to\n  record his decision and release it for execution.')
    return text + '\n' + MARKER + '\n'

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('skill', type=Path)
    parser.add_argument('--apply', action='store_true', help='Apply with a timestamped backup; default is check only')
    args = parser.parse_args()
    original = args.skill.read_text()
    updated = patch(original)
    if updated == original:
        print('Already updated.')
    elif args.apply:
        backup = args.skill.with_name(args.skill.name + '.approval-backup-' + datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ'))
        backup.write_text(original)
        args.skill.write_text(updated)
        print('Updated email approval instructions; backup: ' + str(backup))
    else:
        print('Patch validated. No changes made. Apply explicitly after the approval-gate application is deployed.')
