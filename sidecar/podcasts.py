"""EAiOS Podcast sidecar module — document-to-podcast via Podcastfy.

Mounted into the knowledge sidecar HTTP surface. Podcasts are generated
asynchronously: POST /podcasts/generate returns immediately with a pending
podcast id; a background thread runs Podcastfy (OpenRouter LLM + Edge TTS)
and updates the DB to ready/failed.
"""
import json
import os
import sqlite3
import threading
import time
import traceback
import uuid
from pathlib import Path

# Podcastfy pulls public prompt manifests from the LangChain Hub. Recent
# LangSmith versions require an explicit opt-in flag; we monkeypatch the
# client call site so the open-source dependency keeps working.
try:
    from langsmith import Client as _LangSmithClient

    _orig_pull_prompt = _LangSmithClient.pull_prompt

    def _pull_prompt_safe(self, owner_repo_commit, *args, **kwargs):
        kwargs["dangerously_pull_public_prompt"] = True
        return _orig_pull_prompt(self, owner_repo_commit, *args, **kwargs)

    _LangSmithClient.pull_prompt = _pull_prompt_safe
except Exception:
    pass  # if the patch fails, Podcastfy will fail loudly on the same step

# Delay importing Podcastfy until generation time; it is heavy and prints
# warnings on import. We still do it module-level after the monkeypatch.
from podcastfy.client import generate_podcast  # noqa: E402

ROOT = Path(__file__).resolve().parent
DATA = Path(os.environ.get("EAIOS_KNOWLEDGE_DATA_DIR", ROOT / "data"))
PODCASTS_DIR = DATA / "podcasts"
PODCAST_FILES = PODCASTS_DIR / "files"
AUDIO_DIR = PODCASTS_DIR / "audio"
TRANSCRIPT_DIR = PODCASTS_DIR / "transcripts"
DB = DATA / "knowledge.db"

DEFAULT_LLM = os.environ.get("EAIOS_PODCAST_LLM", "openrouter/deepseek-v4-flash")
DEFAULT_TTS = os.environ.get("EAIOS_PODCAST_TTS", "edge")
API_KEY_LABEL = os.environ.get("EAIOS_PODCAST_API_KEY_LABEL", "OPENROUTER_API_KEY")

PODCAST_SCHEMA = """
CREATE TABLE IF NOT EXISTS podcasts (
  id TEXT PRIMARY KEY,
  source_id TEXT,
  source_name TEXT NOT NULL,
  source_type TEXT NOT NULL,        -- knowledge_source | file
  provider TEXT NOT NULL DEFAULT 'podcastfy',  -- podcastfy | google
  status TEXT NOT NULL,             -- pending | processing | ready | failed
  audio_path TEXT,
  transcript_path TEXT,
  error TEXT,
  created_at TEXT NOT NULL,
  finished_at TEXT
);
"""

# One-time migration: add the provider column to podcasts created before this schema.
_MIGRATE_PROVIDER = """
ALTER TABLE podcasts ADD COLUMN provider TEXT NOT NULL DEFAULT 'podcastfy';
"""


def now_iso() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def db() -> sqlite3.Connection:
    conn = sqlite3.connect(DB)
    conn.row_factory = sqlite3.Row
    conn.executescript(PODCAST_SCHEMA)
    try:
        conn.execute(_MIGRATE_PROVIDER)
        conn.commit()
    except sqlite3.OperationalError:
        # Column already exists — safe to ignore.
        conn.rollback()
    return conn


def ensure_dirs():
    PODCASTS_DIR.mkdir(parents=True, exist_ok=True)
    PODCAST_FILES.mkdir(parents=True, exist_ok=True)
    AUDIO_DIR.mkdir(parents=True, exist_ok=True)
    TRANSCRIPT_DIR.mkdir(parents=True, exist_ok=True)


def podcast_row(r: sqlite3.Row) -> dict:
    return {
        "id": r["id"],
        "sourceId": r["source_id"],
        "sourceName": r["source_name"],
        "sourceType": r["source_type"],
        "provider": r["provider"],
        "status": r["status"],
        "audioPath": r["audio_path"],
        "transcriptPath": r["transcript_path"],
        "error": r["error"],
        "createdAt": r["created_at"],
        "finishedAt": r["finished_at"],
    }


