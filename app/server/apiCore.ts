/// <reference types="node" />
/**
 * apiCore (Phase 8.1, F10) — the EAiOS API's shared logic as pure functions,
 * extracted from vite.config.ts's dev middleware so the production server
 * (server/prod.ts) and — after consolidation (F22) — the vite dev middleware
 * ride ONE implementation. Zero npm deps; node:sqlite (Node ≥24) read-only.
 *
 * Everything here was lifted verbatim from vite.config.ts 2026-08-29; any
 * behavior change belongs here AND (until F22 lands) in vite.config.ts.
 */
import { readdirSync, readFileSync, statSync, writeFileSync, renameSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

/* ---------------------------------------------------------------- skills */

export interface SkillIndexEntry {
  name: string;
  category: string;
  description?: string;
  version?: string;
  status: 'enabled' | 'disabled';
}

export function parseSkillFrontmatter(text: string) {
  const m = text.match(/^---\n([\s\S]*?)\n---/);
  if (!m) return {};
  const pick = (key: string) => {
    const km = m[1].match(new RegExp(`^${key}:\\s*"?([^"\\n]+?)"?\\s*$`, 'm'));
    return km?.[1];
  };
  const status = pick('status');
  return { name: pick('name'), description: pick('description'), version: pick('version'), status: status === 'disabled' ? ('disabled' as const) : ('enabled' as const) };
}

/** Frontmatter metadata for every SKILL.md under <hermesHome>/skills. The
 * gateway's skills.manage RPC returns only {category: [names]} — enrichment
 * has no RPC surface, so the live adapter reads it here. */
export function scanSkills(root: string): SkillIndexEntry[] {
  const skills: SkillIndexEntry[] = [];
  const walk = (dir: string, depth: number) => {
    if (depth > 4) return;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p, depth + 1);
      else if (e.name === 'SKILL.md') {
        try {
          const fm = parseSkillFrontmatter(readFileSync(p, 'utf8'));
          const name = fm.name;
          if (!name) continue;
          const category = relative(root, join(p, '..')).split(sep)[0] || 'general';
          skills.push({ name, category, description: fm.description, version: fm.version, status: fm.status ?? 'enabled' });
        } catch {
          // unreadable skill file — skip, don't fail the index
        }
      }
    }
  };
  walk(root, 0);
  return skills;
}

/* ------------------------------------------------------------- playbooks */

export interface PlaybookIndexEntry {
  id: string;
  name: string;
  description: string;
  version: string;
  status: 'published' | 'draft';
  enabled: boolean;
  mode: 'swarm' | 'task';
  assignee?: string;
  ownerAgentId?: string;
  skills: string[];
  workers: string[];
  verifier?: string;
  synthesizer?: string;
  body: string;
}

const pickFm = (fm: string, key: string) => {
  const km = fm.match(new RegExp(`^${key}:\\s*(.+?)\\s*$`, 'm'));
  return km?.[1];
};
const pickScalar = (fm: string, key: string) => {
  const v = pickFm(fm, key);
  return v ? v.replace(/^"(.*)"$/, '$1') : undefined;
};
const pickList = (fm: string, key: string): string[] => {
  const v = pickFm(fm, key);
  if (!v) return [];
  const m = v.match(/^\[(.*)\]$/);
  return (m ? m[1] : v)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
};

/** Parsed frontmatter + body for every playbook markdown in the playbooks
 * root (versioned workflows on disk, Phase 5.4). */
export function scanPlaybooks(root: string): PlaybookIndexEntry[] {
  const playbooks: PlaybookIndexEntry[] = [];
  let files: string[] = [];
  try {
    files = readdirSync(root).filter((f) => f.endsWith('.md'));
  } catch {
    return playbooks;
  }
  for (const f of files) {
    try {
      const text = readFileSync(join(root, f), 'utf8');
      const m = text.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
      if (!m) continue;
      const [, fm, body] = m;
      playbooks.push({
        id: f.replace(/\.md$/, ''),
        name: pickScalar(fm, 'name') ?? f.replace(/\.md$/, ''),
        description: pickScalar(fm, 'description') ?? '',
        version: pickScalar(fm, 'version') ?? '0.0.0',
        status: pickScalar(fm, 'status') === 'published' ? 'published' : 'draft',
        mode: pickScalar(fm, 'mode') === 'swarm' ? 'swarm' : 'task',
        enabled: pickScalar(fm, 'enabled') !== 'false',
        assignee: pickScalar(fm, 'assignee'),
        ownerAgentId: pickScalar(fm, 'owner'),
        skills: pickList(fm, 'skills'),
        workers: pickList(fm, 'workers'),
        verifier: pickScalar(fm, 'verifier'),
        synthesizer: pickScalar(fm, 'synthesizer'),
        body: body.trim(),
      });
    } catch {
      // unreadable playbook — skip, don't fail the index
    }
  }
  return playbooks;
}

