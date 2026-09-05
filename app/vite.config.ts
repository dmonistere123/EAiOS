import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { readdirSync, readFileSync, statSync, writeFileSync, renameSync } from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'
import { homedir } from 'node:os'
import { DatabaseSync } from 'node:sqlite'
import { writePlaybook, writeSkill, updateSkillStatus, deleteSkill, updatePlaybookEnabled, deletePlaybook } from './server/authoring.ts'
import type { PlaybookInput, SkillInput } from './server/authoring.ts'
import { hasProfileEnvKey, setProfileEnvKey } from './server/profileEnv.ts'
import { handleApiRequest } from './server/httpApi.ts'

/** Shared index caches (30s) — write middlewares bust them on mutation. */
const indexCache: { skills?: { at: number; body: string }; playbooks?: { at: number; body: string } } = {}

type MwReq = { method?: string; on: (ev: string, cb: (chunk?: Buffer) => void) => void }
type MwRes = { statusCode: number; setHeader: (k: string, v: string) => void; end: (b: string) => void }
type MwServer = { middlewares: { use: (path: string, fn: (req: MwReq, res: MwRes) => void) => void } }

function readJsonBody(req: MwReq): Promise<Record<string, unknown>> {
  return new Promise((resolvePromise, reject) => {
    let body = ''
    req.on('data', (chunk) => { body += chunk })
    req.on('end', () => {
      try {
        resolvePromise(JSON.parse(body || '{}'))
      } catch (e) {
        reject(e)
      }
    })
  })
}

/**
 * Dev-only middleware: GET /api/skills-index → frontmatter metadata for every
 * SKILL.md under ~/.hermes/skills. The gateway's skills.manage RPC returns
 * only {category: [names]}; descriptions/versions live in skill frontmatter
 * and have no RPC surface, so the live adapter enriches from here. Runs
 * node-side like the proxies — never inlined into the client bundle.
 */
function skillsIndexMiddleware() {
  const root = join(process.env.HERMES_HOME ?? join(homedir(), '.hermes'), 'skills')

  const parseFrontmatter = (text: string) => {
    const m = text.match(/^---\n([\s\S]*?)\n---/)
    if (!m) return {}
    const pick = (key: string) => {
      const km = m[1].match(new RegExp(`^${key}:\\s*"?([^"\\n]+?)"?\\s*$`, 'm'))
      return km?.[1]
    }
    const status = pick('status')
    return { name: pick('name'), description: pick('description'), version: pick('version'), status: status === 'disabled' ? 'disabled' : 'enabled' }
  }

  const scan = () => {
    const skills: { name: string; category: string; description?: string; version?: string; status: 'enabled' | 'disabled' }[] = []
    const walk = (dir: string, depth: number) => {
      if (depth > 4) return
      let entries
      try {
        entries = readdirSync(dir, { withFileTypes: true })
      } catch {
        return
      }
      for (const e of entries) {
        const p = join(dir, e.name)
        if (e.isDirectory()) walk(p, depth + 1)
        else if (e.name === 'SKILL.md') {
          try {
            const fm = parseFrontmatter(readFileSync(p, 'utf8'))
            const name = fm.name
            if (!name) continue
            const category = relative(root, join(p, '..')).split(sep)[0] || 'general'
            skills.push({ name, category, description: fm.description, version: fm.version, status: fm.status as 'enabled' | 'disabled' })
          } catch {
            // unreadable skill file — skip, don't fail the index
          }
        }
      }
    }
    walk(root, 0)
    return skills
  }

  return {
    name: 'eaios-skills-index',
    configureServer(server: MwServer) {
      server.middlewares.use('/api/skills-index', (req, res) => {
        res.setHeader('content-type', 'application/json')
        if (req.method === 'PUT' || req.method === 'DELETE') {
          void readJsonBody(req)
            .then((body) => {
              try {
                const slug = String(body.slug ?? '')
                const category = String(body.category ?? '')
                if (req.method === 'PUT') {
                  const status = String(body.status ?? '')
                  if (status !== 'enabled' && status !== 'disabled') throw new Error('status must be enabled or disabled')
                  updateSkillStatus(root, category, slug, status as 'enabled' | 'disabled')
                } else {
                  deleteSkill(root, category, slug)
                }
                indexCache.skills = undefined
                res.statusCode = 200
                res.end(JSON.stringify({ ok: true }))
              } catch (e) {
                res.statusCode = 400
                res.end(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }))
              }
            })
            .catch((e) => {
              res.statusCode = 400
              res.end(JSON.stringify({ error: `bad JSON: ${e instanceof Error ? e.message : String(e)}` }))
            })
          return
        }
        try {
          if (!indexCache.skills || Date.now() - indexCache.skills.at > 30_000) {
            indexCache.skills = { at: Date.now(), body: JSON.stringify({ skills: statSync(root, { throwIfNoEntry: false }) ? scan() : [] }) }
          }
          res.statusCode = 200
          res.end(indexCache.skills.body)
        } catch (e) {
          res.statusCode = 500
          res.end(JSON.stringify({ error: String(e) }))
        }
      })
    },
  }
}

