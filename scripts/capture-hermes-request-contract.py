"""Capture installed handler contracts without importing/starting Hermes.

Only selected AST function bodies execute, with in-memory collaborators. No DB,
provider, process launch, networking, or real session is available to this harness.
"""
import ast
import hashlib
import json
import pathlib
import sys
import threading
import types

root = pathlib.Path(sys.argv[1])
output = pathlib.Path(sys.argv[2])
ns = {"threading": threading, "time": types.SimpleNamespace(time=lambda: 100.0)}
locations = {}

def extract(filename, function, alias=None, decorator=None):
    path = root / filename
    source = path.read_text()
    tree = ast.parse(source)
    for node in tree.body:
        if isinstance(node, ast.FunctionDef) and node.name == function:
            if decorator and not any(decorator in ast.unparse(d) for d in node.decorator_list):
                continue
            locations[alias or function] = {"path": filename, "line": node.lineno, "sha256": hashlib.sha256(source.encode()).hexdigest()}
            node.decorator_list = []
            node.name = alias or function
            module = ast.Module(body=[ast.ImportFrom(module="__future__", names=[ast.alias(name="annotations")], level=0), node], type_ignores=[])
            ast.fix_missing_locations(module)
            exec(compile(module, str(path), "exec"), ns)
            return
    raise RuntimeError(f"Missing installed handler: {filename}:{function}")

extract("tui_gateway/session_auto_continue.py", "_auto_continue_config")
extract("tui_gateway/session_auto_continue.py", "_inflight_snapshot")
extract("tui_gateway/methods_session.py", "_resume_response")
extract("tui_gateway/methods_session.py", "_resume_cold")
extract("tui_gateway/methods_session.py", "_resume_live_unpersisted")
extract("tui_gateway/methods_session.py", "_resume_reuse_live")
extract("tui_gateway/methods_session.py", "_", "activate", decorator="session.activate")
extract("tui_gateway/server.py", "_live_session_payload")
extract("tui_gateway/server.py", "_session_lookup_key")
extract("tui_gateway/server.py", "_session_live_status")

calls = []
transport = object()
ns.update({
    "_load_cfg": lambda: {}, "is_truthy_value": lambda value, default=False: default if value is None else bool(value),
    "_AUTO_CONTINUE_FRESHNESS_MINUTES_DEFAULT": 15,
    "_coerce_int_config_value": lambda value, default, **_: default if value is None else int(value),
    "_stored_session_runtime_overrides": lambda _: {},
    "_schedule_agent_build": lambda _: None, "_schedule_session_cap_enforcement": lambda: None,
    "_maybe_schedule_auto_continue": lambda *args: calls.append("auto_continue") or {"scheduled": True, "attempt": 1},
    "_attach_todo_state": lambda payload, _: payload,
    "_ok": lambda rid, payload: {"id": rid, "result": payload},
    "_err": lambda rid, code, message: {"id": rid, "error": {"code": code, "message": message}},
    "_todo_state_from_history": lambda _: {},
    "current_transport": lambda: transport,
    "_cancel_ws_orphan_reap": lambda _: None,
    "_resolve_model": lambda: "fixture-model",
    "_session_resume_lock": threading.RLock(), "_sessions": {},
    "_detached_ws_transport": object(), "_stdio_transport": object(),
    "_queued_prompt_snapshot": lambda _: None, "_turn_started_at": lambda _: 0,
    "_fallback_session_info": lambda _: {"lazy": True}, "_session_pending_kind": lambda _: None,
    "_pending_approval_request_payload": lambda _: None, "_pending_clarify_request_payload": lambda _: None,
})
ctx = types.SimpleNamespace(
    rid=1, target="stored-fixture", found={}, owns_db=False, profile=None, omit_messages=True,
    mint=lambda: ("cold-runtime", "tui", "/fixture"),
    restore=lambda: ([], [], []), display_prefix=lambda: [],
    record=lambda *args, **kwargs: {"created_at": 0}, claim=lambda *args: None,
    info=lambda *args: {}, messages=lambda history: list(history),
)
cold = ns["_resume_cold"](ctx)["result"]
race = ns["_resume_reuse_live"](ctx, "gone-runtime", {})["error"]
lazy = {"session_key": "stored-fixture", "history": [], "history_lock": threading.RLock(), "created_at": 0, "running": False}
lazy_reply = ns["_resume_live_unpersisted"](ctx, "lazy-runtime", lazy)["result"]
activated = ns["activate"](2, {"session_id": "lazy-runtime", "omit_messages": True}, lazy)["result"]
output.write_text(json.dumps({
    "source": locations, "defaultAutoContinue": ns["_auto_continue_config"]()[0],
    "coldResume": cold, "coldContinuationCalls": len(calls), "lazyUnpersistedResume": lazy_reply,
    "activateLazy": activated, "resumeRace": race,
}, indent=2) + "\n")
print("Captured installed cold/lazy/race/activate contracts using AST-only in-memory fixtures")
