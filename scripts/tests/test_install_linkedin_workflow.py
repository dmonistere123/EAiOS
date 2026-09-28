import os
from pathlib import Path
import subprocess
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[2]
INSTALLER = ROOT / 'scripts' / 'install-linkedin-workflow.py'


class InstallLinkedInWorkflow(unittest.TestCase):
    def test_install_preserves_default_and_profile_souls(self):
        with tempfile.TemporaryDirectory() as temp:
            home = Path(temp) / '.hermes'
            default_soul = home / 'SOUL.md'
            profile_soul = home / 'profiles' / 'custom-agent' / 'SOUL.md'
            default_soul.parent.mkdir(parents=True)
            profile_soul.parent.mkdir(parents=True)
            default_soul.write_text('# My Agent\nDefault identity.\n', encoding='utf-8')
            profile_soul.write_text('# Custom Agent\nProfile identity.\n', encoding='utf-8')
            before = (default_soul.read_bytes(), profile_soul.read_bytes())

            env = {**os.environ, 'HERMES_HOME': str(home)}
            subprocess.run(['python', str(INSTALLER)], check=True, env=env, capture_output=True, text=True)

            self.assertEqual(default_soul.read_bytes(), before[0])
            self.assertEqual(profile_soul.read_bytes(), before[1])
            backups = home / 'eaios' / 'workflow-backups'
            self.assertFalse(any(backups.rglob('SOUL.md')))
            self.assertTrue((home / 'scripts' / 'eaios-linkedin-comments.py').is_file())
            self.assertTrue((home / 'skills' / 'social-media' / 'linkedin-posting' / 'SKILL.md').is_file())


if __name__ == '__main__':
    unittest.main()