/**
 * Dev-only middleware: GET /api/playbooks-index → parsed frontmatter + body
 * for every playbook markdown in ~/eaios/playbooks. Playbooks are versioned
 * workflows on disk (Phase 5.4); running them goes through the gateway
 * (kanban create/swarm), discovery rides the dev server like skills-index.
 */
function playbooksIndexMiddleware() {
  const root = join(__dirname, '..', 'playbooks')

  const pick = (fm: string, key: string) => {
    const km = fm.match(new RegExp(`^${key}:\\s*(.+?)\\s*$`, 'm'))
    return km?.[1]
  }
  const pickScalar = (fm: string, key: string) => {
    const v = pick(fm, key)
    return v ? v.replace(/^"(.*)"$/, '$1') : undefined
  }
  const pickList = (fm: string, key: string): string[] => {
    const v = pick(fm, key)
    if (!v) return []
    const m = v.match(/^\[(.*)\]$/)
    return (m ? m[1] : v).split(',').map((s) => s.trim()).filter(Boolean)
  }

  const scan = () => {
    const playbooks: Record<string, unknown>[] = []
    let files: string[] = []
    try {
      files = readdirSync(root).filter((f) => f.endsWith('.md'))
    } catch {
      return playbooks
    }
    for (const f of files) {
      try {
        const text = readFileSync(join(root, f), 'utf8')
        const m = text.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/)
        if (!m) continue
        const [, fm, body] = m
        playbooks.push({
          id: f.replace(/\.md$/, ''),
          name: pickScalar(fm, 'name') ?? f.replace(/\.md$/, ''),
          description: pickScalar(fm, 'description') ?? '',
          version: pickScalar(fm, 'version') ?? '0.0.0',
          status: pickScalar(fm, 'status') === 'published' ? 'published' : 'draft',
          enabled: pickScalar(fm, 'enabled') !== 'false',
          mode: pickScalar(fm, 'mode') === 'swarm' ? 'swarm' : 'task',
          assignee: pickScalar(fm, 'assignee'),
          ownerAgentId: pickScalar(fm, 'owner'),
          skills: pickList(fm, 'skills'),
          workers: pickList(fm, 'workers'),
          verifier: pickScalar(fm, 'verifier'),
          synthesizer: pickScalar(fm, 'synthesizer'),
          body: body.trim(),
        })
      } catch {
        // unreadable playbook — skip, don't fail the index
      }
    }
    return playbooks
  }

  return {
    name: 'eaios-playbooks-index',
    configureServer(server: MwServer) {
      server.middlewares.use('/api/playbooks-index', (req, res) => {
        res.setHeader('content-type', 'application/json')
        // W7: PUT = create/edit a playbook (confined write; server-side
        // version bump; editing a published playbook lands as a new draft).
        if (req.method === 'PUT') {
          void readJsonBody(req)
            .then((body) => {
              try {
                if (body.enabled !== undefined && !body.body && !body.name) {
                  const slug = String(body.id ?? '')
                  if (!slug) throw new Error('id is required')
                  updatePlaybookEnabled(root, slug, Boolean(body.enabled))
                  indexCache.playbooks = undefined
                  res.statusCode = 200
                  res.end(JSON.stringify({ ok: true }))
                  return
                }
                const saved = writePlaybook(root, body as unknown as PlaybookInput)
                indexCache.playbooks = undefined // bust — the next GET re-scans
                const playbook = scan().find((p) => p.id === saved.id)
                res.statusCode = saved.created ? 201 : 200
                res.end(JSON.stringify({ playbook: { ...(playbook ?? {}), id: saved.id, version: saved.version, status: saved.status } }))
              } catch (e) {
                res.statusCode = 400
                res.end(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }))
              }
            })
            .catch((e) => {
              res.statusCode = 400
              res.end(JSON.stringify({ error: `bad JSON: ${e instanceof Error ? e.message : String(e)}` }))
            })
          return
        }
        if (req.method === 'DELETE') {
          void readJsonBody(req)
            .then((body) => {
              try {
                const slug = String(body.id ?? '')
                if (!slug) throw new Error('id is required')
                deletePlaybook(root, slug)
                indexCache.playbooks = undefined
                res.statusCode = 200
                res.end(JSON.stringify({ ok: true }))
              } catch (e) {
                res.statusCode = 400
                res.end(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }))
              }
            })
            .catch((e) => {
              res.statusCode = 400
              res.end(JSON.stringify({ error: `bad JSON: ${e instanceof Error ? e.message : String(e)}` }))
            })
          return
        }
        try {
          if (!indexCache.playbooks || Date.now() - indexCache.playbooks.at > 30_000) {
            indexCache.playbooks = { at: Date.now(), body: JSON.stringify({ playbooks: statSync(root, { throwIfNoEntry: false }) ? scan() : [] }) }
          }
          res.statusCode = 200
          res.end(indexCache.playbooks.body)
        } catch (e) {
          res.statusCode = 500
          res.end(JSON.stringify({ error: String(e) }))
        }
      })
    },
  }
}