def list_podcasts() -> list[dict]:
    conn = db()
    rows = conn.execute("SELECT * FROM podcasts ORDER BY created_at DESC").fetchall()
    return [podcast_row(r) for r in rows]


def get_podcast(podcast_id: str) -> dict | None:
    conn = db()
    r = conn.execute("SELECT * FROM podcasts WHERE id = ?", (podcast_id,)).fetchone()
    return podcast_row(r) if r else None


def update_status(
    podcast_id: str,
    status: str,
    audio_path: str | None = None,
    transcript_path: str | None = None,
    error: str | None = None,
):
    conn = db()
    finished = now_iso() if status in ("ready", "failed") else None
    conn.execute(
        """UPDATE podcasts
           SET status = ?, audio_path = ?, transcript_path = ?, error = ?, finished_at = ?
           WHERE id = ?""",
        (status, audio_path, transcript_path, error, finished, podcast_id),
    )
    conn.commit()


def extract_text(path: Path) -> str:
    """Reuse the knowledge sidecar text extraction for supported file types."""
    ext = path.suffix.lower()
    if ext == ".pdf":
        import fitz

        with fitz.open(path) as doc:
            return "\n\n".join(page.get_text() for page in doc)
    if ext == ".docx":
        import docx

        d = docx.Document(path)
        return "\n".join(p.text for p in d.paragraphs if p.text.strip())
    if ext == ".pptx":
        from pptx import Presentation

        prs = Presentation(path)
        out = []
        for slide in prs.slides:
            for shape in slide.shapes:
                if shape.has_text_frame:
                    out.append(shape.text_frame.text)
        return "\n\n".join(out)
    raw = path.read_bytes()
    text = raw.decode("utf-8", errors="replace")
    return text.strip()


def _generate_worker(
    podcast_id: str,
    source_path: Path,
    source_name: str,
):
    """Background generation: extract text -> Podcastfy -> update DB."""
    try:
        update_status(podcast_id, "processing")
        text = extract_text(source_path)
        if not text.strip():
            raise ValueError("no extractable text in source")

        # Truncate very long documents to keep LLM costs predictable.
        # 30k chars is roughly 7.5k tokens — plenty for a short podcast.
        MAX_CHARS = 30_000
        if len(text) > MAX_CHARS:
            text = text[:MAX_CHARS]

        audio_path = AUDIO_DIR / f"{podcast_id}.mp3"
        transcript_path = TRANSCRIPT_DIR / f"{podcast_id}.txt"

        # Podcastfy writes its own transcript/audio under output_directories,
        # then we copy/rename to our deterministic paths.
        result_path = generate_podcast(
            text=text,
            tts_model=DEFAULT_TTS,
            llm_model_name=DEFAULT_LLM,
            api_key_label=API_KEY_LABEL,
            conversation_config={
                "text_to_speech": {
                    "default_tts_model": DEFAULT_TTS,
                    "output_directories": {
                        "transcripts": str(TRANSCRIPT_DIR),
                        "audio": str(AUDIO_DIR),
                    },
                },
                "podcast_name": "EAiOS",
                "podcast_tagline": "Document to podcast",
                "output_language": "English",
            },
        )

        # result_path is the MP3; Podcastfy also saved a transcript in the same
        # output directory, but with an independent UUID. Rename both to our
        # deterministic paths so the API can serve them.
        generated_audio = Path(result_path)

        # Find the transcript Podcastfy just wrote (newest .txt in the dir).
        generated_transcript = None
        transcript_candidates = sorted(
            TRANSCRIPT_DIR.glob("transcript_*.txt"),
            key=lambda p: p.stat().st_mtime,
            reverse=True,
        )
        if transcript_candidates:
            generated_transcript = transcript_candidates[0]

        # Rename to deterministic paths so the API can serve them.
        if generated_audio.exists():
            generated_audio.rename(audio_path)
        if generated_transcript and generated_transcript.exists():
            generated_transcript.rename(transcript_path)

        if not audio_path.exists():
            raise FileNotFoundError("Podcastfy did not produce an audio file")

        update_status(podcast_id, "ready", str(audio_path), str(transcript_path))
    except Exception as e:
        traceback.print_exc()
        update_status(podcast_id, "failed", error=f"{type(e).__name__}: {e}"[:500])


