#!/usr/bin/env python3
"""
Browser-use runner invoked by the EAiOS Node server for travel booking.

Reads a JSON job from stdin, runs browser-use Agent, prints JSON result to stdout.
Job shape:
{
  "task": "natural-language task for the agent",
  "chromeBin": "/path/to/chrome",
  "headless": true,
  "cookies": [ { "name": "...", "value": "...", "domain": "...", "path": "..." } ],
  "llm": { "provider": "openrouter", "model": "deepseek/deepseek-v4-flash", "apiKey": "..." },
  "extractionSchema": { "results": { "type": "array", "items": {...} } }
}

Output shape:
{
  "ok": true,
  "answer": "...",
  "extracted": { ... },
  "finalUrl": "...",
  "screenshot": "base64...",
  "logs": [ ... ]
}
"""
import base64
import json
import os
import sys
import tempfile
import traceback
from datetime import datetime, timezone

logs: list[dict] = []


def log(action: str, detail: str = "") -> None:
    logs.append({
        "ts": datetime.now(timezone.utc).isoformat(),
        "action": action,
        "detail": detail,
    })


def make_llm(cfg: dict) -> object:
    provider = cfg.get("provider", "openrouter")
    model = cfg.get("model", "deepseek/deepseek-v4-flash")
    api_key = cfg.get("apiKey") or os.environ.get("OPENROUTER_API_KEY") or ""
    if provider == "openrouter":
        from browser_use.llm.openrouter.chat import ChatOpenRouter
        return ChatOpenRouter(model=model, api_key=api_key)
    if provider == "openai":
        from browser_use.llm.openai.chat import ChatOpenAI
        return ChatOpenAI(model=model, api_key=api_key)
    if provider == "anthropic":
        from browser_use.llm.anthropic.chat import ChatAnthropic
        return ChatAnthropic(model=model, api_key=api_key)
    if provider == "deepseek":
        from browser_use.llm.deepseek.chat import ChatDeepSeek
        return ChatDeepSeek(model=model, api_key=api_key)
    raise ValueError(f"Unsupported LLM provider: {provider}")


def build_storage_state(cookies: list[dict]) -> dict:
    return {"cookies": cookies, "origins": []}


def run_job(job: dict) -> dict:
    log("job_start", job.get("task", "")[:120])

    chrome_bin = job.get("chromeBin") or os.environ.get("CHROME_BIN") or "chromium"
    headless = job.get("headless", True)
    cookies = job.get("cookies") or []
    task = job.get("task", "")
    extraction_schema = job.get("extractionSchema")

    if not task:
        raise ValueError("Missing 'task' in job")

    llm_cfg = job.get("llm") or {}
    llm = make_llm(llm_cfg)

    from browser_use.browser.session import BrowserSession

    storage_state = build_storage_state(cookies)
    session = BrowserSession(
        executable_path=chrome_bin,
        headless=headless,
        storage_state=storage_state,
        chromium_sandbox=False,
    )

    try:
        from browser_use.agent.service import Agent

        agent_kwargs: dict = {
            "task": task,
            "llm": llm,
            "browser_session": session,
            "use_vision": False,  # cheaper/faster for text-heavy travel sites
            "max_actions_per_step": 3,
            "step_timeout": 120,
        }
        if extraction_schema:
            agent_kwargs["extraction_schema"] = extraction_schema

        agent = Agent(**agent_kwargs)
        log("agent_run_start")
        result = agent.run_sync()
        log("agent_run_end")

        answer = ""
        extracted = None
        if hasattr(result, "final_result"):
            answer = str(result.final_result())
        elif hasattr(result, "answer"):
            answer = str(result.answer)
        else:
            answer = str(result)

        # Try to parse JSON if the answer looks like JSON (common with extraction schema)
        if answer.strip().startswith(("{", "[")):
            try:
                extracted = json.loads(answer)
            except Exception:
                pass

        final_url = ""
        try:
            final_url = session.get_current_page_url() or ""
        except Exception:
            pass

        screenshot_b64 = ""
        try:
            screenshot = session.take_screenshot()
            if screenshot:
                screenshot_b64 = base64.b64encode(screenshot).decode("utf-8")
        except Exception:
            pass

        return {
            "ok": True,
            "answer": answer,
            "extracted": extracted,
            "finalUrl": final_url,
            "screenshot": screenshot_b64,
            "logs": logs,
        }
    finally:
        try:
            session.close()
        except Exception:
            pass


def main() -> None:
    try:
        raw = sys.stdin.read()
        job = json.loads(raw) if raw.strip() else {}
        result = run_job(job)
        print(json.dumps(result, ensure_ascii=False))
    except Exception as e:
        traceback.print_exc(file=sys.stderr)
        print(
            json.dumps(
                {
                    "ok": False,
                    "error": str(e),
                    "logs": logs,
                },
                ensure_ascii=False,
            )
        )
        sys.exit(1)


if __name__ == "__main__":
    main()