/**
 * Dev-only middleware: POST /api/skill-create (W7) — writes a user-local
 * SKILL.md under ~/.hermes/skills/<category>/<slug>/. Slug + category
 * validated, path confined by the authoring store, overwrite refused
 * (create-only; editing is a later workstream). The new skill surfaces via
 * the existing skills.manage RPC list; frontmatter enrichment rides the
 * (busted) skills-index cache.
 */
function skillCreateMiddleware() {
  const root = join(process.env.HERMES_HOME ?? join(homedir(), '.hermes'), 'skills')
  return {
    name: 'eaios-skill-create',
    configureServer(server: MwServer) {
      server.middlewares.use('/api/skill-create', (req, res) => {
        res.setHeader('content-type', 'application/json')
        if (req.method !== 'POST') {
          res.statusCode = 405
          res.end(JSON.stringify({ error: 'POST only' }))
          return
        }
        void readJsonBody(req)
          .then((body) => {
            try {
              const saved = writeSkill(root, body as unknown as SkillInput)
              indexCache.skills = undefined // bust — the next GET re-walks
              res.statusCode = 201
              res.end(JSON.stringify({ name: saved.name, category: saved.category }))
            } catch (e) {
              const code = (e as { code?: string }).code === 'already_exists' ? 409 : 400
              res.statusCode = code
              res.end(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }))
            }
          })
          .catch((e) => {
            res.statusCode = 400
            res.end(JSON.stringify({ error: `bad JSON: ${e instanceof Error ? e.message : String(e)}` }))
          })
      })
    },
  }
}

/**
 * Dev-only middleware: GET/POST /api/profile-env (dogfood 2026-08-29) —
 * per-profile Telegram bot binding. GET returns key EXISTENCE only (never
 * values); POST writes one allowlisted key into profiles/<slug>/.env via
 * server/profileEnv.ts (confinement + chmod 600 + no readback). The token
 * transits a loopback POST body only — never DOM persistence, URLs, logs,
 * or git (spec §2/§15 secrets rules preserved).
 */
