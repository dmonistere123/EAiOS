import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
import yaml

SPEC = importlib.util.spec_from_file_location("concierge_setup", Path(__file__).parents[1] / "setup-concierge.py")
setup_module = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(setup_module)


class ConciergeSetupTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.home = self.root / "hermes"
        self.home.mkdir()
        (self.root / "concierge").mkdir()
        (self.root / "concierge" / "SOUL.md").write_text("Guide role")
        (self.home / "config.yaml").write_text(yaml.safe_dump({"model": {"default": "existing-model", "provider": "existing-provider"}, "fallback_model": {"model": "existing-fallback", "provider": "existing-provider"}}))
        for name in ["SOUL.md", "MEMORY.md", "state.db", ".env"]:
            (self.home / name).write_text("root must remain untouched")
        self.before = {p.name: p.read_bytes() for p in self.home.iterdir()}
        self.target = self.home / "profiles" / "eaios-concierge"
        self.calls = []

    def runner(self, args, **kwargs):
        self.calls.append(args)
        self.assertEqual(args, ["hermes", "profile", "create", "eaios-concierge", "--no-alias", "--no-skills"])
        self.assertEqual(kwargs["env"]["HERMES_HOME"], str(self.home))
        self.target.mkdir(parents=True)
        (self.target / "config.yaml").write_text("{}")
        (self.target / ".env").write_text("# no credentials")

    def run_setup(self, **kwargs):
        return setup_module.setup(self.root, self.home, runner=self.runner, **kwargs)

    def test_review_only_does_not_create_anything(self):
        self.assertIn("no files changed", self.run_setup())
        self.assertEqual(self.calls, [])
        self.assertFalse(self.target.exists())

    def test_new_profile_is_opt_in_and_preserves_model_but_never_root_state(self):
        self.run_setup(apply=True)
        config = yaml.safe_load((self.target / "config.yaml").read_text())
        self.assertEqual(config["model"], {"default": "existing-model", "provider": "existing-provider"})
        self.assertEqual(config["fallback_model"]["model"], "existing-fallback")
        self.assertEqual(config["platform_toolsets"], {"cli": ["clarify"]})
        self.assertFalse(config["memory"]["memory_enabled"])
        self.assertFalse(config["memory"]["user_profile_enabled"])
        self.assertEqual(config["mcp_servers"], {})
        self.assertNotIn("fixture-secret", (self.target / "config.yaml").read_text())
        for name, content in self.before.items():
            self.assertEqual((self.home / name).read_bytes(), content)
        self.assertFalse((self.target / "state.db").exists())
        self.assertFalse((self.target / "MEMORY.md").exists())

    def test_existing_profile_is_not_overwritten(self):
        self.run_setup(apply=True)
        with self.assertRaises(ValueError):
            self.run_setup(apply=True)
        self.assertEqual(len(self.calls), 1)

    def test_explicit_document_refresh_preserves_config_and_history(self):
        self.run_setup(apply=True)
        (self.target / "state.db").write_text("profile history")
        config = (self.target / "config.yaml").read_bytes()
        (self.root / "concierge" / "SOUL.md").write_text("Revised guide role")
        self.run_setup(apply=True, refresh=True)
        self.assertEqual((self.target / "SOUL.md").read_text(), "Revised guide role")
        self.assertEqual((self.target / "state.db").read_text(), "profile history")
        self.assertEqual((self.target / "config.yaml").read_bytes(), config)
        self.assertEqual(len(self.calls), 1)

    def test_customized_or_symlinked_instructions_block_refresh(self):
        self.run_setup(apply=True)
        (self.target / "SOUL.md").write_text("User customization")
        with self.assertRaises(ValueError):
            self.run_setup(apply=True, refresh=True)
        (self.target / "SOUL.md").unlink()
        (self.target / "SOUL.md").symlink_to(self.home / "SOUL.md")
        with self.assertRaises(ValueError):
            self.run_setup(apply=True, refresh=True)
        self.assertEqual((self.home / "SOUL.md").read_bytes(), self.before["SOUL.md"])

    def test_model_credentials_require_review_before_profile_creation(self):
        (self.home / "config.yaml").write_text(yaml.safe_dump({"model": {"default": "existing-model", "provider": "existing-provider", "api_key": "fixture-secret"}}))
        with self.assertRaises(ValueError):
            self.run_setup(apply=True)
        self.assertEqual(self.calls, [])
        self.assertFalse(self.target.exists())

    def test_missing_soul_never_creates_profile(self):
        (self.root / "concierge" / "SOUL.md").unlink()
        with self.assertRaises(FileNotFoundError):
            self.run_setup(apply=True)
        self.assertEqual(self.calls, [])


if __name__ == "__main__":
    unittest.main()
