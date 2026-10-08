"""Run installed lazy-resume AST in isolation; no Hermes import, IO or provider call.
Usage: python3 scripts/capture-hermes-lazy-contract.py HERMES_CHECKOUT OUTPUT.json
"""
import ast
import hashlib
import json
import pathlib
import sys
import types

source_path = pathlib.Path(sys.argv[1]) / 'tui_gateway/methods_session.py'
source = source_path.read_text()
namespace = {}
locations = {}
for name in ['_resume_response', '_resume_lazy']:
    node = next(n for n in ast.parse(source).body if isinstance(n, ast.FunctionDef) and n.name == name)
    locations[name] = node.lineno
    node.decorator_list = []
    module = ast.Module(body=[ast.ImportFrom(module='__future__', names=[ast.alias(name='annotations')], level=0), node], type_ignores=[])
    ast.fix_missing_locations(module)
    exec(compile(module, str(source_path), 'exec'), namespace)

history = [{'role':'user','content':'Remember blue'}, {'role':'assistant','content':'Remembered blue'}]
records = []
def record(*args, **kwargs):
    result = {'history':args[2], 'created_at':0, 'session_key':'fixture-tip'}
    records.append(result)
    return result

def forbidden(*args, **kwargs):
    raise AssertionError('Lazy mount attempted automatic execution')
namespace.update({
    '_ok':lambda rid, payload:payload, '_attach_todo_state':lambda payload, _:payload,
    '_todo_state_from_history':lambda _: {}, '_child_run_active':lambda *args:False,
    '_lazy_resume_info':lambda *args, **kwargs:{'lazy':True},
    '_maybe_schedule_auto_continue':forbidden, '_schedule_agent_build':forbidden,
})
ctx = types.SimpleNamespace(
    rid=1,target='fixture-tip',profile=None,profile_home=None,omit_messages=True,
    db=object(),mint=lambda **kwargs:('fixture-runtime','tui','/fixture'),
    child_history=lambda **kwargs:list(history), record=record,claim=lambda *args:None,
    messages=lambda _:[],
)
reply=namespace['_resume_lazy'](ctx)
assert reply['session_key']=='fixture-tip' and reply['running'] is False
assert records[0]['history']==history
pathlib.Path(sys.argv[2]).write_text(json.dumps({
    'source':'tui_gateway/methods_session.py', 'sha256':hashlib.sha256(source.encode()).hexdigest(),
    'lines':locations, 'reply':reply, 'restoredHistory':records[0]['history'],
    'automaticExecutionCalls':0,
}, indent=2)+'\n')
