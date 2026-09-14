"""EAiOS Podcast sidecar module — document-to-podcast via Podcastfy.

Mounted into the knowledge sidecar HTTP surface. Podcasts are generated
asynchronously: POST /podcasts/generate returns immediately with a pending
podcast id; a background thread runs Podcastfy (OpenRouter LLM + Edge TTS)
and updates the DB to ready/failed.
"""
import io
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

ELEVENLABS_API_KEY = os.environ.get("ELEVENLABS_API_KEY", "")
OPENAI_API_KEY = os.environ.get("OPENAI_API_KEY", "")

TTS_PROVIDERS = {"edge", "elevenlabs", "openai", "gemini", "geminimulti"}
DEFAULT_VOICES = {
    "edge": {"question": "en-US-JennyNeural", "answer": "en-US-EricNeural"},
    "elevenlabs": {"question": "Chris", "answer": "Jessica"},
    "openai": {"question": "echo", "answer": "shimmer"},
    "gemini": {"question": "en-US-Journey-D", "answer": "en-US-Journey-O"},
    "geminimulti": {"question": "R", "answer": "S"},
}

PODCAST_SCHEMA = """
CREATE TABLE IF NOT EXISTS podcasts (
  id TEXT PRIMARY KEY,
  source_id TEXT,
  source_name TEXT NOT NULL,
  source_type TEXT NOT NULL,        -- knowledge_source | file
  provider TEXT NOT NULL DEFAULT 'podcastfy',  -- podcastfy | google
  tts_model TEXT NOT NULL DEFAULT 'edge',      -- edge | elevenlabs | openai
  voice_map TEXT,                              -- JSON {host, guest}
  status TEXT NOT NULL,             -- pending | processing | ready | failed
  audio_path TEXT,
  transcript_path TEXT,
  error TEXT,
  created_at TEXT NOT NULL,
  finished_at TEXT
);
"""

# One-time migrations for podcasts created before these columns existed.
_MIGRATE_PROVIDER = """
ALTER TABLE podcasts ADD COLUMN provider TEXT NOT NULL DEFAULT 'podcastfy';
"""
_MIGRATE_TTS_MODEL = """
ALTER TABLE podcasts ADD COLUMN tts_model TEXT NOT NULL DEFAULT 'edge';
"""
_MIGRATE_VOICE_MAP = """
ALTER TABLE podcasts ADD COLUMN voice_map TEXT;
"""


def now_iso() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def _migrate(conn: sqlite3.Connection, sql: str):
    try:
        conn.execute(sql)
        conn.commit()
    except sqlite3.OperationalError:
        # Column already exists — safe to ignore.
        conn.rollback()


def db() -> sqlite3.Connection:
    conn = sqlite3.connect(DB)
    conn.row_factory = sqlite3.Row
    conn.executescript(PODCAST_SCHEMA)
    _migrate(conn, _MIGRATE_PROVIDER)
    _migrate(conn, _MIGRATE_TTS_MODEL)
    _migrate(conn, _MIGRATE_VOICE_MAP)
    return conn


def ensure_dirs():
    PODCASTS_DIR.mkdir(parents=True, exist_ok=True)
    PODCAST_FILES.mkdir(parents=True, exist_ok=True)
    AUDIO_DIR.mkdir(parents=True, exist_ok=True)
    TRANSCRIPT_DIR.mkdir(parents=True, exist_ok=True)


def podcast_row(r: sqlite3.Row) -> dict:
    row = {
        "id": r["id"],
        "sourceId": r["source_id"],
        "sourceName": r["source_name"],
        "sourceType": r["source_type"],
        "provider": r["provider"],
        "ttsModel": r["tts_model"],
        "status": r["status"],
        "audioPath": r["audio_path"],
        "transcriptPath": r["transcript_path"],
        "error": r["error"],
        "createdAt": r["created_at"],
        "finishedAt": r["finished_at"],
    }
    if r["voice_map"]:
        try:
            row["voiceMap"] = json.loads(r["voice_map"])
        except json.JSONDecodeError:
            pass
    return row


