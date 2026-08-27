import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { readdirSync, readFileSync, statSync, writeFileSync, renameSync } from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'
import { homedir } from 'node:os'
import { DatabaseSync } from 'node:sqlite'

/**
 * Dev-only middleware: GET /api/skills-index → frontmatter metadata for every
 * SKILL.md under ~/.hermes/skills. The gateway's skills.manage RPC returns
 * only {category: [names]}; descriptions/versions live in skill frontmatter
 * and have no RPC surface, so the live adapter enriches from here. Runs
 * node-side like the proxies — never inlined into the client bundle.
 */
function skillsIndexMiddleware() {
  const root = join(process.env.HERMES_HOME ?? join(homedir(), '.hermes'), 'skills')
  let cache: { at: number; body: string } | undefined

  const parseFrontmatter = (text: string) => {
    const m = text.match(/^---\n([\s\S]*?)\n---/)
    if (!m) return {}
    const pick = (key: string) => {
      const km = m[1].match(new RegExp(`^${key}:\\s*"?([^"\\n]+?)"?\\s*$`, 'm'))
      return km?.[1]
    }
    return { name: pick('name'), description: pick('description'), version: pick('version') }
  }

  const scan = () => {
    const skills: { name: string; category: string; description?: string; version?: string }[] = []
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
            skills.push({ name, category, description: fm.description, version: fm.version })
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
    configureServer(server: { middlewares: { use: (path: string, fn: (req: unknown, res: { statusCode: number; setHeader: (k: string, v: string) => void; end: (b: string) => void }) => void) => void } }) {
      server.middlewares.use('/api/skills-index', (_req, res) => {
        try {
          if (!cache || Date.now() - cache.at > 30_000) {
            cache = { at: Date.now(), body: JSON.stringify({ skills: statSync(root, { throwIfNoEntry: false }) ? scan() : [] }) }
          }
          res.statusCode = 200
          res.setHeader('content-type', 'application/json')
          res.end(cache.body)
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
  let cache: { at: number; body: string } | undefined

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
    configureServer(server: { middlewares: { use: (path: string, fn: (req: unknown, res: { statusCode: number; setHeader: (k: string, v: string) => void; end: (b: string) => void }) => void) => void } }) {
      server.middlewares.use('/api/playbooks-index', (_req, res) => {
        try {
          if (!cache || Date.now() - cache.at > 30_000) {
            cache = { at: Date.now(), body: JSON.stringify({ playbooks: statSync(root, { throwIfNoEntry: false }) ? scan() : [] }) }
          }
          res.statusCode = 200
          res.setHeader('content-type', 'application/json')
          res.end(cache.body)
        } catch (e) {
          res.statusCode = 500
          res.end(JSON.stringify({ error: String(e) }))
        }
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
      server.middlewares.use('/api/usage', (req, res) => {
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
  const ALLOWED = new Set(['usageBudgetUsd'])

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
        artifacts: rows.map((r) => ({
          id: `att-${r.id}`,
          taskId: r.task_id,
          taskTitle: r.task_title,
          name: r.filename,
          mimeType: r.content_type ?? guessMime(r.filename),
          sizeBytes: r.size,
          uploadedBy: r.uploaded_by,
          agentId: r.task_assignee ?? r.uploaded_by ?? 'default',
          taskStatus: r.task_status,
          createdAt: new Date(r.created_at * 1000).toISOString(),
        })),
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

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  // Node-side env (NOT inlined into the client bundle — safe for secrets).
  const env = loadEnv(mode, __dirname, '')
  const composioKey = env.COMPOSIO_API_KEY ?? ''

  return {
    plugins: [react(), tailwindcss(), skillsIndexMiddleware(), playbooksIndexMiddleware(), usageMiddleware(), eaiosSettingsMiddleware(), artifactsMiddleware()],
    server: {
      // Allow access via the Tailscale serve URL (tailscale serve --bg 5173).
      allowedHosts: ['ally-landry-ser9.tailf41e2c.ts.net'],
      proxy: {
        // Dev: forward the gateway socket to the local hermes serve instance.
        '/api/ws': { target: 'ws://127.0.0.1:9119', ws: true, changeOrigin: true },
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
