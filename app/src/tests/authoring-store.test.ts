// @vitest-environment node
/// <reference types="node" />
/**
 * W7 authoring-store unit tests — confined disk writes for playbooks and
 * skills. Runs against tmp dirs, never the real roots. Confinement and
 * version discipline are the contract: escapes and bad slugs are refused,
 * versions bump server-side, published edits land as drafts.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { bumpPatch, buildSkillMarkdown, confinedPath, readPlaybookVersion, slugify, writePlaybook, writeSkill } from '../../server/authoring';

const root = mkdtempSync(join(tmpdir(), 'eaios-authoring-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));

const baseInput = {
  name: 'Weekly Investor Update',
  description: 'Metrics pull → draft → approval → send.',
  status: 'draft' as const,
  mode: 'task' as const,
  skills: ['eaios-knowledge-retrieval'],
  body: '## Steps\n1. Pull metrics.\n2. Draft.\n3. Park send in Approvals.',
};

describe('slugify + confinement', () => {
  it('derives slugs from natural names', () => {
    expect(slugify('Weekly Investor Update!')).toBe('weekly-investor-update');
    expect(slugify('  Spaces   everywhere ')).toBe('spaces-everywhere');
    expect(slugify('2nd draft')).toBe('a2nd-draft');
  });

  it('confinedPath proves containment and refuses escapes', () => {
    expect(confinedPath(root, 'ok.md')).toBe(join(root, 'ok.md'));
    expect(() => confinedPath(root, '..', 'evil.md')).toThrow(/escapes/);
    expect(() => confinedPath(root, 'a', '..', '..', 'evil.md')).toThrow(/escapes/);
    expect(() => confinedPath(root, '/etc/passwd')).toThrow(/escapes/);
  });

  it('writePlaybook refuses non-slug ids (../evil never reaches the fs)', () => {
    expect(() => writePlaybook(root, { ...baseInput, id: '../evil' })).toThrow(/slug/);
    expect(() => writePlaybook(root, { ...baseInput, id: 'a/b' })).toThrow(/slug/);
    expect(existsSync(join(root, 'evil.md'))).toBe(false);
  });
});

describe('writePlaybook', () => {
  it('create lands a parseable md at 0.1.0 with the requested status', () => {
    const saved = writePlaybook(root, baseInput);
    expect(saved.created).toBe(true);
    expect(saved.id).toBe('weekly-investor-update');
    expect(saved.version).toBe('0.1.0');
    const text = readFileSync(join(root, 'weekly-investor-update.md'), 'utf8');
    // the index scanner's own regex must parse what we write
    const m = text.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
    expect(m).toBeTruthy();
    expect(m![1]).toContain('name: "Weekly Investor Update"');
    expect(m![1]).toContain('version: 0.1.0');
    expect(m![1]).toContain('status: draft');
    expect(m![1]).toContain('skills: [eaios-knowledge-retrieval]');
    expect(m![2].trim()).toContain('## Steps');
    expect(readPlaybookVersion(root, 'weekly-investor-update')).toEqual({ version: '0.1.0', status: 'draft' });
  });

  it('edit bumps the patch version server-side', () => {
    const saved = writePlaybook(root, { ...baseInput, id: 'weekly-investor-update', description: 'Edited.' });
    expect(saved.created).toBe(false);
    expect(saved.version).toBe('0.1.1');
    expect(readPlaybookVersion(root, 'weekly-investor-update').version).toBe('0.1.1');
  });

  it('editing a PUBLISHED playbook lands as a new draft (immutability contract)', () => {
    writePlaybook(root, { ...baseInput, id: 'board-deck', name: 'Board Deck', status: 'published' });
    expect(readPlaybookVersion(root, 'board-deck')).toEqual({ version: '0.1.0', status: 'published' });
    const saved = writePlaybook(root, { ...baseInput, id: 'board-deck', name: 'Board Deck', status: 'published', body: '## Steps\n1. Changed.' });
    expect(saved.version).toBe('0.1.1');
    expect(saved.status).toBe('draft');
    expect(readPlaybookVersion(root, 'board-deck')).toEqual({ version: '0.1.1', status: 'draft' });
  });

  it('bumpPatch handles semver and junk', () => {
    expect(bumpPatch('0.3.0')).toBe('0.3.1');
    expect(bumpPatch('1.2.9')).toBe('1.2.10');
    expect(bumpPatch(undefined)).toBe('0.1.0');
    expect(bumpPatch('weird')).toBe('0.1.0');
  });
});

describe('writeSkill', () => {
  it('creates a confined SKILL.md with standards-shaped frontmatter', () => {
    const saved = writeSkill(root, { name: 'board-memos', category: 'productivity', description: 'Draft board memos from notes and metrics.', body: '# Board Memos\n\n## When to Use\n- Memo time.' });
    expect(saved.path).toBe(join(root, 'productivity', 'board-memos', 'SKILL.md'));
    const text = readFileSync(saved.path, 'utf8');
    expect(text.startsWith('---\n')).toBe(true);
    expect(text).toContain('name: board-memos');
    expect(text).toContain('description: "Draft board memos from notes and metrics."');
    expect(text).toContain('version: 0.1.0');
    expect(text).toContain('author: EAiOS executive, Hermes Agent');
    expect(text).toContain('## When to Use');
  });

  it('refuses to overwrite (create-only)', () => {
    expect(() => writeSkill(root, { name: 'board-memos', category: 'productivity', description: 'Again.', body: 'x' })).toThrow(/already exists/);
    try {
      writeSkill(root, { name: 'board-memos', category: 'productivity', description: 'Again.', body: 'x' });
    } catch (e) {
      expect((e as { code?: string }).code).toBe('already_exists');
    }
  });

  it('validates slug + category (no traversal, no free-form paths)', () => {
    expect(() => writeSkill(root, { name: '../evil', category: 'productivity', description: 'd', body: 'b' })).toThrow(/slug/);
    expect(() => writeSkill(root, { name: 'ok-name', category: '..', description: 'd', body: 'b' })).toThrow(/slug/);
    expect(existsSync(join(root, 'evil'))).toBe(false);
  });

  it('buildSkillMarkdown keeps descriptions single-line and quoted', () => {
    const md = buildSkillMarkdown({ name: 'x-skill', category: 'general', description: 'Line one\nLine two', body: 'body' });
    expect(md).toContain('description: "Line one Line two"');
  });
});