function profileEnvMiddleware() {
  const profilesRoot = join(process.env.HERMES_HOME ?? join(homedir(), '.hermes'), 'profiles')
  return {
    name: 'eaios-profile-env',
    configureServer(server: MwServer) {
      server.middlewares.use('/api/profile-env', (req, res) => {
        res.setHeader('content-type', 'application/json')
        if (req.method === 'GET') {
          try {
            const url = new URL((req as unknown as { url?: string }).url ?? '', 'http://localhost')
            const profile = url.searchParams.get('profile') ?? ''
            const key = url.searchParams.get('key') ?? ''
            res.statusCode = 200
            res.end(JSON.stringify({ present: hasProfileEnvKey(profilesRoot, profile, key) }))
          } catch (e) {
            res.statusCode = 400
            res.end(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }))
          }
          return
        }
        if (req.method === 'POST') {
          void readJsonBody(req)
            .then((body) => {
              try {
                setProfileEnvKey(profilesRoot, String(body.profile ?? ''), String(body.key ?? ''), String(body.value ?? ''))
                res.statusCode = 200
                res.end(JSON.stringify({ ok: true })) // never echoes the value
              } catch (e) {
                res.statusCode = 400
                res.end(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }))
              }
            })
            .catch((e) => {
              res.statusCode = 400
              res.end(JSON.stringify({ error: `bad JSON: ${e instanceof Error ? e.message : String(e)}` }))
            })
          return
        }
        res.statusCode = 405
        res.end(JSON.stringify({ error: 'GET or POST only' }))
      })
    },
  }
}

/**
 * Dev-only middleware: GET /api/usage?from=<iso>&to=<iso> → token/cost
 * aggregates from Hermes' state.db `session_model_usage` (Phase 6.1).
 * The gateway's insights.get RPC returns only {days, sessions, messages} —
 * no token/cost data — and the CLI has no --json, so the live adapter reads
 * the authoritative store directly. node:sqlite is built into Node ≥24
 * (zero new deps); the DB is opened READ-ONLY and every query is a SELECT.
 * Costs stay exactly as Hermes recorded them (estimated vs actual columns +
 * cost_status) — the adapter labels, never invents (D7). DB missing/locked/
 * error → 503 → adapter falls back to mock (graceful degradation, spec §2).
 */
function usageMiddleware() {
  const dbPath = join(process.env.HERMES_HOME ?? join(homedir(), '.hermes'), 'state.db')
  let cache: { key: string; at: number; body: string } | undefined

  const query = (fromIso: string, toIso: string) => {
    const from = Date.parse(fromIso) / 1000
    const to = Date.parse(toIso) / 1000
    if (!Number.isFinite(from) || !Number.isFinite(to)) throw new Error('bad range')
    const db = new DatabaseSync(dbPath, { readOnly: true })
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
        agent: string
        input_tokens: number | null
        output_tokens: number | null
        estimated_cost_usd: number | null
        actual_cost_usd: number | null
        last_seen: number | null
      }[]
      const byAgent = rows.map((r) => ({
        agentId: r.agent,
        inputTokens: r.input_tokens ?? 0,
        outputTokens: r.output_tokens ?? 0,
        estimatedCostUsd: r.estimated_cost_usd ?? 0,
        actualCostUsd: r.actual_cost_usd ?? 0,
      }))
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
      }
    } finally {
      db.close()
    }
  }

  return {
    name: 'eaios-usage',
    configureServer(server: { middlewares: { use: (path: string, fn: (req: { url?: string }, res: { statusCode: number; setHeader: (k: string, v: string) => void; end: (b: string) => void }) => void) => void } }) {
      server.middlewares.use('/api/usage', (req, res, next?: () => void) => {
        // /api/usage/daily rides the SHARED router (httpApi, like /api/kanban)
        // — the inline aggregate below must not consume it (F22 interim).
        if ((req.url ?? '').startsWith('/daily')) {
          next?.()
          return
        }
        try {
          const url = new URL(req.url ?? '', 'http://localhost')
          const now = new Date()
          const from = url.searchParams.get('from') ?? new Date(now.getFullYear(), now.getMonth(), 1).toISOString()
          const to = url.searchParams.get('to') ?? now.toISOString()
          const key = `${from}|${to}`
          if (!cache || cache.key !== key || Date.now() - cache.at > 30_000) {
            cache = { key, at: Date.now(), body: JSON.stringify(query(from, to)) }
          }
          res.statusCode = 200
          res.setHeader('content-type', 'application/json')
          res.end(cache.body)
        } catch (e) {
          res.statusCode = 503
          res.end(JSON.stringify({ error: String(e) }))
        }
      })
    },
  }
}