/* ----------------------------------------------------------------- usage */

/** Token/cost aggregates from Hermes' state.db `session_model_usage`
 * (Phase 6.1). insights.get RPC returns only {days, sessions, messages} —
 * no token/cost data — so the live adapter reads the authoritative store
 * directly. READ-ONLY; costs stay exactly as Hermes recorded them (D7).
 * Throws on missing/locked DB → caller maps to 503 → mock fallback. */
export function queryUsage(dbPath: string, fromIso: string, toIso: string) {
  const from = Date.parse(fromIso) / 1000;
  const to = Date.parse(toIso) / 1000;
  if (!Number.isFinite(from) || !Number.isFinite(to)) throw new Error('bad range');
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    const rows = db
      .prepare(
        `SELECT COALESCE(s.profile_name, 'default') AS agent,
                SUM(u.input_tokens)        AS input_tokens,
                SUM(u.output_tokens)       AS output_tokens,
                SUM(u.estimated_cost_usd)  AS estimated_cost_usd,
                SUM(u.actual_cost_usd)     AS actual_cost_usd,
                MAX(u.last_seen)           AS last_seen
         FROM session_model_usage u
         LEFT JOIN sessions s ON s.id = u.session_id
         WHERE u.last_seen >= ? AND u.last_seen <= ?
         GROUP BY agent
         ORDER BY input_tokens DESC`,
      )
      .all(from, to) as {
      agent: string;
      input_tokens: number | null;
      output_tokens: number | null;
      estimated_cost_usd: number | null;
      actual_cost_usd: number | null;
      last_seen: number | null;
    }[];
    const byAgent = rows.map((r) => ({
      agentId: r.agent,
      inputTokens: r.input_tokens ?? 0,
      outputTokens: r.output_tokens ?? 0,
      estimatedCostUsd: r.estimated_cost_usd ?? 0,
      actualCostUsd: r.actual_cost_usd ?? 0,
    }));
    return {
      range: { from: fromIso, to: toIso },
      inputTokens: byAgent.reduce((n, r) => n + r.inputTokens, 0),
      outputTokens: byAgent.reduce((n, r) => n + r.outputTokens, 0),
      estimatedCostUsd: byAgent.reduce((n, r) => n + r.estimatedCostUsd, 0),
      actualCostUsd: byAgent.reduce((n, r) => n + r.actualCostUsd, 0),
      byAgent,
      freshnessAt: rows.length
        ? new Date(Math.max(...rows.map((r) => r.last_seen ?? 0)) * 1000).toISOString()
        : new Date().toISOString(),
    };
  } finally {
    db.close();
  }
}

/* ------------------------------------------------------ daily spend (F29) */

/** Rate-card entry: 'match' is a case-insensitive substring of the model id;
 * rates are USD per 1M FRESH input/output tokens (cache excluded — validated
 * vs the executive's actual bill, Sep 2: $11.35 est vs ~$12 charged). */
export interface RateCardEntry {
  match: string;
  input: number;
  output: number;
}

/** Embedded fallback — the canonical card is <eaiosRoot>/config/rate-card.json
 * (shared with scripts/spend-watchdog.py; keep both in sync when editing). */
export const DEFAULT_RATE_CARD: { rates: RateCardEntry[]; fallback: { input: number; output: number } } = {
  rates: [
    { match: 'kimi-k3', input: 3.0, output: 14.0 },
    { match: 'kimi-k2.7-code-highspeed', input: 1.9, output: 8.0 },
    { match: 'kimi-k2.7', input: 0.95, output: 4.0 },
    { match: 'kimi-k2.6', input: 0.95, output: 4.0 },
    { match: 'deepseek-v4-flash', input: 0.088, output: 0.176 },
    { match: 'qwen3.7-flash', input: 0.03, output: 0.13 },
    { match: 'glm-5', input: 0.3, output: 1.2 },
    { match: 'glm-4', input: 0.3, output: 0.9 },
    { match: 'minimax-m', input: 0.6, output: 2.4 },
  ],
  fallback: { input: 3.0, output: 14.0 },
};

