"""Exercise the installed Hermes scheduler database against disposable state only.
No worker, provider, gateway or plugin hook is started by this probe.
"""
import json
import os
import sys
from pathlib import Path

root = Path(os.environ['HERMES_HOME']).resolve()
assert root.name.startswith('eaios-hermes-approval-'), 'Disposable home required'
sys.path.insert(0, os.environ['EAIOS_TEST_HERMES_ROOT'])
from hermes_cli import kanban_db as kb
kb._fire_kanban_lifecycle_hook = lambda *args, **kwargs: None
from hermes_cli.kanban_db_connect import connect
conn = connect(root / 'kanban.db')
mode = sys.argv[1]
if mode == 'create':
    import argparse
    from hermes_cli.kanban_parser import build_parser
    parser = argparse.ArgumentParser()
    build_parser(parser.add_subparsers(dest='command'))
    parser.parse_args(['kanban', 'block', 't_test', 'Awaiting executive approval', '--kind', 'needs_input'])
    ids = {}
    for name in ['approve', 'reject', 'changes', 'future']:
        ids[name] = kb.create_task(conn, title='Synthetic approval ' + name,
            body=json.dumps({'eaios': 'approval', 'requestedBy': 'default',
                'actionType': 'send', 'targetSystem': 'outlook', 'risk': 'low',
                'targetObject': 'Sample draft — ' + name,
                'payload': 'To: nobody@example.invalid\nSubject: Test\nBody: Never sent'}),
            initial_status='blocked', workspace_kind='scratch', created_by='test')
    assert kb.block_task(conn, ids['future'], kind='needs_input', reason='Awaiting executive approval')
    print(json.dumps(ids))
elif mode == 'sweep':
    kb.recompute_ready(conn)
    print(json.dumps([dict(row) for row in conn.execute('SELECT id,status,assignee,block_kind FROM tasks')]))
elif mode == 'claim':
    task = kb.claim_task(conn, sys.argv[2], claimer='isolated-test-no-worker')
    print(json.dumps({'claimed': task is not None}))
conn.close()
