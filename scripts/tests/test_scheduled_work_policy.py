import importlib.util
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('policy', Path(__file__).parents[1] / 'update-scheduled-work-policy.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
POLICY = (Path(__file__).parents[2] / 'config/scheduled-work-policy.md').read_text()

class PolicyInstallTests(unittest.TestCase):
    def test_preserves_custom_instructions_and_frontmatter_and_is_idempotent(self):
        for original in ['custom identity\nnever send unapproved emails\n', '---\nname: custom\n---\n\nprivate custom rules\n']:
            changed = module.render(original, POLICY)
            self.assertEqual(module.render(changed, POLICY), changed)
            self.assertIn(original.split('---\n')[-1], changed)
            if original.startswith('---'): self.assertTrue(changed.startswith('---\nname: custom\n---\n'))
            self.assertIn('All other outgoing communications require', changed)
            self.assertIn('Telegram messages to anyone other than the executive', changed)
            self.assertIn('Deliver them without another approval', changed)
            self.assertIn('If the executive explicitly asks', changed)

    def test_explicit_apply_backup_and_dry_run(self):
        with tempfile.TemporaryDirectory() as d:
            home = Path(d)
            for name in module.TARGETS:
                p = home/name; p.parent.mkdir(parents=True, exist_ok=True); p.write_text('custom original\n')
            changes, backup = module.install(home, POLICY)
            self.assertEqual(len(changes), 4); self.assertIsNone(backup)
            self.assertEqual((home/'SOUL.md').read_text(), 'custom original\n')
            _, backup = module.install(home, POLICY, True)
            for name in module.TARGETS:
                self.assertEqual((Path(backup)/name).read_text(), 'custom original\n')
            self.assertEqual(module.install(home, POLICY, True), ([], None))

    def test_missing_target_makes_no_partial_changes(self):
        with tempfile.TemporaryDirectory() as d:
            home = Path(d); (home/'SOUL.md').write_text('unchanged')
            with self.assertRaises(ValueError): module.install(home, POLICY, True)
            self.assertEqual((home/'SOUL.md').read_text(), 'unchanged')

if __name__ == '__main__': unittest.main()