/** Load the shared rate card; missing/corrupt file → embedded default (never a 500). */
export function loadRateCard(eaiosRoot: string): typeof DEFAULT_RATE_CARD {
  try {
    const parsed = JSON.parse(readFileSync(join(eaiosRoot, 'config', 'rate-card.json'), 'utf8')) as {
      rates?: RateCardEntry[];
      default?: { input: number; output: number };
    };
    if (Array.isArray(parsed.rates) && parsed.rates.length && parsed.rates.every((r) => r.match && Number.isFinite(r.input) && Number.isFinite(r.output))) {
      return { rates: parsed.rates, fallback: parsed.default && Number.isFinite(parsed.default.input) ? parsed.default : DEFAULT_RATE_CARD.fallback };
    }
  } catch {
    // fall through to embedded default
  }
  return DEFAULT_RATE_CARD;
}

function rateFor(model: string, rates: RateCardEntry[], fallback: { input: number; output: number }) {
  const m = (model || '').toLowerCase();
  for (const r of rates) if (m.includes(r.match.toLowerCase())) return r;
  return { match: '(default)', ...fallback };
}

export interface DailySpendSession {
  sessionId: string;
  title: string;
  model: string;
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
}
export interface DailySpendDay {
  date: string; // YYYY-MM-DD, server-local
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
  overThreshold: boolean;
  topSessions: DailySpendSession[];
}

/** Per-day estimated spend (F29) across the default + every profile state.db.
 * Same semantics as scripts/spend-watchdog.py: a usage row's tokens bill to
 * the LOCAL day of its last_seen; cost = fresh input + output at rate-card
 * prices. Days are zero-filled so the UI can render a continuous bar strip.
 * READ-ONLY; throws on the DEFAULT db missing (caller → 503 → mock), but a
 * missing/corrupt PROFILE db is skipped honestly (its spend just won't show). */
export function queryDailySpend(dbPaths: string[], days: number, rates: RateCardEntry[], fallback: { input: number; output: number }, thresholdUsd: number): { thresholdUsd: number; estimatedWith: 'eaios-rate-card'; days: DailySpendDay[]; freshnessAt: string } {
  const ndays = Math.max(1, Math.min(90, Math.floor(days)));
  const labels: string[] = [];
  {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    for (let i = ndays - 1; i >= 0; i--) {
      const day = new Date(d.getTime() - i * 86_400_000);
      const y = day.getFullYear();
      const m = String(day.getMonth() + 1).padStart(2, '0');
      const dd = String(day.getDate()).padStart(2, '0');
      labels.push(`${y}-${m}-${dd}`);
    }
  }
  const cutoff = new Date(`${labels[0]}T00:00:00`).getTime() / 1000;

  const byDay = new Map<string, { cost: number; tin: number; tout: number; sessions: Map<string, DailySpendSession> }>();
  for (const l of labels) byDay.set(l, { cost: 0, tin: 0, tout: 0, sessions: new Map() });
  let freshest = 0;
  let firstDb = true;

  for (const dbPath of dbPaths) {
    let db;
    try {
      db = new DatabaseSync(dbPath, { readOnly: true });
    } catch (e) {
      if (firstDb) throw e; // default db missing = endpoint down → mock fallback
      continue; // profile db missing = skip honestly
    }
    firstDb = false;
    try {
      const rows = db
        .prepare(
          `SELECT strftime('%Y-%m-%d', u.last_seen, 'unixepoch', 'localtime') AS day,
                  u.session_id AS sid, u.model AS model,
                  COALESCE(s.title, u.session_id) AS title,
                  SUM(u.input_tokens) AS tin, SUM(u.output_tokens) AS tout,
                  MAX(u.last_seen) AS last_seen
           FROM session_model_usage u
           LEFT JOIN sessions s ON s.id = u.session_id
           WHERE u.last_seen >= ?
           GROUP BY day, u.session_id, u.model`,
        )
        .all(cutoff) as { day: string; sid: string; model: string; title: string; tin: number | null; tout: number | null; last_seen: number | null }[];
      for (const r of rows) {
        const bucket = byDay.get(r.day);
        if (!bucket) continue; // row just outside the window edge
        const rate = rateFor(r.model, rates, fallback);
        const cost = ((r.tin ?? 0) / 1e6) * rate.input + ((r.tout ?? 0) / 1e6) * rate.output;
        bucket.cost += cost;
        bucket.tin += r.tin ?? 0;
        bucket.tout += r.tout ?? 0;
        if (r.last_seen && r.last_seen > freshest) freshest = r.last_seen;
        const sess = bucket.sessions.get(r.sid) ?? { sessionId: r.sid, title: r.title, model: r.model, costUsd: 0, inputTokens: 0, outputTokens: 0 };
        sess.costUsd += cost;
        sess.inputTokens += r.tin ?? 0;
        sess.outputTokens += r.tout ?? 0;
        bucket.sessions.set(r.sid, sess);
      }
    } finally {
      db.close();
    }
  }

  return {
    thresholdUsd,
    estimatedWith: 'eaios-rate-card',
    days: labels.map((date) => {
      const b = byDay.get(date)!;
      return {
        date,
        costUsd: Math.round(b.cost * 100) / 100,
        inputTokens: b.tin,
        outputTokens: b.tout,
        overThreshold: b.cost > thresholdUsd,
        topSessions: [...b.sessions.values()].sort((a, z) => z.costUsd - a.costUsd).slice(0, 3),
      };
    }),
    freshnessAt: freshest ? new Date(freshest * 1000).toISOString() : new Date().toISOString(),
  };
}

