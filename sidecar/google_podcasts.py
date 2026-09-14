"""EAiOS Podcast sidecar module — Google Gemini Notebook Enterprise Podcast API.

Requires:
  - GOOGLE_CLOUD_PROJECT environment variable (the GCP project id).
  - Either GOOGLE_APPLICATION_CREDENTIALS pointing to a service-account JSON key,
    or GOOGLE_PODCAST_ACCESS_TOKEN with a pre-fetched access token.
  - Discovery Engine API enabled on the project.
  - IAM role roles/discoveryengine.podcastApiUser on the service account.

API shape (v1):
  POST https://discoveryengine.googleapis.com/v1/projects/{project}/locations/global/podcasts
  Body: { podcastConfig: { focus, length, languageCode? }, contexts: [...],
          title, description }
  Response: { name: "projects/.../operations/..." }

  Poll GET https://discoveryengine.googleapis.com/v1/{name}
  Download GET https://discoveryengine.googleapis.com/v1/{name}:download?alt=media
"""
import base64
import json
import os
import time
import traceback
import urllib.error
import urllib.request
from pathlib import Path

from podcasts import (  # type: ignore
    AUDIO_DIR,
    PODCAST_FILES,
    TRANSCRIPT_DIR,
    ensure_dirs,
    now_iso,
    update_status,
)

API_BASE = "https://discoveryengine.googleapis.com/v1"
POLL_INTERVAL_SECONDS = 10
MAX_POLL_MINUTES = 10


def _project_id() -> str:
    project = os.environ.get("GOOGLE_CLOUD_PROJECT", "").strip()
    if not project:
        raise RuntimeError("GOOGLE_CLOUD_PROJECT is not set")
    return project


def _access_token() -> str:
    """Return a valid GCP access token, or raise if unavailable."""
    env_token = os.environ.get("GOOGLE_PODCAST_ACCESS_TOKEN", "").strip()
    if env_token:
        return env_token

    # Try Application Default Credentials (service-account JSON, metadata server, gcloud).
    try:
        from google.auth import default as google_auth_default
        from google.auth.transport.requests import Request

        credentials, project = google_auth_default(scopes=["https://www.googleapis.com/auth/cloud-platform"])
        if credentials.expired or not credentials.token:
            credentials.refresh(Request())
        if credentials.token:
            return credentials.token
    except Exception as e:
        raise RuntimeError(f"Unable to obtain GCP access token: {e}") from e

    raise RuntimeError(
        "No Google credentials found. Set GOOGLE_APPLICATION_CREDENTIALS, "
        "run 'gcloud auth application-default login', or set GOOGLE_PODCAST_ACCESS_TOKEN."
    )


def _request(url: str, method: str = "GET", data: bytes | None = None, headers: dict | None = None) -> tuple[int, bytes]:
    token = _access_token()
    req_headers = {"Authorization": f"Bearer {token}"}
    if headers:
        req_headers.update(headers)
    req = urllib.request.Request(url, method=method, data=data, headers=req_headers)
    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            return resp.status, resp.read()
    except urllib.error.HTTPError as e:
        body = e.read()
        return e.code, body


def _api_url(path: str) -> str:
    return f"{API_BASE}{path}"


def status() -> dict:
    """Return credential/configuration status for the UI."""
    project = os.environ.get("GOOGLE_CLOUD_PROJECT", "").strip()
    has_service_account = bool(os.environ.get("GOOGLE_APPLICATION_CREDENTIALS", "").strip())
    has_token = bool(os.environ.get("GOOGLE_PODCAST_ACCESS_TOKEN", "").strip())
    ready = bool(project) and (has_service_account or has_token)
    return {
        "ready": ready,
        "projectConfigured": bool(project),
        "serviceAccountConfigured": has_service_account,
        "accessTokenConfigured": has_token,
        "message": (
            "Ready"
            if ready
            else "GCP credentials not configured. Set GOOGLE_CLOUD_PROJECT and either GOOGLE_APPLICATION_CREDENTIALS or GOOGLE_PODCAST_ACCESS_TOKEN."
        ),
    }


