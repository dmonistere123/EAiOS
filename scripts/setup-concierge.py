#!/usr/bin/env python3
"""Explicit opt-in only. Never called by install/update/recovery scripts."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess

PROFILE = "eaios-concierge"


def soul_hash(text):
    return hashlib.sha256(text.encode()).hexdigest()


def setup(root, home, apply=False, refresh=False, runner=subprocess.run):
    import yaml  # Available in the Hermes Python environment; no auto-install.
    root, home = Path(root), Path(home)
    soul = (root / "concierge" / "SOUL.md").read_text()
    if not soul.strip() or len(soul) > 24000:
        raise ValueError("Concierge SOUL is empty or exceeds the context budget")
    target = home / "profiles" / PROFILE
    marker_path = target / "eaios-concierge.json"
    if target.is_symlink():
        raise ValueError("Profile must not be a symlink")
    if refresh:
        if (target / "SOUL.md").is_symlink() or marker_path.is_symlink():
            raise ValueError("Profile documents must not be symlinks")
        marker = json.loads(marker_path.read_text())
        if marker.get("schema") != 1 or marker.get("profile") != PROFILE or marker.get("soulSha256") != soul_hash((target / "SOUL.md").read_text()):
            raise ValueError("Existing Concierge instructions were customized; review manually")
    elif target.exists():
        raise ValueError("Profile already exists; no files were replaced")
    if not apply:
        return "Review only: dedicated profile setup requires --apply; no files changed"
    if not refresh:
        source = yaml.safe_load((home / "config.yaml").read_text()) or {}
        model = source.get("model")
        if not isinstance(model, dict) or not isinstance(model.get("default"), str) or not isinstance(model.get("provider"), str):
            raise ValueError("Select a model/provider for the new profile before activation")
        if any(model.get(k) for k in ("api_key", "base_url", "api_key_env")):
            raise ValueError("Custom runtime or model credentials require separate profile review")
        fallback = source.get("fallback_model")
        if fallback and (not isinstance(fallback, dict) or not all(isinstance(fallback.get(k), str) for k in ("model", "provider"))):
            raise ValueError("Complex fallback configuration requires separate profile review")
        # Supported create command, never clone. Validation precedes any writes.
        runner(["hermes", "profile", "create", PROFILE, "--no-alias", "--no-skills"],
               env={**os.environ, "HERMES_HOME": str(home)}, check=True,
               stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        config_path = target / "config.yaml"
        config = yaml.safe_load(config_path.read_text()) or {}
        config["model"] = {k: model[k] for k in ("default", "provider")}
        fallback = source.get("fallback_model")
        if isinstance(fallback, dict) and all(isinstance(fallback.get(k), str) for k in ("model", "provider")):
            config["fallback_model"] = {k: fallback[k] for k in ("model", "provider")}
        config["platform_toolsets"] = {"cli": ["clarify"]}
        config["mcp_servers"] = {}
        config["memory"] = {"memory_enabled": False, "user_profile_enabled": False}
        config.setdefault("agent", {})["coding_context"] = "off"
        config_path.write_text(yaml.safe_dump(config, sort_keys=False))
        config_path.chmod(0o600)
    # The same packaged SOUL is also included directly on every turn. No indexing.
    (target / "SOUL.md").write_text(soul)
    marker_path.write_text(json.dumps({"schema": 1, "profile": PROFILE, "soulSha256": soul_hash(soul)}, indent=2) + "\n")
    return "Concierge profile prepared; verify credentials and effective tool restrictions before activation. No services restarted."


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--refresh-documents", action="store_true")
    parser.add_argument("--hermes-home", type=Path, default=Path.home() / ".hermes")
    args = parser.parse_args()
    try:
        print(setup(Path(__file__).resolve().parents[1], args.hermes_home, args.apply, args.refresh_documents))
    except Exception:
        raise SystemExit("Concierge setup did not complete. Review the dedicated profile before retrying; existing profiles and root configuration are never overwritten.")
