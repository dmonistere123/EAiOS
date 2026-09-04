#!/usr/bin/env python3
"""
EAiOS spend watchdog (F29, Don-approved 2026-09-04, threshold $5.00/day).

No-agent cron script: runs daily, computes YESTERDAY's estimated LLM spend
across all Hermes profile DBs (session_model_usage), and prints an alert
ONLY when the day exceeded the threshold. Empty stdout = silent (the cron
delivers non-empty stdout verbatim to Telegram).

Cost model: fresh input + output tokens only, per-model rate card. Cache
reads are EXCLUDED — validated against Don's actual provider bill (Sep 2:
$11.35 estimated vs ~$12 billed). Env overrides for testing:
  SPEND_THRESHOLD_USD (default 5.00), SPEND_DAY_OFFSET (default 1 = yesterday)
Source of truth: ~/eaios/scripts/spend-watchdog.py — copy to
~/.hermes/scripts/ (cron rejects symlinks as traversal, gotcha #28c).
"""
import glob
import os
import sqlite3
import sys
from datetime import datetime, timedelta, timezone

# Per-1M-token rates: (input, output). Matched by substring of the model id.
# Canonical source: ~/eaios/config/rate-card.json (shared with the EAiOS Usage
# page /api/usage/daily) — this embedded copy is the fallback if it's missing.
RATE_CARD = [
    ('kimi-k3', 3.00, 14.00),
    ('kimi-k2.7-code-highspeed', 1.90, 8.00),
    ('kimi-k2.7', 0.95, 4.00),
    ('kimi-k2.6', 0.95, 4.00),
    ('deepseek-v4-flash', 0.088, 0.176),
    ('qwen3.7-flash', 0.030, 0.130),
    ('glm-5', 0.30, 1.20),
    ('glm-4', 0.30, 0.90),
    ('minimax-m', 0.60, 2.40),
]
DEFAULT_RATE = (3.00, 14.00)  # conservative: assume flagship pricing

EAIOS_ROOT = os.path.expanduser('~/eaios')


def _load_shared_config():
    """Rate card from ~/eaios/config/rate-card.json + threshold from
    ~/eaios/settings.local.json (the SAME store the Usage page edits).
    Anything missing/corrupt → embedded defaults. Env vars win last."""
    global RATE_CARD, DEFAULT_RATE
    threshold = 5.00
    try:
        import json
        card = json.load(open(os.path.join(EAIOS_ROOT, 'config', 'rate-card.json')))
        rates = [(r['match'], float(r['input']), float(r['output'])) for r in card.get('rates', [])]
        if rates:
            RATE_CARD = rates
        d = card.get('default') or {}
        if 'input' in d and 'output' in d:
            DEFAULT_RATE = (float(d['input']), float(d['output']))
    except Exception:
        pass
    try:
        import json
        settings = json.load(open(os.path.join(EAIOS_ROOT, 'settings.local.json')))
        if isinstance(settings.get('dailySpendAlertUsd'), (int, float)) and settings['dailySpendAlertUsd'] > 0:
            threshold = float(settings['dailySpendAlertUsd'])
    except Exception:
        pass
    return threshold


_file_threshold = _load_shared_config()
THRESHOLD = float(os.environ.get('SPEND_THRESHOLD_USD', str(_file_threshold)))
DAY_OFFSET = int(os.environ.get('SPEND_DAY_OFFSET', '1'))
LOCAL_TZ = timezone(timedelta(hours=-5))  # America/Chicago (CDT)


def rate_for(model: str):
    m = (model or '').lower()
    for key, rin, rout in RATE_CARD:
        if key in m:
            return rin, rout
    return DEFAULT_RATE


def main() -> int:
    day = datetime.now(LOCAL_TZ).replace(hour=0, minute=0, second=0, microsecond=0) - timedelta(days=DAY_OFFSET)
    start, end = day.timestamp(), day.timestamp() + 86400

    dbs = [os.path.expanduser('~/.hermes/state.db')]
    dbs += sorted(glob.glob(os.path.expanduser('~/.hermes/profiles/*/state.db')))

    total = 0.0
    by_session = {}  # (session_id, model) -> [cost, in, out]
    for db in dbs:
        if not os.path.exists(db):
            continue
        try:
            con = sqlite3.connect(f'file:{db}?mode=ro', uri=True)
            cur = con.cursor()
            cur.execute(
                """SELECT session_id, model,
                          SUM(input_tokens), SUM(output_tokens)
                   FROM session_model_usage
                   WHERE last_seen >= ? AND last_seen < ?
                   GROUP BY session_id, model""",
                (start, end),
            )
            for sid, model, tin, tout in cur.fetchall():
                rin, rout = rate_for(model)
                cost = (tin or 0) / 1e6 * rin + (tout or 0) / 1e6 * rout
                total += cost
                key = (sid, model)
                agg = by_session.setdefault(key, [0.0, 0, 0])
                agg[0] += cost
                agg[1] += tin or 0
                agg[2] += tout or 0
            con.close()
        except sqlite3.Error as e:
            print(f'⚠️ Spend watchdog: could not read {db}: {e}', file=sys.stderr)

    if total <= THRESHOLD:
        return 0  # silent

    label = day.strftime('%Y-%m-%d')
    lines = [
        f'🚨 EAiOS spend watchdog — {label}',
        f'Estimated LLM spend: ${total:.2f} (threshold ${THRESHOLD:.2f}/day)',
        '',
        'Top sessions:',
    ]
    top = sorted(by_session.items(), key=lambda kv: kv[1][0], reverse=True)[:3]
    for (sid, model), (cost, tin, tout) in top:
        lines.append(f'• ${cost:.2f} — {model} ({tin / 1e3:.0f}K in / {tout / 1e3:.0f}K out) · {sid}')
    lines += [
        '',
        'Estimate = fresh input + output at public rates (cache excluded; matches billing within ~5%).',
        'Full breakdown: ask Ally "what did we spend on <date>?"',
    ]
    print('\n'.join(lines))
    return 0


if __name__ == '__main__':
    sys.exit(main())