/**
 * Dev-only middleware: GET/PUT /api/eaios-settings — EAiOS-owned settings
 * (Phase 6.2, F15 usage budget). The gateway has no generic config-write
 * RPC, and these are EAiOS concerns (not Hermes'), so they live in
 * ~/eaios/settings.local.json (gitignored). Server-side key allowlist —
 * arbitrary keys are rejected, never written. Writes are atomic
 * (tmp + rename). No secrets: do NOT allowlist anything credential-shaped.
 */
function eaiosSettingsMiddleware() {
  const file = join(__dirname, '..', 'settings.local.json')
  const ALLOWED = new Set(['usageBudgetUsd', 'dailySpendAlertUsd'])

  const readAll = (): Record<string, unknown> => {
    try {
      const parsed = JSON.parse(readFileSync(file, 'utf8'))
      return parsed && typeof parsed === 'object' ? parsed : {}
    } catch {
      return {} // missing/corrupt file = empty settings, never a 500
    }
  }

  return {
    name: 'eaios-settings',
    configureServer(server: { middlewares: { use: (path: string, fn: (req: { method?: string; on: (ev: string, cb: (chunk?: Buffer) => void) => void }, res: { statusCode: number; setHeader: (k: string, v: string) => void; end: (b: string) => void }) => void) => void } }) {
      server.middlewares.use('/api/eaios-settings', (req, res) => {
        res.setHeader('content-type', 'application/json')
        if (req.method === 'PUT') {
          let body = ''
          req.on('data', (chunk) => { body += chunk })
          req.on('end', () => {
            try {
              const patch = JSON.parse(body || '{}')
              const keys = Object.keys(patch)
              if (!keys.length || keys.some((k) => !ALLOWED.has(k))) {
                res.statusCode = 400
                res.end(JSON.stringify({ error: `keys must be within: ${[...ALLOWED].join(', ')}` }))
                return
              }
              if (patch.usageBudgetUsd !== null && (typeof patch.usageBudgetUsd !== 'number' || !(patch.usageBudgetUsd > 0))) {
                res.statusCode = 400
                res.end(JSON.stringify({ error: 'usageBudgetUsd must be a positive number or null' }))
                return
              }
              if (patch.dailySpendAlertUsd !== null && (typeof patch.dailySpendAlertUsd !== 'number' || !(patch.dailySpendAlertUsd > 0))) {
                res.statusCode = 400
                res.end(JSON.stringify({ error: 'dailySpendAlertUsd must be a positive number or null' }))
                return
              }
              const next = readAll()
              for (const k of keys) {
                if (patch[k] === null) delete next[k]
                else next[k] = patch[k]
              }
              const tmp = `${file}.tmp`
              writeFileSync(tmp, JSON.stringify(next, null, 2))
              renameSync(tmp, file)
              res.statusCode = 200
              res.end(JSON.stringify(next))
            } catch (e) {
              res.statusCode = 500
              res.end(JSON.stringify({ error: String(e) }))
            }
          })
          return
        }
        res.statusCode = 200
        res.end(JSON.stringify(readAll()))
      })
    },
  }
}

