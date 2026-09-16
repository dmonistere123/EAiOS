#!/usr/bin/env python3
"""Approval-gated LinkedIn comments with a persistent one-comment-per-post ledger."""
import argparse
import fcntl
import json
import os
from pathlib import Path
import re
import sqlite3
import subprocess
import time
import urllib.request


def valid_post(value):
    if not isinstance(value, str) or not re.fullmatch(r'urn:li:(share|ugcPost):[0-9]+', value):
        raise ValueError('A verified LinkedIn share or ugcPost URN is required; never guess from an activity URL')
    return value


def envelope(body):
    try:
        value = json.loads(body or '')
        return value if isinstance(value, dict) else {}
    except (ValueError, TypeError):
        return {}


def connection(home):
    state = home / 'eaios'
    state.mkdir(parents=True, exist_ok=True)
    db = state / 'linkedin-comments.db'
    c = sqlite3.connect(db, timeout=30)
    os.chmod(db, 0o600)
    c.execute('CREATE TABLE IF NOT EXISTS comments (post_id TEXT PRIMARY KEY, task_id TEXT NOT NULL, status TEXT NOT NULL, receipt TEXT, updated_at INTEGER NOT NULL)')
    c.commit()
    return c


def seen(home, post, excluding=None):
    valid_post(post)
    with connection(home) as c:
        row = c.execute('SELECT task_id,status,receipt FROM comments WHERE post_id=?', (post,)).fetchone()
        if row:
            return {'skip': True, 'taskId': row[0], 'status': row[1], 'receipt': envelope(row[2])}
    if not (home / 'kanban.db').exists():
        return {'skip': False}
    with sqlite3.connect(f'file:{home}/kanban.db?mode=ro', uri=True) as c:
        for tid, body, status in c.execute('SELECT id,body,status FROM tasks'):
            e = envelope(body)
            target = e.get('linkedinComment', {})
            if tid != excluding and isinstance(target, dict) and target.get('postUrn') == post:
                # Includes rejected suggestions: do not repeatedly ask about a rejected post.
                return {'skip': True, 'taskId': tid, 'status': e.get('decision', status)}
    return {'skip': False}


def mcp(home, name, arguments):
    config = (home / 'config.yaml').read_text()
    section = config.split('  composio:', 1)[1].split('    enabled:', 1)[0]
    url = re.search(r'url:\s*(\S+)', section).group(1)
    if not url.startswith('https://backend.composio.dev/'):
        raise ValueError('Unexpected Composio endpoint')
    auth = re.search(r'Authorization:\s*(.+)', section).group(1).strip().strip('\"\'')
    dotenv = (home / '.env').read_text()
    def resolve(match):
        key = match.group(1)
        value = os.environ.get(key)
        if not value:
            found = re.search(r'(?m)^' + re.escape(key) + r'=(.+)$', dotenv)
            value = found.group(1).strip().strip('\"\'') if found else None
        if not value:
            raise ValueError('Composio credential unavailable')
        return value
    auth = re.sub(r'\$\{([A-Z_]+)\}', resolve, auth)
    request = urllib.request.Request(url, data=json.dumps({'jsonrpc': '2.0', 'id': 1, 'method': 'tools/call', 'params': {'name': name, 'arguments': arguments}}).encode(), headers={'Authorization': auth, 'Content-Type': 'application/json', 'Accept': 'application/json, text/event-stream'})
    with urllib.request.urlopen(request, timeout=60) as response:
        raw = response.read().decode()
    if raw.startswith(('event:', 'data:')):
        raw = next(line[6:] for line in raw.splitlines() if line.startswith('data: '))
    result = json.loads(raw)
    if result.get('error') or result.get('result', {}).get('isError'):
        raise ValueError('Composio request failed')
    return json.loads(next(b['text'] for b in result['result']['content'] if b['type'] == 'text'))


