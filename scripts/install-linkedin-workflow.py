#!/usr/bin/env python3
"""Install the EAiOS-owned LinkedIn executor and its agent instructions."""
from pathlib import Path
import os
import shutil
import time

root = Path(__file__).resolve().parents[1]
home = Path(os.environ.get('HERMES_HOME', str(Path.home() / '.hermes')))
backup = home / 'eaios' / 'workflow-backups' / str(time.time_ns())
backup.mkdir(parents=True, mode=0o700)
for source, target in [(root / 'scripts/linkedin-comments.py', home / 'scripts/eaios-linkedin-comments.py'), (root / 'install/hermes-skills/linkedin-posting.md', home / 'skills/social-media/linkedin-posting/SKILL.md')]:
    target.parent.mkdir(parents=True, exist_ok=True)
    if target.exists() and target.read_bytes() == source.read_bytes():
        continue
    if target.exists():
        shutil.copy2(target, backup / target.name)
    temporary = target.with_name(target.name + '.eaios-tmp')
    shutil.copyfile(source, temporary)
    temporary.chmod(0o700 if source.suffix == '.py' else 0o600)
    temporary.replace(target)
print('Installed approval-gated LinkedIn workflow')