/* ------------------------------------------------------------- artifacts */

const MIME: Record<string, string> = {
  '.md': 'text/markdown',
  '.txt': 'text/plain',
  '.json': 'application/json',
  '.csv': 'text/csv',
  '.html': 'text/html',
  '.pdf': 'application/pdf',
};

export function guessMime(name: string) {
  return MIME[name.slice(name.lastIndexOf('.')).toLowerCase()] ?? 'application/octet-stream';
}

/** Agent-created outputs backed by kanban task_attachments (Phase 6.3, spec
 * §8.9): attachment → task (assignee, title, status). READ-ONLY. */
export function listArtifacts(dbPath: string) {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    const rows = db
      .prepare(
        `SELECT a.id, a.task_id, a.filename, a.stored_path, a.content_type, a.size,
                a.uploaded_by, a.created_at,
                t.title AS task_title, t.assignee AS task_assignee, t.status AS task_status
         FROM task_attachments a
         LEFT JOIN tasks t ON t.id = a.task_id
         ORDER BY a.created_at DESC`,
      )
      .all() as {
      id: number; task_id: string; filename: string; stored_path: string;
      content_type: string | null; size: number; uploaded_by: string | null; created_at: number;
      task_title: string | null; task_assignee: string | null; task_status: string | null;
    }[];
    return {
      artifacts: rows.map((r) => {
        const mimeType = r.content_type ?? guessMime(r.filename);
        // Text-ish attachments are readable in-app (dogfood 2026-08-29).
        const previewable = mimeType.startsWith('text/') || mimeType === 'application/json';
        return {
          id: `att-${r.id}`,
          taskId: r.task_id,
          taskTitle: r.task_title,
          name: r.filename,
          mimeType,
          sizeBytes: r.size,
          uploadedBy: r.uploaded_by,
          agentId: r.task_assignee ?? r.uploaded_by ?? 'default',
          taskStatus: r.task_status,
          createdAt: new Date(r.created_at * 1000).toISOString(),
          previewAvailable: previewable,
          downloadUrl: `/api/artifacts/att-${r.id}/raw`,
        };
      }),
    };
  } finally {
    db.close();
  }
}

/** Resolve an attachment's file for /raw streaming with ROOT CONFINEMENT —
 * the DB's stored_path is data, not authority; anything resolving outside
 * the attachments root is rejected. */
export function rawArtifact(dbPath: string, attachRoot: string, idParam: string) {
  const rowId = Number(idParam.replace(/^att-/, ''));
  if (!Number.isInteger(rowId)) throw new Error('bad id');
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    const r = db.prepare('SELECT filename, stored_path, content_type FROM task_attachments WHERE id = ?').get(rowId) as
      | { filename: string; stored_path: string; content_type: string | null }
      | undefined;
    if (!r) return undefined;
    const resolved = resolve(r.stored_path);
    if (!resolved.startsWith(resolve(attachRoot) + sep)) throw new Error('path escapes attachments root');
    return { filename: r.filename, path: resolved, mime: r.content_type ?? guessMime(r.filename) };
  } finally {
    db.close();
  }
}

/* -------------------------------------------------------------- settings */

