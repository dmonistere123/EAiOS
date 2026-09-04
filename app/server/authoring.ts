/**
 * Authoring store (W7) — confined disk writes for playbooks and skills.
 * Pure node, no vite/express types: shared by the dev middleware
 * (vite.config.ts) AND unit tests. Confinement is mandatory: every path is
 * derived from a validated slug and proven to stay under its root — never
 * a client-supplied path.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import { rmSync } from 'node:fs';

export const SLUG_RE = /^[a-z][a-z0-9-]*$/;
const MAX_SLUG = 64;

/** Natural input → slug: "Weekly Investor Update!" → "weekly-investor-update". */
export function slugify(raw: string): string {
  return raw
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/^(\d)/, 'a$1')
    .slice(0, MAX_SLUG);
}

export function assertSlug(slug: string, what = 'slug') {
  if (!SLUG_RE.test(slug) || slug.length > MAX_SLUG) {
    throw new Error(`${what} must be a lowercase slug (letters, digits, dashes; start with a letter), got "${slug}"`);
  }
}

/** Resolve `parts` under root and PROVE the result stays under root. */
export function confinedPath(root: string, ...parts: string[]): string {
  const absRoot = resolve(root);
  const p = resolve(absRoot, ...parts);
  if (p !== absRoot && !p.startsWith(absRoot + sep)) throw new Error('path escapes its root — refused');
  return p;
}

/** Atomic-ish write: tmp file in the same dir, then rename over the target. */
function writeAtomic(path: string, content: string) {
  const tmp = `${path}.tmp-${process.pid}`;
  writeFileSync(tmp, content, 'utf8');
  renameSync(tmp, path);
}

// ---------- playbooks ----------

export interface PlaybookInput {
  /** existing file slug for edits; omitted/derived from name on create */
  id?: string;
  name: string;
  description: string;
  status: 'draft' | 'published';
  mode: 'task' | 'swarm';
  assignee?: string;
  ownerAgentId?: string;
  skills: string[];
  workers?: string[];
  verifier?: string;
  synthesizer?: string;
  body: string;
}

const esc = (v: string) => `"${v.replace(/\s+/g, ' ').replace(/"/g, '\\"').trim()}"`;
const fmList = (key: string, values?: string[]) => (values && values.length ? `${key}: [${values.join(', ')}]\n` : '');
const fmScalar = (key: string, value?: string) => (value ? `${key}: ${esc(value)}\n` : '');

/** Parse just enough frontmatter back out (mirror of the index scanner). */
export function readPlaybookVersion(root: string, slug: string): { version?: string; status?: string } {
  try {
    const text = readFileSync(confinedPath(root, `${slug}.md`), 'utf8');
    const m = text.match(/^---\n([\s\S]*?)\n---/);
    if (!m) return {};
    const pick = (key: string) => m[1].match(new RegExp(`^${key}:\\s*"?([^"\\n]+?)"?\\s*$`, 'm'))?.[1];
    return { version: pick('version'), status: pick('status') };
  } catch {
    return {};
  }
}

/** semver patch bump — 0.3.0 → 0.3.1; non-semver input starts at 0.1.0. */
export function bumpPatch(version?: string): string {
  const m = version?.match(/^(\d+)\.(\d+)\.(\d+)$/);
  if (!m) return '0.1.0';
  return `${m[1]}.${m[2]}.${Number(m[3]) + 1}`;
}

export function buildPlaybookMarkdown(input: PlaybookInput, version: string, status: 'draft' | 'published'): string {
  const fm =
    `---\n` +
    `name: ${esc(input.name)}\n` +
    `description: ${esc(input.description)}\n` +
    `version: ${version}\n` +
    fmScalar('owner', input.ownerAgentId) +
    `status: ${status}\n` +
    `mode: ${input.mode}\n` +
    fmScalar('assignee', input.assignee) +
    fmList('skills', input.skills) +
    (input.mode === 'swarm' ? fmList('workers', input.workers) + fmScalar('verifier', input.verifier) + fmScalar('synthesizer', input.synthesizer) : '') +
    `---\n\n`;
  return fm + input.body.trim() + '\n';
}

/**
 * Create or edit a playbook. Version discipline is SERVER-side: the client
 * never picks a version. Create → 0.1.0 draft (or published if asked).
 * Edit → patch bump of the ON-DISK version; editing a published playbook
 * lands as a new DRAFT (published versions are immutable).
 */