def publish(home, task_id, transport=mcp):
    with sqlite3.connect(f'file:{home}/kanban.db?mode=ro', uri=True) as c:
        row = c.execute('SELECT body,status FROM tasks WHERE id=?', (task_id,)).fetchone()
    if not row:
        raise ValueError('Approval task not found')
    e = envelope(row[0])
    if e.get('eaios') != 'approval' or e.get('targetSystem') != 'linkedin' or e.get('actionType') != 'publish' or e.get('decision') != 'approved' or row[1] not in ['ready', 'running']:
        raise ValueError('An approved, nonterminal LinkedIn publishing task is required')
    target = e.get('linkedinComment', {})
    post = valid_post(target.get('postUrn'))
    actor = target.get('actorUrn', '')
    if not re.fullmatch(r'urn:li:person:[A-Za-z0-9_-]+', actor):
        raise ValueError('Verified posting identity is required')
    text = e.get('payload')
    if not isinstance(text, str) or not 1 <= len(text.strip()) <= 1250:
        raise ValueError('Approval payload must be the exact comment text, 1–1250 characters')
    identity = transport(home, 'COMPOSIO_MULTI_EXECUTE_TOOL', {'tools': [{'tool_slug': 'LINKEDIN_GET_MY_INFO', 'arguments': {}}], 'sync_response_to_workbench': False, 'current_step': 'VERIFYING_POSTING_IDENTITY'})
    profiles = identity.get('data', {}).get('results', [])
    profile = profiles[0].get('response', {}) if len(profiles) == 1 else {}
    if profile.get('successful') is not True or 'urn:li:person:' + str(profile.get('data', {}).get('id', '')) != actor:
        raise ValueError('Approved actor does not match the connected LinkedIn account')
    state = home / 'eaios'
    state.mkdir(parents=True, exist_ok=True)
    lock_path = state / 'linkedin-comments.lock'
    with lock_path.open('a') as lock:
        os.chmod(lock_path, 0o600)
        fcntl.flock(lock, fcntl.LOCK_EX)
        existing = seen(home, post, excluding=task_id)
        if existing['skip']:
            raise ValueError('This post already has a suggestion or posting attempt; inspect its receipt before retrying')
        with sqlite3.connect(f'file:{home}/kanban.db?mode=ro', uri=True) as latest:
            current = latest.execute('SELECT body,status FROM tasks WHERE id=?', (task_id,)).fetchone()
        if not current or envelope(current[0]) != e or current[1] not in ['ready', 'running']:
            raise ValueError('Approval changed during preparation; check the current executive decision')
        # Commit before the write. Crashes and uncertain network outcomes cannot blindly repost.
        with connection(home) as c:
            c.execute('INSERT INTO comments VALUES (?,?,?,?,?)', (post, task_id, 'posting', None, int(time.time())))
        try:
            result = transport(home, 'COMPOSIO_MULTI_EXECUTE_TOOL', {'tools': [{'tool_slug': 'LINKEDIN_CREATE_COMMENT_ON_POST', 'arguments': {'target_urn': post, 'actor': actor, 'object': post, 'message': {'text': text}}}], 'sync_response_to_workbench': False, 'current_step': 'POSTING_APPROVED_COMMENT'})
            entries = result.get('data', {}).get('results', [])
            if len(entries) != 1:
                raise ValueError('No unambiguous LinkedIn posting receipt received')
            item = entries[0]
            response = item.get('response', item)
            data = response.get('data', {})
            receipt_id = data.get('commentUrn') or data.get('id') or data.get('x_restli_id')
            if response.get('successful') is not True or not receipt_id or data.get('actor') != actor or data.get('object') != post or data.get('message', {}).get('text') != text:
                raise ValueError('LinkedIn did not confirm the approved text and target; inspect the execution log')
            receipt = {'commentId': receipt_id, 'postUrn': post, 'actorUrn': actor, 'text': text, 'postedAt': int(time.time())}
            with connection(home) as c:
                c.execute('UPDATE comments SET status=?,receipt=?,updated_at=? WHERE post_id=?', ('posted', json.dumps(receipt), int(time.time()), post))
            return receipt
        except Exception:
            with connection(home) as c:
                c.execute('UPDATE comments SET status=?,updated_at=? WHERE post_id=?', ('unconfirmed', int(time.time()), post))
            raise ValueError('Posting failed or was not confirmed. Do not mark this task complete or retry until the posting outcome is checked') from None


def suggest(home, post, url, label, text, actor, runner=subprocess.run):
    valid_post(post)
    if not url.startswith('https://www.linkedin.com/') or not label.strip() or not 1 <= len(text.strip()) <= 1250 or not re.fullmatch(r'urn:li:person:[A-Za-z0-9_-]+', actor):
        raise ValueError('Verified target URL, label, posting identity and comment text are required')
    state = home / 'eaios'; state.mkdir(parents=True, exist_ok=True)
    with (state / 'linkedin-comments.lock').open('a') as lock:
        os.chmod(state / 'linkedin-comments.lock', 0o600)
        fcntl.flock(lock, fcntl.LOCK_EX)
        existing = seen(home, post)
        if existing['skip']:
            return existing
        e = {'eaios': 'approval', 'actionType': 'publish', 'targetSystem': 'linkedin', 'targetObject': label, 'risk': 'low', 'requestedBy': 'default', 'payload': text, 'linkedinComment': {'postUrn': post, 'postUrl': url, 'actorUrn': actor}, 'evidence': [{'kind': 'url', 'label': label, 'uri': url}]}
        runner(['hermes', 'kanban', 'create', 'LinkedIn comment — ' + label, '--body', json.dumps(e), '--priority', '2'], check=True, capture_output=True, text=True)
        return {'skip': False, 'created': True}


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    commands = parser.add_subparsers(dest='command', required=True)
    commands.add_parser('check').add_argument('post_urn')
    commands.add_parser('publish').add_argument('task_id')
    s = commands.add_parser('suggest')
    for key in ['post-urn', 'post-url', 'label', 'text-file', 'actor-urn']:
        s.add_argument('--' + key, required=True)
    args = parser.parse_args()
    home = Path(os.environ.get('HERMES_HOME', str(Path.home() / '.hermes')))
    try:
        if args.command == 'check': result = seen(home, args.post_urn)
        elif args.command == 'publish': result = publish(home, args.task_id)
        else: result = suggest(home, args.post_urn, args.post_url, args.label, Path(args.text_file).read_text(), args.actor_urn)
        print(json.dumps(result))
    except Exception as error:
        print(json.dumps({'ok': False, 'error': str(error)}))
        raise SystemExit(1)
