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
soul = home / 'SOUL.md'
if soul.exists():
    text = soul.read_text()
    addition = '''\n## LinkedIn comment execution (EAiOS-managed)\n\nFor LinkedIn comment approvals, approval means publish, rejection means do not publish. Read the linkedin-posting skill. Create executable actionType publish envelopes using the eaios-linkedin-comments.py suggest helper; do not create review-only/manual-post tasks. For any assigned approval with linkedinComment, use python3 "${HERMES_HOME:-$HOME/.hermes}/scripts/eaios-linkedin-comments.py" publish <task-id>. Complete only after a verified posting receipt; failures remain blocked and must not be reported as successful publication. Never directly retry an unconfirmed write. Legacy review tasks need verified targets and corrected new suggestions, not automatic replay.\n'''
    if '## LinkedIn comment execution (EAiOS-managed)' not in text:
        shutil.copy2(soul, backup / 'SOUL.md')
        temporary = soul.with_name('SOUL.md.eaios-tmp')
        temporary.write_text(text + addition)
        temporary.chmod(soul.stat().st_mode & 0o777)
        temporary.replace(soul)
print('Installed approval-gated LinkedIn workflow')