/** EAiOS-owned settings (Phase 6.2, F15) live in <eaiosRoot>/settings.local.json
 * (gitignored) — the gateway has no generic config-write RPC. Server-side key
 * allowlist; never allowlist anything credential-shaped. */
export const SETTINGS_ALLOWED_KEYS = new Set(['usageBudgetUsd', 'dailySpendAlertUsd']);

export function readSettings(file: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {}; // missing/corrupt file = empty settings, never a 500
  }
}

/** Validate + apply a settings patch atomically (tmp + rename).
 * Throws Error with a client-safe message on bad keys/values. */
export function writeSettings(file: string, patch: Record<string, unknown>): Record<string, unknown> {
  const keys = Object.keys(patch);
  if (!keys.length || keys.some((k) => !SETTINGS_ALLOWED_KEYS.has(k))) {
    throw new Error(`keys must be within: ${[...SETTINGS_ALLOWED_KEYS].join(', ')}`);
  }
  if (patch.usageBudgetUsd !== null && patch.usageBudgetUsd !== undefined && (typeof patch.usageBudgetUsd !== 'number' || !(patch.usageBudgetUsd > 0))) {
    throw new Error('usageBudgetUsd must be a positive number or null');
  }
  if (patch.dailySpendAlertUsd !== null && patch.dailySpendAlertUsd !== undefined && (typeof patch.dailySpendAlertUsd !== 'number' || !(patch.dailySpendAlertUsd > 0))) {
    throw new Error('dailySpendAlertUsd must be a positive number or null');
  }
  const next = readSettings(file);
  for (const k of keys) {
    if (patch[k] === null) delete next[k];
    else next[k] = patch[k];
  }
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, JSON.stringify(next, null, 2));
  renameSync(tmp, file);
  return next;
}

/* ---------------------------------------------------------------- kanban */

/** Kanban task projection matching the adapter's KanbanTask shape (the
 * fields cli.exec `kanban list --json` returns). READ-ONLY node:sqlite —
 * the cli.exec RPC truncates at 48000 chars (dogfood 2026-08-29: the board
 * crossed it, JSON.parse died, and every kanban-backed slice silently fell
 * back to mock), so the board read rides this endpoint like usage/artifacts
 * already do. Writes still go through cli.exec (small outputs). */
export function listKanbanTasks(dbPath: string) {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    // Merge the latest run summary into result when tasks.result is stale/null.
    // Hermetic tests and older kanban databases may lack task_links/task_runs,
    // so each optional lookup is wrapped individually.
    const runSummaries = new Map<string, string>();
    try {
      const runs = db
        .prepare(
          `SELECT task_id, summary FROM task_runs
           WHERE id IN (SELECT MAX(id) FROM task_runs GROUP BY task_id)`,
        )
        .all() as { task_id: string; summary: string | null }[];
      for (const r of runs) {
        if (r.summary) runSummaries.set(r.task_id, r.summary);
      }
    } catch {
      /* task_runs may not exist in tests/old DBs */
    }

    const fillResult = (row: Record<string, unknown>) => {
      const id = String(row.id);
      if (!row.result && runSummaries.has(id)) row.result = runSummaries.get(id);
      return row;
    };

    try {
      const rows = db
        .prepare(
          `SELECT t.id, t.title, t.body, t.assignee, t.status, t.priority, t.tenant, t.created_by,
                  t.created_at, t.started_at, t.completed_at, t.result, t.block_kind,
                  (SELECT GROUP_CONCAT(l.parent_id) FROM task_links l WHERE l.child_id = t.id) AS parents
           FROM tasks t
           ORDER BY t.created_at DESC`,
        )
        .all();
      return { tasks: rows.map(fillResult) };
    } catch {
      const rows = db
        .prepare(
          `SELECT id, title, body, assignee, status, priority, tenant, created_by,
                  created_at, started_at, completed_at, result
           FROM tasks
           ORDER BY created_at DESC`,
        )
        .all();
      return { tasks: rows.map(fillResult) };
    }
  } finally {
    db.close();
  }
}

/** Update a kanban task body directly. Used for approval-envelope payload
 * edits where no Hermes CLI subcommand exists. Scoped to approval tasks:
 * the body must remain a valid JSON envelope. */
export function updateKanbanTaskBody(dbPath: string, taskId: string, body: string) {
  const db = new DatabaseSync(dbPath);
  try {
    const info = db.prepare('UPDATE tasks SET body = ? WHERE id = ?').run(body, taskId);
    if (info.changes === 0) throw new Error('task not found');
  } finally {
    db.close();
  }
}