/**
 * Dev-only middleware: /api/artifacts — agent-created outputs backed by
 * kanban task_attachments (Phase 6.3, spec §8.9). Agents already attach
 * deliverables on task completion (kanban_complete), so kanban.db is the
 * honest provenance source: attachment → task (assignee, title, status).
 * node:sqlite READ-ONLY like /api/usage. /api/artifacts/<id>/raw streams
 * the file with ROOT CONFINEMENT — the DB's stored_path is data, not
 * authority; anything resolving outside the attachments root is rejected.
 * ?download=1 adds content-disposition. Errors → 503 → mock fallback.
 */
function artifactsMiddleware() {
  const home = process.env.HERMES_HOME ?? join(homedir(), '.hermes')
  const dbPath = join(home, 'kanban.db')
  const attachRoot = join(home, 'kanban', 'attachments')
  let cache: { at: number; body: string } | undefined

  const MIME: Record<string, string> = { '.md': 'text/markdown', '.txt': 'text/plain', '.json': 'application/json', '.csv': 'text/csv', '.html': 'text/html', '.pdf': 'application/pdf' }
  const guessMime = (name: string) => MIME[name.slice(name.lastIndexOf('.')).toLowerCase()] ?? 'application/octet-stream'

  const list = () => {
    const db = new DatabaseSync(dbPath, { readOnly: true })
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
        id: number; task_id: string; filename: string; stored_path: string
        content_type: string | null; size: number; uploaded_by: string | null; created_at: number
        task_title: string | null; task_assignee: string | null; task_status: string | null
      }[]
      return {
        artifacts: rows.map((r) => {
          const mimeType = r.content_type ?? guessMime(r.filename)
          // Text-ish attachments are readable in-app (dogfood 2026-08-29:
          // the deliverable must be RECEIVABLE in EAiOS, not just Telegram).
          const previewable = mimeType.startsWith('text/') || mimeType === 'application/json'
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
          }
        }),
      }
    } finally {
      db.close()
    }
  }

  const rawFor = (idParam: string) => {
    const rowId = Number(idParam.replace(/^att-/, ''))
    if (!Number.isInteger(rowId)) throw new Error('bad id')
    const db = new DatabaseSync(dbPath, { readOnly: true })
    try {
      const r = db.prepare('SELECT filename, stored_path, content_type FROM task_attachments WHERE id = ?').get(rowId) as
        | { filename: string; stored_path: string; content_type: string | null }
        | undefined
      if (!r) return undefined
      // Confinement: resolved path must stay inside the attachments root.
      const resolved = resolve(r.stored_path)
      if (!resolved.startsWith(resolve(attachRoot) + sep)) throw new Error('path escapes attachments root')
      return { filename: r.filename, path: resolved, mime: r.content_type ?? guessMime(r.filename) }
    } finally {
      db.close()
    }
  }

  return {
    name: 'eaios-artifacts',
    configureServer(server: { middlewares: { use: (path: string, fn: (req: { url?: string }, res: { statusCode: number; setHeader: (k: string, v: string) => void; end: (b: string | Buffer) => void }) => void) => void } }) {
      server.middlewares.use('/api/artifacts', (req, res) => {
        try {
          const url = new URL(req.url ?? '', 'http://localhost')
          const rawMatch = url.pathname.match(/^\/(?:att-)?(\d+)\/raw$/)
          if (rawMatch) {
            const rec = rawFor(rawMatch[1])
            if (!rec) {
              res.statusCode = 404
              res.end(JSON.stringify({ error: 'not found' }))
              return
            }
            res.statusCode = 200
            res.setHeader('content-type', rec.mime)
            res.setHeader('x-content-type-options', 'nosniff')
            if (url.searchParams.get('download') === '1') {
              res.setHeader('content-disposition', `attachment; filename="${rec.filename.replace(/"/g, '')}"`)
            }
            res.end(readFileSync(rec.path))
            return
          }
          if (!cache || Date.now() - cache.at > 30_000) {
            cache = { at: Date.now(), body: JSON.stringify(list()) }
          }
          res.statusCode = 200
          res.setHeader('content-type', 'application/json')
          res.end(cache.body)
        } catch (e) {
          res.statusCode = 503
          res.end(JSON.stringify({ error: String(e) }))
        }
      })
    },
  }
}

