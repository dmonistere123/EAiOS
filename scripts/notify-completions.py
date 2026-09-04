#!/usr/bin/env python3
"""EAiOS delegated-completion notifier (dogfood 2026-08-29).

Guarantee: EVERY task completed on the kanban board is reported to the
executive's Telegram home chat — deterministically, not dependent on the
worker remembering governance v3.1 (proven unreliable: t_9d7b4aa2 finished
with a full result and never telegrammed) or on kanban notify-subscribe
(never fires on this box — sub cursors stick, host gap).

Runs as a no-agent cron script: prints the report only when there is
something new (empty stdout = silent tick). Dedup state lives in
~/eaios/notify-state.json (gitignored): task id -> completed_at reported.

Chat target: telegramHomeChatId in ~/eaios/settings.local.json — the
installer sets it per customer; this box falls back to Ally's Portal.
"""
import json
import os
import sqlite3
import sys
from pathlib import Path

HERMES_HOME = Path(os.environ.get("HERMES_HOME", Path.home() / ".hermes"))
EAIOS_ROOT = Path(os.environ.get("EAIOS_ROOT", Path.home() / "eaios"))
STATE_FILE = EAIOS_ROOT / "notify-state.json"
LOOKBACK_SECONDS = 72 * 3600  # never report ancient history on first run
MAX_CHARS = 900  # per-task excerpt (Telegram-friendly)


def load_settings_chat_id() -> str:
    try:
        settings = json.loads((EAIOS_ROOT / "settings.local.json").read_text())
        if settings.get("telegramHomeChatId"):
            return str(settings["telegramHomeChatId"])
    except Exception:
        pass
    return "-1004268167166"  # Ally's Portal (this box; installer overrides)


def main() -> int:
    kanban_db = HERMES_HOME / "kanban.db"
    if not kanban_db.exists():
        return 0  # no board yet — silent

    try:
        reported: dict[str, int] = json.loads(STATE_FILE.read_text())
    except Exception:
        reported = {}

    import time

    now = int(time.time())
    db = sqlite3.connect(f"file:{kanban_db}?mode=ro", uri=True)
    try:
        rows = db.execute(
            """SELECT t.id, t.title, t.assignee, t.completed_at, t.result,
                      (SELECT GROUP_CONCAT(a.filename, ', ')
                         FROM task_attachments a WHERE a.task_id = t.id) AS files
                 FROM tasks t
                WHERE t.status = 'done'
                  AND t.completed_at IS NOT NULL
                  AND t.completed_at > ?
                ORDER BY t.completed_at ASC""",
            (now - LOOKBACK_SECONDS,),
        ).fetchall()
    finally:
        db.close()

    fresh = [r for r in rows if reported.get(r[0], 0) < (r[3] or 0)]
    if not fresh:
        return 0  # silent tick

    chat_id = load_settings_chat_id()
    lines = [f"📬 Delegated work report (→ telegram:{chat_id})", ""]
    for task_id, title, assignee, completed_at, result, files in fresh:
        agent = assignee or "staff"
        excerpt = (result or "Completed without a result note.").strip()
        if len(excerpt) > MAX_CHARS:
            excerpt = excerpt[:MAX_CHARS].rstrip() + "…"
        lines.append(f"✅ {title} — {agent}")
        lines.append(excerpt)
        if files:
            lines.append(f"📎 {files} (in EAiOS Artifacts)")
        lines.append("")
        reported[task_id] = completed_at

    STATE_FILE.write_text(json.dumps(reported, indent=1))
    print("\n".join(lines).strip())
    return 0


if __name__ == "__main__":
    sys.exit(main())
