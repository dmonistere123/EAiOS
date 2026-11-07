#!/usr/bin/env python3
"""Explicit opt-in only: install the executive's scheduled-work policy.
Never invoked by application installers/updaters. Preserves custom text and backups.
"""
import argparse
from datetime import datetime, timezone
from pathlib import Path
import shutil

START = '<!-- EAiOS scheduled-work policy v1 -->'
END = '<!-- /EAiOS scheduled-work policy -->'
TARGETS = (
    'SOUL.md',
    'skills/productivity/eaios-governance/SKILL.md',
    'skills/productivity/eaios-governance/references/recurring-jobs-and-schedule.md',
    'skills/productivity/eaios-briefing-podcast/SKILL.md',
)

def render(text, policy):
    block = START + '\n' + policy.strip() + '\n' + END + '\n\n'
    if START in text:
        before, rest = text.split(START, 1)
        _, after = rest.split(END, 1)
        return before + block.rstrip('\n') + after
    # Keep skill frontmatter at the start.
    if text.startswith('---\n'):
        end = text.find('\n---\n', 4)
        if end == -1:
            raise ValueError('Unclosed skill frontmatter')
        end += 5
        return text[:end] + '\n' + block + text[end:]
    return block + text

def install(home, policy, apply=False, seed_missing=False):
    changes = []
    for relative in TARGETS:
        path = home / relative
        if path.exists() and (path.is_symlink() or not path.is_file()):
            raise ValueError(f'Unsafe policy target: {relative}')
        if not path.is_file() and not seed_missing:
            raise ValueError(f'Required policy source missing: {relative}')
        old = path.read_text() if path.exists() else ''
        if not old and relative.endswith('/SKILL.md'):
            name = path.parent.name
            old = f'---\nname: {name}\ndescription: EAiOS scheduled work and communication authorization.\n---\n'
        new = render(old, policy)
        if new != old:
            changes.append((path, new))
    backup = home / 'eaios' / 'policy-backups' / datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
    if apply and changes:
        for path, _ in changes:
            dest = backup / path.relative_to(home)
            dest.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
            if path.exists(): shutil.copy2(path, dest)
        for path, new in changes:
            path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
            temp = path.with_name(path.name + '.policy-tmp')
            temp.write_text(new)
            temp.chmod((path.stat().st_mode & 0o777) if path.exists() else 0o600)
            temp.replace(path)
    return [str(path.relative_to(home)) for path, _ in changes], str(backup) if apply and changes else None

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--hermes-home', type=Path, required=True)
    parser.add_argument('--apply', action='store_true')
    parser.add_argument('--seed-missing', action='store_true', help='Initialize absent policy files; preserve existing customized text')
    args = parser.parse_args()
    policy = (Path(__file__).resolve().parent.parent / 'config/scheduled-work-policy.md').read_text()
    changed, backup = install(args.hermes_home, policy, args.apply, args.seed_missing)
    print(('Updated: ' if args.apply else 'Would update: ') + ', '.join(changed))
    if backup:
        print('Backup: ' + backup)