def tts_status() -> list[dict]:
    """Return available TTS providers and a sample of known voices."""
    elevenlabs_available = bool(ELEVENLABS_API_KEY)
    openai_available = bool(OPENAI_API_KEY)
    return [
        {
            "id": "edge",
            "name": "Edge TTS",
            "available": True,
            "voices": [
                "en-US-JennyNeural",
                "en-US-EricNeural",
                "en-US-AriaNeural",
                "en-US-GuyNeural",
                "en-US-SaraNeural",
                "en-GB-SoniaNeural",
            ],
        },
        {
            "id": "elevenlabs",
            "name": "ElevenLabs",
            "available": elevenlabs_available,
            "voices": [
                "Adam", "Antoni", "Bella", "Callum", "Charlie", "Charlotte",
                "Chris", "Daniel", "Eric", "George", "Jessica", "Josh", "Liam",
                "Matilda", "Rachel", "Will",
            ],
        },
        {
            "id": "openai",
            "name": "OpenAI",
            "available": openai_available,
            "voices": ["alloy", "echo", "fable", "onyx", "nova", "shimmer"],
        },
    ]


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


def _resolve_elevenlabs_voices(voices: dict[str, str]) -> dict[str, str]:
    """Map ElevenLabs voice names/prefixes to voice IDs. Falls back to input if no match."""
    try:
        from elevenlabs import client as elevenlabs_client

        client = elevenlabs_client.ElevenLabs(api_key=ELEVENLABS_API_KEY)
        available = [(v.voice_id, v.name) for v in client.voices.get_all().voices]
    except Exception:
        return voices

    def resolve(name_or_id: str) -> str:
        needle = name_or_id.strip().lower()
        # Exact voice ID match.
        for vid, vname in available:
            if vid.lower() == needle:
                return vid
        # Exact name match (ElevenLabs names now include descriptions).
        for vid, vname in available:
            if vname.strip().lower() == needle:
                return vid
        # Prefix match on the first token of the name.
        for vid, vname in available:
            first_token = vname.split("-")[0].strip().lower()
            if first_token == needle:
                return vid
        return name_or_id

    return {role: resolve(v) for role, v in voices.items()}


def _resolve_elevenlabs_voice_id(name_or_id: str) -> str:
    """Resolve a single ElevenLabs voice name/prefix to its voice ID."""
    resolved = _resolve_elevenlabs_voices({"v": name_or_id}).get("v", name_or_id)
    return resolved