/**
 * Dev delegate for the truncation-proof kanban board read (dogfood
 * 2026-08-29: cli.exec caps output at 48000 chars — past that the work slice
 * silently fell back to mock). The shared router (server/httpApi.ts) owns
 * the endpoint; prod serves it too. F22 consolidates the rest of these
 * middlewares the same way pre-flip.
 */
function kanbanDelegateMiddleware() {
  return {
    name: 'eaios-kanban-delegate',
    configureServer(server: { middlewares: { use: (fn: (req: { url?: string }, res: unknown, next: () => void) => void) => void } }) {
      // Mounted WITHOUT a path: connect strips mount prefixes from req.url,
      // so the shared router must see the full /api/kanban path itself.
      server.middlewares.use((req, res, next) => {
        const url = req.url ?? ''
        if (!url.startsWith('/api/kanban') && !url.startsWith('/api/usage/daily') && !url.startsWith('/api/travel')) {
          next()
          return
        }
        void handleApiRequest(req as never, res as never, {
          hermesHome: process.env.HERMES_HOME ?? join(homedir(), '.hermes'),
          eaiosRoot: join(__dirname, '..'),
        })
      })
    },
  }
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  // Node-side env (NOT inlined into the client bundle — safe for secrets).
  const env = loadEnv(mode, __dirname, '')
  const composioKey = env.COMPOSIO_API_KEY ?? ''
  const hermesToken = env.VITE_HERMES_TOKEN ?? ''

  return {
    plugins: [react(), tailwindcss(), skillsIndexMiddleware(), playbooksIndexMiddleware(), skillCreateMiddleware(), profileEnvMiddleware(), usageMiddleware(), eaiosSettingsMiddleware(), artifactsMiddleware(), kanbanDelegateMiddleware()],
    server: {
      // Allow access via the Tailscale serve URL (tailscale serve --bg 5173).
      allowedHosts: ['ally-landry-ser9.tailf41e2c.ts.net'],
      proxy: {
        // Dev: forward the gateway socket to the local hermes serve instance.
        '/api/ws': {
          target: 'ws://127.0.0.1:9119',
          ws: true,
          changeOrigin: true,
          // Tailscale Serve is a public-origin reverse proxy: the browser sends
          // Origin: https://ally-landry-ser9... and Serve can drop the WS query
          // string. hermes serve only accepts loopback origins + ?token=..., so
          // re-stamp both at the local edge before the upgrade reaches 9119.
          configure: (proxy) => {
            proxy.on('proxyReqWs', (proxyReq) => {
              proxyReq.removeHeader('origin')
              if (hermesToken && !/[?&]token=/.test(proxyReq.path)) {
                proxyReq.path = `${proxyReq.path}${proxyReq.path.includes('?') ? '&' : '?'}token=${encodeURIComponent(hermesToken)}`
              }
            })
          },
        },
        // Dev: Composio REST with the API key injected server-side — the
        // browser bundle never carries the key (spec: no secrets in client).
        '/composio-api': {
          // NOTE: docs say api.composio.dev but that host is NXDOMAIN (Aug 2026);
          // the working v3 host is backend.composio.dev.
          target: 'https://backend.composio.dev',
          changeOrigin: true,
          secure: true,
          rewrite: (p) => p.replace(/^\/composio-api/, ''),
          headers: composioKey ? { 'x-api-key': composioKey } : {},
        },
        // Dev: knowledge sidecar (Python, loopback) — browser stays same-origin.
        '/knowledge-api': {
          target: 'http://127.0.0.1:9121',
          changeOrigin: true,
          rewrite: (p) => p.replace(/^\/knowledge-api/, ''),
        },
      },
    },
  }
})