def create_from_knowledge_source(source_id: str) -> dict:
    conn = db()
    row = conn.execute("SELECT * FROM sources WHERE id = ?", (source_id,)).fetchone()
    if not row:
        raise ValueError("source not found")
    source_path = Path(row["stored_path"])
    if not source_path.exists():
        raise ValueError("source file missing")
    return _create(source_path, row["name"], "knowledge_source", source_id, provider="podcastfy")


def create_from_file(file_bytes: bytes, filename: str) -> dict:
    ensure_dirs()
    ext = Path(filename).suffix.lower()[:12] or ".pdf"
    pid = f"p-{uuid.uuid4().hex[:8]}"
    stored = PODCAST_FILES / f"{pid}{ext}"
    stored.write_bytes(file_bytes)
    return _create(stored, filename, "file", None, provider="podcastfy")


def _create(source_path: Path, source_name: str, source_type: str, source_id: str | None, provider: str = "podcastfy") -> dict:
    ensure_dirs()
    pid = f"p-{uuid.uuid4().hex[:8]}"
    created = now_iso()
    conn = db()
    conn.execute(
        """INSERT INTO podcasts (id, source_id, source_name, source_type, provider, status,
                                audio_path, transcript_path, error, created_at, finished_at)
           VALUES (?,?,?,?,?, 'pending', NULL, NULL, NULL, ?, NULL)""",
        (pid, source_id, source_name, source_type, provider, created),
    )
    conn.commit()

    thread = threading.Thread(
        target=_generate_worker,
        args=(pid, source_path, source_name),
        daemon=True,
    )
    thread.start()

    return podcast_row(
        conn.execute("SELECT * FROM podcasts WHERE id = ?", (pid,)).fetchone()
    )


def create_google_from_knowledge_source(source_id: str, focus: str | None = None, length: str = "STANDARD") -> dict:
    conn = db()
    row = conn.execute("SELECT * FROM sources WHERE id = ?", (source_id,)).fetchone()
    if not row:
        raise ValueError("source not found")
    source_path = Path(row["stored_path"])
    if not source_path.exists():
        raise ValueError("source file missing")
    return _create_google(source_path, row["name"], "knowledge_source", source_id, focus, length)


def create_google_from_file(file_bytes: bytes, filename: str, focus: str | None = None, length: str = "STANDARD") -> dict:
    ensure_dirs()
    ext = Path(filename).suffix.lower()[:12] or ".pdf"
    pid = f"p-{uuid.uuid4().hex[:8]}"
    stored = PODCAST_FILES / f"{pid}{ext}"
    stored.write_bytes(file_bytes)
    return _create_google(stored, filename, "file", None, focus, length)


def _create_google(
    source_path: Path,
    source_name: str,
    source_type: str,
    source_id: str | None,
    focus: str | None = None,
    length: str = "STANDARD",
) -> dict:
    """Create a podcast record and start the Google Podcast API background worker."""
    import google_podcasts

    ensure_dirs()
    pid = f"p-{uuid.uuid4().hex[:8]}"
    created = now_iso()
    conn = db()
    conn.execute(
        """INSERT INTO podcasts (id, source_id, source_name, source_type, provider, status,
                                audio_path, transcript_path, error, created_at, finished_at)
           VALUES (?,?,?,?,?, 'pending', NULL, NULL, NULL, ?, NULL)""",
        (pid, source_id, source_name, source_type, "google", created),
    )
    conn.commit()

    thread = threading.Thread(
        target=google_podcasts.generate,
        args=(pid, source_path, source_name),
        kwargs={"focus": focus, "length": length},
        daemon=True,
    )
    thread.start()

    return podcast_row(
        conn.execute("SELECT * FROM podcasts WHERE id = ?", (pid,)).fetchone()
    )


def get_audio_path(podcast_id: str) -> Path | None:
    p = get_podcast(podcast_id)
    if not p or not p["audioPath"]:
        return None
    path = Path(p["audioPath"])
    return path if path.exists() else None


def get_transcript_path(podcast_id: str) -> Path | None:
    p = get_podcast(podcast_id)
    if not p or not p["transcriptPath"]:
        return None
    path = Path(p["transcriptPath"])
    return path if path.exists() else None