def _start_generation(
    text: str,
    title: str,
    description: str,
    focus: str | None = None,
    length: str = "STANDARD",
    language_code: str = "en-US",
) -> str:
    """Start the Google Podcast API long-running operation. Returns operation name."""
    project = _project_id()
    url = _api_url(f"/projects/{project}/locations/global/podcasts")
    payload = {
        "podcastConfig": {
            "focus": focus or f"A concise podcast based on: {title}",
            "length": length,
            "languageCode": language_code,
        },
        "contexts": [{"text": text}],
        "title": title,
        "description": description,
    }
    code, body = _request(
        url,
        method="POST",
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
    )
    if code != 200:
        raise RuntimeError(f"Google Podcast API start failed ({code}): {body.decode('utf-8', errors='replace')}")
    result = json.loads(body.decode("utf-8"))
    name = result.get("name")
    if not name:
        raise RuntimeError(f"Google Podcast API did not return an operation name: {result}")
    return name


def _poll_operation(name: str) -> dict:
    """Poll until the operation finishes. Returns the operation object."""
    url = _api_url(f"/{name}")
    deadline = time.time() + MAX_POLL_MINUTES * 60
    while time.time() < deadline:
        code, body = _request(url)
        if code != 200:
            raise RuntimeError(f"Operation poll failed ({code}): {body.decode('utf-8', errors='replace')}")
        op = json.loads(body.decode("utf-8"))
        if op.get("done"):
            return op
        time.sleep(POLL_INTERVAL_SECONDS)
    raise RuntimeError(f"Operation {name} did not complete within {MAX_POLL_MINUTES} minutes")


def _download_mp3(name: str, dest: Path) -> None:
    """Download the generated MP3 to dest."""
    url = _api_url(f"/{name}:download?alt=media")
    code, body = _request(url)
    if code != 200:
        raise RuntimeError(f"Download failed ({code}): {body.decode('utf-8', errors='replace')}")
    dest.write_bytes(body)


def generate(
    podcast_id: str,
    source_path: Path,
    source_name: str,
    focus: str | None = None,
    length: str = "STANDARD",
    language_code: str = "en-US",
) -> None:
    """Background worker entry point: extract text, call Google API, save MP3."""
    try:
        update_status(podcast_id, "processing")
        # Reuse the existing Podcastfy text extractor.
        from podcasts import extract_text  # type: ignore

        text = extract_text(source_path)
        if not text.strip():
            raise ValueError("no extractable text in source")

        # Respect Google Podcast API token limit (100k tokens). Heuristic: ~4 chars/token.
        MAX_CHARS = 95_000 * 4
        if len(text) > MAX_CHARS:
            text = text[:MAX_CHARS]

        ensure_dirs()
        audio_path = AUDIO_DIR / f"{podcast_id}.mp3"
        transcript_path = TRANSCRIPT_DIR / f"{podcast_id}.txt"

        title = f"EAiOS Brief: {source_name}"
        description = f"Generated from {source_name} using Google Gemini Notebook Enterprise Podcast API."
        operation_name = _start_generation(text, title, description, focus, length, language_code)
        operation = _poll_operation(operation_name)
        if "error" in operation:
            raise RuntimeError(f"Operation failed: {operation['error']}")

        _download_mp3(operation_name, audio_path)

        # Google does not provide a transcript file, so save the source text as a reference.
        transcript_path.write_text(text[:5000], encoding="utf-8")

        if not audio_path.exists():
            raise FileNotFoundError("Google Podcast API did not produce an audio file")

        update_status(podcast_id, "ready", str(audio_path), str(transcript_path))
    except Exception as e:
        traceback.print_exc()
        update_status(podcast_id, "failed", error=f"{type(e).__name__}: {e}"[:500])
