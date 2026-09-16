#!/usr/bin/env python3
"""EAiOS knowledge sidecar — Phase 5.5 acceptance tests (spec §8.7/§8.8).

Black-box: spawns the real server.py as a subprocess on an ephemeral port
with a temp data dir, then exercises the acceptance surface:

  §8.8  indexing state machine   pending→ready, garbage→failed (error kept),
                                   reindex recovers failed→ready
  §8.8  scope enforcement        executive sees all; agent sees workspace +
                                   own agent-scoped; private withheld
  §8.7  citation surface         search returns source+chunk refs; chunk
                                   drill-down returns full text for the same id
  §8.8  playbook versioning      (app-side; covered by vitest acceptance)

Run: ../sidecar/.venv/bin/python -m unittest discover -s ../sidecar -v
(also wired as `npm run test:sidecar` in app/)
"""
import http.client
import json
import os
import socket
import subprocess
import sys
import tempfile
import time
import unittest
import uuid
from pathlib import Path

SIDECAR = Path(__file__).resolve().parent / "server.py"


def free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


class SidecarCase(unittest.TestCase):
    proc: subprocess.Popen
    port: int
    tmp: tempfile.TemporaryDirectory

    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory(prefix="eaios-ktest-")
        cls.port = free_port()
        env = dict(os.environ, EAIOS_KNOWLEDGE_DATA_DIR=cls.tmp.name, EAIOS_KNOWLEDGE_PORT=str(cls.port))
        cls.proc = subprocess.Popen(
            [sys.executable, str(SIDECAR)],
            env=env,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        for _ in range(100):
            try:
                if cls.get("/health")["ok"]:
                    break
            except OSError:
                time.sleep(0.1)
        else:
            raise RuntimeError("sidecar did not start")

    @classmethod
    def tearDownClass(cls):
        cls.proc.terminate()
        cls.proc.wait(timeout=10)
        cls.tmp.cleanup()

    # ----- tiny HTTP helpers -----
    @classmethod
    def req(cls, method: str, path: str, body: bytes | None = None, headers: dict | None = None) -> tuple[int, dict]:
        conn = http.client.HTTPConnection("127.0.0.1", cls.port, timeout=15)
        conn.request(method, path, body=body, headers=headers or {})
        res = conn.getresponse()
        payload = json.loads(res.read() or b"{}")
        conn.close()
        return res.status, payload

    @classmethod
    def get(cls, path: str) -> dict:
        code, payload = cls.req("GET", path)
        assert code == 200, f"GET {path} -> {code}: {payload}"
        return payload

    @classmethod
    def upload(cls, filename: str, content: bytes, scope: str, name: str = "", allowed: list[str] | None = None) -> dict:
        boundary = uuid.uuid4().hex
        parts = []
        parts.append(f"--{boundary}\r\ncontent-disposition: form-data; name=\"file\"; filename=\"{filename}\"\r\ncontent-type: application/octet-stream\r\n\r\n".encode() + content + b"\r\n")
        parts.append(f"--{boundary}\r\ncontent-disposition: form-data; name=\"scope\"\r\n\r\n{scope}\r\n".encode())
        if name:
            parts.append(f"--{boundary}\r\ncontent-disposition: form-data; name=\"name\"\r\n\r\n{name}\r\n".encode())
        if allowed:
            parts.append(f"--{boundary}\r\ncontent-disposition: form-data; name=\"allowedAgentIds\"\r\n\r\n{json.dumps(allowed)}\r\n".encode())
        parts.append(f"--{boundary}--\r\n".encode())
        code, payload = cls.req("POST", "/sources/upload", b"".join(parts), {"content-type": f"multipart/form-data; boundary={boundary}"})
        assert code == 200, f"upload -> {code}: {payload}"
        return payload["source"]


class TestIndexingStateMachine(SidecarCase):
    """§8.8: pending → ready | failed; failed keeps error; reindex recovers."""

    def test_happy_path_reaches_ready_with_chunks(self):
        src = self.upload("notes.md", b"Alpha bravo charlie. " * 100, "workspace", "smoke notes")
        self.assertEqual(src["indexingStatus"], "ready")
        self.assertGreater(src["chunkCount"], 1, "long doc should produce multiple chunks")
        self.assertIsNotNone(src["freshnessAt"])

    def test_garbage_pdf_fails_with_error_kept(self):
        src = self.upload("broken.pdf", b"this is not a real pdf", "workspace", "broken pdf")
        self.assertEqual(src["indexingStatus"], "failed")
        listed = self.get("/sources")["sources"]
        row = next(s for s in listed if s["id"] == src["id"])
        self.assertEqual(row["indexingStatus"], "failed")
        self.assertTrue(row["error"], "failed source must keep its error detail")

    def test_empty_text_fails_then_reindex_recovers(self):
        src = self.upload("empty.md", b"   \n  ", "workspace", "empty doc")
        self.assertEqual(src["indexingStatus"], "failed")
        # write real content over the stored file, then reindex
        stored = next(Path(self.tmp.name).glob(f"files/{src['id']}.*"))
        stored.write_text("Recovered content about quarterly planning.", encoding="utf-8")
        code, payload = self.req("POST", f"/sources/{src['id']}/reindex")
        self.assertEqual(code, 200)
        self.assertEqual(payload["source"]["indexingStatus"], "ready")
        self.assertGreater(payload["source"]["chunkCount"], 0)


class TestScopeEnforcement(SidecarCase):
    """§8.8: agents never see private; agent-scoped only for named agents."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.ws = cls.upload("ws.md", b"confidential workspace handbook terms", "workspace", "ws doc")
        cls.priv = cls.upload("priv.md", b"confidential private ceo journal terms", "private", "private doc")
        cls.ag = cls.upload("ag.md", b"confidential scout briefing terms", "agent", "agent doc", allowed=["scout"])

    def names(self, agent_id: str = "") -> set[str]:
        q = f"/search?q=confidential{('&agent_id=' + agent_id) if agent_id else ''}"
        return {r["sourceName"] for r in self.get(q)["results"]}

    def test_executive_context_sees_all(self):
        self.assertEqual(self.names(), {"ws doc", "private doc", "agent doc"})

    def test_named_agent_sees_workspace_plus_own(self):
        self.assertEqual(self.names("scout"), {"ws doc", "agent doc"})

    def test_other_agent_sees_workspace_only(self):
        self.assertEqual(self.names("quill"), {"ws doc"})


class TestCitationSurface(SidecarCase):
    """§8.7: every retrieved result cites source + chunk; drill-down resolves it."""

    def test_search_then_chunk_round_trip(self):
        src = self.upload("cite.md", b"The citation contract requires chunk identifiers.", "workspace", "cite doc")
        results = self.get("/search?q=citation+contract")["results"]
        self.assertTrue(results, "search should hit the uploaded doc")
        r = results[0]
        self.assertEqual(r["sourceId"], src["id"])
        self.assertRegex(r["chunkId"], rf"^{src['id']}:\d+$")
        self.assertIn("citationEnabled", r)
        self.assertTrue(r["sourceName"])
        chunk = self.get(f"/chunks/{r['chunkId']}")
        self.assertEqual(chunk["chunkId"], r["chunkId"])
        self.assertIn("citation contract", chunk["text"])
        self.assertEqual(chunk["scope"], "workspace")

    def test_non_citable_flag_round_trips(self):
        boundaryless = self.upload("plain.md", b"uncitable reference material", "workspace", "uncitable doc")
        self.assertTrue(boundaryless["citationEnabled"], "default is citable")
        # upload with citationEnabled=false
        boundary = uuid.uuid4().hex
        body = (
            f"--{boundary}\r\ncontent-disposition: form-data; name=\"file\"; filename=\"nc.md\"\r\n\r\nuncitable second doc\r\n"
            f"--{boundary}\r\ncontent-disposition: form-data; name=\"name\"\r\n\r\nnc doc\r\n"
            f"--{boundary}\r\ncontent-disposition: form-data; name=\"scope\"\r\n\r\nworkspace\r\n"
            f"--{boundary}\r\ncontent-disposition: form-data; name=\"citationEnabled\"\r\n\r\nfalse\r\n"
            f"--{boundary}--\r\n"
        ).encode()
        code, payload = self.req("POST", "/sources/upload", body, {"content-type": f"multipart/form-data; boundary={boundary}"})
        self.assertEqual(code, 200)
        self.assertFalse(payload["source"]["citationEnabled"])
        hits = [r for r in self.get("/search?q=uncitable")["results"] if r["sourceName"] == "nc doc"]
        self.assertTrue(hits and not hits[0]["citationEnabled"])


class TestPodcastTtsStatus(SidecarCase):
    """TTS provider status reflects configured API keys."""

    def test_tts_status_returns_providers(self):
        status = self.get("/podcasts/tts-status")
        self.assertIn("providers", status)
        ids = {p["id"] for p in status["providers"]}
        self.assertEqual(ids, {"edge", "elevenlabs", "openai"})
        edge = next(p for p in status["providers"] if p["id"] == "edge")
        self.assertTrue(edge["available"])
        self.assertTrue(edge["voices"])


class TestPodcastGenerationTtsConfig(SidecarCase):
    """Per-generation TTS provider and voice selection persist on the podcast record."""

    def test_generate_with_elevenlabs_stores_tts_model(self):
        # Provide a tiny text file; generation will fail quickly without an
        # ElevenLabs key, but the record should still capture the requested model.
        body = b"Artificial intelligence is transforming the economy."
        boundary = uuid.uuid4().hex
        parts = [
            f"--{boundary}\r\ncontent-disposition: form-data; name=\"file\"; filename=\"ai.txt\"\r\n\r\n".encode()
            + body
            + b"\r\n",
            f"--{boundary}\r\ncontent-disposition: form-data; name=\"ttsModel\"\r\n\r\nelevenlabs\r\n".encode(),
            f"--{boundary}\r\ncontent-disposition: form-data; name=\"voiceHost\"\r\n\r\nChris\r\n".encode(),
            f"--{boundary}\r\ncontent-disposition: form-data; name=\"voiceGuest\"\r\n\r\nJessica\r\n".encode(),
            f"--{boundary}--\r\n".encode(),
        ]
        code, payload = self.req(
            "POST",
            "/podcasts/generate",
            b"".join(parts),
            {"content-type": f"multipart/form-data; boundary={boundary}"},
        )
        self.assertEqual(code, 202)
        podcast = payload["podcast"]
        self.assertEqual(podcast["ttsModel"], "elevenlabs")
        self.assertEqual(podcast["voiceMap"], {"host": "Chris", "guest": "Jessica"})

    def test_generate_defaults_to_edge(self):
        body = b"Short document."
        boundary = uuid.uuid4().hex
        parts = [
            f"--{boundary}\r\ncontent-disposition: form-data; name=\"file\"; filename=\"short.txt\"\r\n\r\n".encode()
            + body
            + b"\r\n",
            f"--{boundary}--\r\n".encode(),
        ]
        code, payload = self.req(
            "POST",
            "/podcasts/generate",
            b"".join(parts),
            {"content-type": f"multipart/form-data; boundary={boundary}"},
        )
        self.assertEqual(code, 202)
        self.assertEqual(payload["podcast"]["ttsModel"], "edge")


if __name__ == "__main__":
    unittest.main()