def sample_tts(provider: str, voice: str, text: str | None = None) -> bytes:
    """Generate a short audio sample for the given TTS provider + voice."""
    sample_text = text or "Hi, this is a quick voice sample for EAiOS podcasts."
    if provider == "edge":
        import asyncio
        import edge_tts

        edge_voice = voice or "en-US-JennyNeural"
        communicate = edge_tts.Communicate(sample_text, edge_voice)

        async def _collect() -> bytes:
            output = io.BytesIO()
            async for chunk in communicate.stream():
                if chunk.get("type") == "audio":
                    output.write(chunk.get("data", b""))
            return output.getvalue()

        return asyncio.run(_collect())
    if provider == "elevenlabs":
        if not ELEVENLABS_API_KEY:
            raise ValueError("ELEVENLABS_API_KEY not configured")
        from elevenlabs import client as elevenlabs_client

        client = elevenlabs_client.ElevenLabs(api_key=ELEVENLABS_API_KEY)
        resolved_voice = _resolve_elevenlabs_voice_id(voice or "Chris")
        audio = client.generate(text=sample_text, voice=resolved_voice, model="eleven_multilingual_v2")
        return b"".join(chunk for chunk in audio if chunk)
    if provider == "openai":
        if not OPENAI_API_KEY:
            raise ValueError("OPENAI_API_KEY not configured")
        import openai

        client = openai.OpenAI(api_key=OPENAI_API_KEY)
        response = client.audio.speech.create(
            model="tts-1-hd",
            voice=(voice or "echo").lower()[:6] if (voice or "echo").lower() in ["alloy", "echo", "fable", "onyx", "nova", "shimmer"] else "echo",
            input=sample_text,
        )
        return response.read()
    raise ValueError(f"unsupported TTS provider for sampling: {provider}")


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
    tts_config: dict | None = None,
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

        tts_config = tts_config or {}
        tts_provider = tts_config.get("provider", DEFAULT_TTS)
        if tts_provider not in TTS_PROVIDERS:
            raise ValueError(f"unsupported tts provider: {tts_provider}")

        voices = DEFAULT_VOICES.get(tts_provider, DEFAULT_VOICES["edge"]).copy()
        if tts_config.get("voiceHost"):
            voices["question"] = tts_config["voiceHost"]
        if tts_config.get("voiceGuest"):
            voices["answer"] = tts_config["voiceGuest"]

        # ElevenLabs accepts voice IDs; its default names like "Chris" are now
        # suffixed with descriptions ("Chris - Charming, Down-to-Earth"), so a
        # plain name lookup fails. Resolve a prefix/name to a voice ID when we
        # have the key.
        if tts_provider == "elevenlabs" and ELEVENLABS_API_KEY:
            voices = _resolve_elevenlabs_voices(voices)

        audio_path = AUDIO_DIR / f"{podcast_id}.mp3"
        transcript_path = TRANSCRIPT_DIR / f"{podcast_id}.txt"

        # Podcastfy writes its own transcript/audio under output_directories,
        # then we copy/rename to our deterministic paths.
        result_path = generate_podcast(
            text=text,
            tts_model=tts_provider,
            llm_model_name=DEFAULT_LLM,
            api_key_label=API_KEY_LABEL,
            conversation_config={
                "text_to_speech": {
                    "default_tts_model": tts_provider,
                    tts_provider: {
                        "default_voices": voices,
                    },
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


def create_from_knowledge_source(source_id: str, tts_config: dict | None = None) -> dict:
    conn = db()
    row = conn.execute("SELECT * FROM sources WHERE id = ?", (source_id,)).fetchone()
    if not row:
        raise ValueError("source not found")
    source_path = Path(row["stored_path"])
    if not source_path.exists():
        raise ValueError("source file missing")
    return _create(source_path, row["name"], "knowledge_source", source_id, provider="podcastfy", tts_config=tts_config)


def create_from_file(file_bytes: bytes, filename: str, tts_config: dict | None = None) -> dict:
    ensure_dirs()
    ext = Path(filename).suffix.lower()[:12] or ".pdf"
    pid = f"p-{uuid.uuid4().hex[:8]}"
    stored = PODCAST_FILES / f"{pid}{ext}"
    stored.write_bytes(file_bytes)
    return _create(stored, filename, "file", None, provider="podcastfy", tts_config=tts_config)


def _create(source_path: Path, source_name: str, source_type: str, source_id: str | None, provider: str = "podcastfy", tts_config: dict | None = None) -> dict:
    ensure_dirs()
    pid = f"p-{uuid.uuid4().hex[:8]}"
    created = now_iso()
    tts_config = tts_config or {}
    tts_model = tts_config.get("provider", DEFAULT_TTS)
    if tts_model not in TTS_PROVIDERS:
        raise ValueError(f"unsupported tts provider: {tts_model}")
    voice_map = None
    if tts_config.get("voiceHost") or tts_config.get("voiceGuest"):
        voice_map = json.dumps({
            "host": tts_config.get("voiceHost") or DEFAULT_VOICES.get(tts_model, DEFAULT_VOICES["edge"])["question"],
            "guest": tts_config.get("voiceGuest") or DEFAULT_VOICES.get(tts_model, DEFAULT_VOICES["edge"])["answer"],
        })
    conn = db()
    conn.execute(
        """INSERT INTO podcasts (id, source_id, source_name, source_type, provider, tts_model, voice_map, status,
                                audio_path, transcript_path, error, created_at, finished_at)
           VALUES (?,?,?,?,?,?,?, 'pending', NULL, NULL, NULL, ?, NULL)""",
        (pid, source_id, source_name, source_type, provider, tts_model, voice_map, created),
    )
    conn.commit()

    thread = threading.Thread(
        target=_generate_worker,
        args=(pid, source_path, source_name),
        kwargs={"tts_config": tts_config},
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