/** Delegated-run view (Don 2026-08-29): assigned tasks joined to their kanban
 * worker sessions. Worker sessions ARE in state.db (source='kanban') but the
 * gateway deny-lists them from session.list — yet resume+history works, so a
 * run row carrying workerSessionId unlocks the real transcript in the UI.
 * Join key is the dispatcher's title convention 'Work kanban task <id>'.
 * ATTACH inherits the connection's read-only flag — SELECTs only. */
export function listKanbanRuns(kanbanDbPath: string, stateDbPath: string) {
  const db = new DatabaseSync(kanbanDbPath, { readOnly: true });
  try {
    db.exec(`ATTACH DATABASE '${stateDbPath.replace(/'/g, "''")}' AS statedb`);
    const rows = db
      .prepare(
        `SELECT t.id, t.title, t.body, t.assignee, t.status, t.result,
                t.created_at, t.started_at, t.completed_at,
                s.id AS worker_session_id, s.message_count AS worker_message_count
         FROM tasks t
         LEFT JOIN statedb.sessions s
           ON s.source = 'kanban' AND s.title = 'Work kanban task ' || t.id
         WHERE t.assignee IS NOT NULL
         ORDER BY t.created_at DESC
         LIMIT 100`,
      )
      .all();
    return { runs: rows };
  } finally {
    db.close();
  }
}

/** Existence check for the playbooks/skills roots (mirrors the dev
 * middleware's statSync guard — missing root = empty index, not an error). */
export function rootExists(root: string): boolean {
  return statSync(root, { throwIfNoEntry: false }) !== undefined;
}

/* --------------------------------------------------------------- version */

export interface BuildVersion {
  version: string;
  gitSha: string;
  gitBranch: string;
  gitTag?: string;
  releaseChannel?: string;
  builtAt: string;
}

export interface UpdateLogEntry {
  id: number;
  startedAt: string;
  finishedAt?: string;
  oldGitSha?: string;
  newGitSha?: string;
  oldVersion?: string;
  newVersion?: string;
  success: boolean;
  errorMessage?: string;
}

/** Read the build-time version manifest generated by scripts/generate-version.mjs.
 * The manifest lives in dist/ for production and public/ during development. */
export function readBuildVersion(eaiosRoot: string): BuildVersion {
  const candidates = [
    join(eaiosRoot, 'app', 'dist', 'version.json'),
    join(eaiosRoot, 'app', 'public', 'version.json'),
  ];
  for (const path of candidates) {
    try {
      const parsed = JSON.parse(readFileSync(path, 'utf8')) as BuildVersion;
      if (parsed.version && parsed.gitSha && parsed.builtAt) return parsed;
    } catch {
      // try next candidate
    }
  }
  return { version: '0.0.0', gitSha: 'unknown', gitBranch: 'unknown', builtAt: new Date().toISOString() };
}

/** Tail of the eaios_update_log table from ~/.hermes/state.db. Missing or
 * locked DB returns an empty list, never a 500. */
export function readUpdateLog(dbPath: string, limit = 10): UpdateLogEntry[] {
  try {
    const db = new DatabaseSync(dbPath, { readOnly: true });
    try {
      // The table may not exist on very old boxes; the query will fail honestly.
      const rows = db
        .prepare(
          `SELECT id, started_at, finished_at, old_git_sha, new_git_sha, old_version, new_version, success, error_message
           FROM eaios_update_log
           ORDER BY started_at DESC, id DESC
           LIMIT ?`,
        )
        .all(limit) as {
        id: number;
        started_at: number;
        finished_at: number | null;
        old_git_sha: string | null;
        new_git_sha: string | null;
        old_version: string | null;
        new_version: string | null;
        success: number;
        error_message: string | null;
      }[];
      return rows.map((r) => ({
        id: r.id,
        startedAt: new Date(r.started_at * 1000).toISOString(),
        finishedAt: r.finished_at ? new Date(r.finished_at * 1000).toISOString() : undefined,
        oldGitSha: r.old_git_sha ?? undefined,
        newGitSha: r.new_git_sha ?? undefined,
        oldVersion: r.old_version ?? undefined,
        newVersion: r.new_version ?? undefined,
        success: Boolean(r.success),
        errorMessage: r.error_message ?? undefined,
      }));
    } finally {
      db.close();
    }
  } catch {
    return [];
  }
}