export function writePlaybook(root: string, input: PlaybookInput): { id: string; version: string; status: 'draft' | 'published'; created: boolean; path: string } {
  if (!input.name.trim()) throw new Error('playbook name required');
  if (!input.body.trim()) throw new Error('playbook body required');
  const slug = input.id ?? slugify(input.name);
  assertSlug(slug, 'playbook id');
  const path = confinedPath(root, `${slug}.md`);
  const existing = readPlaybookVersion(root, slug);
  const created = !existsSync(path);
  let version: string;
  let status: 'draft' | 'published';
  if (created) {
    version = '0.1.0';
    status = input.status;
  } else {
    version = bumpPatch(existing.version);
    status = existing.status === 'published' ? 'draft' : input.status;
  }
  writeAtomic(path, buildPlaybookMarkdown(input, version, status));
  return { id: slug, version, status, created, path };
}

// ---------- skills ----------

export interface SkillInput {
  name: string; // slug
  category: string;
  description: string;
  body: string;
}

export function buildSkillMarkdown(input: SkillInput): string {
  return (
    `---\n` +
    `name: ${input.name}\n` +
    `description: ${esc(input.description)}\n` +
    `version: 0.1.0\n` +
    `author: EAiOS executive, Hermes Agent\n` +
    `license: MIT\n` +
    `platforms: [linux, macos, windows]\n` +
    `metadata:\n` +
    `  hermes:\n` +
    `    tags: [eaios]\n` +
    `---\n\n` +
    input.body.trim() +
    '\n'
  );
}

/** Create a user-local skill. CREATE-only — refuses to overwrite (409 semantics via error code). */
export function writeSkill(root: string, input: SkillInput): { path: string; name: string; category: string } {
  const slug = input.name.trim();
  const category = input.category.trim();
  assertSlug(slug, 'skill name');
  assertSlug(category, 'category');
  if (!input.description.trim()) throw new Error('description required');
  if (!input.body.trim()) throw new Error('skill body required');
  const dir = confinedPath(root, category, slug);
  const path = confinedPath(root, category, slug, 'SKILL.md');
  if (existsSync(path)) {
    const err = new Error(`skill "${slug}" already exists in ${category} — editing arrives in a later workstream`) as Error & { code?: string };
    err.code = 'already_exists';
    throw err;
  }
  mkdirSync(dir, { recursive: true });
  writeAtomic(path, buildSkillMarkdown(input));
  return { path, name: slug, category };
}

// ---------- skill lifecycle ----------

function rewriteSkillFrontmatter(path: string, mutator: (fm: string) => string) {
  const text = readFileSync(path, 'utf8');
  const m = text.match(/^(---\n[\s\S]*?\n---)(\n[\s\S]*)$/);
  if (!m) throw new Error('skill has no frontmatter');
  writeAtomic(path, mutator(m[1]) + m[2]);
}

export function updateSkillStatus(root: string, category: string, slug: string, status: 'enabled' | 'disabled') {
  assertSlug(slug, 'skill name');
  assertSlug(category, 'category');
  const path = confinedPath(root, category, slug, 'SKILL.md');
  if (!existsSync(path)) throw new Error(`skill "${slug}" not found in ${category}`);
  rewriteSkillFrontmatter(path, (fm) => {
    const next = fm.replace(/^status:\s*\S+\s*$/m, '').trim();
    return `${next}\nstatus: ${status}`;
  });
}

export function deleteSkill(root: string, category: string, slug: string) {
  assertSlug(slug, 'skill name');
  assertSlug(category, 'category');
  const dir = confinedPath(root, category, slug);
  if (!existsSync(dir)) throw new Error(`skill "${slug}" not found in ${category}`);
  rmSync(dir, { recursive: true, force: true });
}

// ---------- playbook lifecycle ----------

function rewritePlaybookFrontmatter(root: string, slug: string, mutator: (fm: string) => string) {
  const path = confinedPath(root, `${slug}.md`);
  const text = readFileSync(path, 'utf8');
  const m = text.match(/^(---\n[\s\S]*?\n---)(\n[\s\S]*)$/);
  if (!m) throw new Error('playbook has no frontmatter');
  writeAtomic(path, mutator(m[1]) + m[2]);
}

export function updatePlaybookEnabled(root: string, slug: string, enabled: boolean) {
  assertSlug(slug, 'playbook id');
  const path = confinedPath(root, `${slug}.md`);
  if (!existsSync(path)) throw new Error(`playbook "${slug}" not found`);
  rewritePlaybookFrontmatter(root, slug, (fm) => {
    const next = fm.replace(/^enabled:\s*\S+\s*$/m, '').trim();
    return `${next}\nenabled: ${enabled}`;
  });
}

export function deletePlaybook(root: string, slug: string) {
  assertSlug(slug, 'playbook id');
  const path = confinedPath(root, `${slug}.md`);
  if (!existsSync(path)) throw new Error(`playbook "${slug}" not found`);
  rmSync(path, { force: true });
}
