import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { homedir } from 'node:os'

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

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  // Node-side env (NOT inlined into the client bundle — safe for secrets).
  const env = loadEnv(mode, __dirname, '')
  const composioKey = env.COMPOSIO_API_KEY ?? ''

  return {
    plugins: [react(), tailwindcss(), skillsIndexMiddleware()],
    server: {
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
      },
    },
  }
})
