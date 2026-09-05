/// <reference types="node" />
/**
 * EAiOS production server (Phase 8.1, closes F10) — ONE zero-dependency
 * Node process replacing every vite dev middleware:
 *
 *   - static serving of app/dist with SPA fallback (React Router)
 *   - all /api/* endpoints via server/httpApi.ts (shared core)
 *   - /api/ws        → WebSocket tunnel to hermes serve (token re-stamped
 *                      server-side, Origin stripped — same re-stamp rules
 *                      as the vite proxy, see vite.config.ts comments)
 *   - /knowledge-api → HTTP proxy to the Python knowledge sidecar
 *   - /composio-api  → HTTPS proxy to backend.composio.dev with the API key
 *                      injected server-side (never in the client bundle)
 *
 * Requires Node ≥24 (node:sqlite in the API core; type stripping to run
 * this file directly). Configuration is ALL env vars — no config file, no
 * secrets on argv:
 *
 *   EAIOS_PORT            listen port            (default 5200)
 *   EAIOS_HOST            listen host            (default 127.0.0.1)
 *   EAIOS_DIST            dist dir               (default <app>/dist)
 *   EAIOS_ROOT            EAiOS root dir         (default parent of app/)
 *   HERMES_HOME           Hermes home            (default ~/.hermes)
 *   EAIOS_HERMES_WS       hermes serve base      (default 127.0.0.1:9119)
 *   EAIOS_HERMES_TOKEN    WS token (prefer the file variant)
 *   EAIOS_HERMES_TOKEN_FILE  file containing the WS token
 *                            (default ~/.hermes/.eaios-dev-token)
 *   EAIOS_KNOWLEDGE_URL   sidecar base           (default http://127.0.0.1:9121)
 *   COMPOSIO_API_KEY      Composio key (optional; proxied calls 401 without)
 *
 * Run: node server/prod.ts        (or: npm start)
 */
import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { connect } from 'node:net';
import { createReadStream, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { handleApiRequest } from './httpApi.ts';
import type { ApiContext } from './httpApi.ts';

const APP_DIR = dirname(fileURLToPath(import.meta.url)); // <eaios>/app/server
const APP_ROOT = resolve(APP_DIR, '..');

/** Load `app/.env.local` into `process.env` without overriding existing vars.
 * Vite dev does this automatically; the prod server must do it itself so
 * server-side env vars like DUFFEL_API_KEY are available to `server/travel.ts`.
 */
function loadAppEnvLocal(): void {
  try {
    const text = readFileSync(join(APP_ROOT, '.env.local'), 'utf8');
    for (const line of text.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      let value = trimmed.slice(eq + 1).trim();
      // Strip optional surrounding quotes
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      if (key && process.env[key] === undefined) {
        process.env[key] = value;
      }
    }
  } catch {
    // no .env.local — continue with existing environment
  }
}

export interface ProdConfig {
  port: number;
  host: string;
  distDir: string;
  apiCtx: ApiContext;
  hermesWsHost: string;
  hermesWsPort: number;
  hermesToken: string;
  knowledgeUrl: string;
  composioKey: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ProdConfig {
  loadAppEnvLocal();
  const hermesHome = env.HERMES_HOME ?? join(homedir(), '.hermes');
  let token = env.EAIOS_HERMES_TOKEN ?? '';
  if (!token) {
    try {
      token = readFileSync(env.EAIOS_HERMES_TOKEN_FILE ?? join(hermesHome, '.eaios-dev-token'), 'utf8').trim();
    } catch {
      // no token file — WS proxy will forward unauthenticated (hermes serve
      // will reject; the app's live adapter then degrades to mock, honestly)
    }
  }
  const wsBase = env.EAIOS_HERMES_WS ?? '127.0.0.1:9119';
  const [wsHost, wsPortRaw] = wsBase.replace(/^https?:\/\//, '').split(':');
  // Composio key: env first, then the same .env.local vite reads (chmod 600,
  // node-side only — the key never enters the client bundle either way).
  let composioKey = env.COMPOSIO_API_KEY ?? '';
  if (!composioKey) {
    try {
      const dotenv = readFileSync(join(APP_ROOT, '.env.local'), 'utf8');
      composioKey = dotenv.match(/^COMPOSIO_API_KEY=(.+)$/m)?.[1]?.trim() ?? '';
    } catch {
      // no .env.local — proxied Composio calls will 401 honestly
    }
  }
  return {
    port: Number(env.EAIOS_PORT ?? 5200),
    host: env.EAIOS_HOST ?? '127.0.0.1',
    distDir: env.EAIOS_DIST ?? join(APP_ROOT, 'dist'),
    apiCtx: { hermesHome, eaiosRoot: env.EAIOS_ROOT ?? resolve(APP_ROOT, '..') },
    hermesWsHost: wsHost || '127.0.0.1',
    hermesWsPort: Number(wsPortRaw ?? 9119),
    hermesToken: token,
    knowledgeUrl: env.EAIOS_KNOWLEDGE_URL ?? 'http://127.0.0.1:9121',
    composioKey,
  };
}

/* --------------------------------------------------------------- static */

const STATIC_MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json',
  '.webmanifest': 'application/manifest+json',
};

function serveStatic(distDir: string, req: IncomingMessage, res: ServerResponse): void {
  const url = new URL(req.url ?? '/', 'http://localhost');
  let pathname = decodeURIComponent(url.pathname);
  if (pathname.endsWith('/')) pathname += 'index.html';

  // Confinement: resolved path must stay inside dist.
  const root = resolve(distDir);
  let file = resolve(join(root, normalize(pathname).replace(/^([/\\])+/, '')));
  if (!file.startsWith(root + sep) && file !== root) {
    res.statusCode = 403;
    res.end('forbidden');
    return;
  }
  // SPA fallback: unknown non-file paths serve index.html (React Router).
  const st = statSync(file, { throwIfNoEntry: false });
  if (!st?.isFile()) {
    file = join(root, 'index.html');
    if (!statSync(file, { throwIfNoEntry: false })?.isFile()) {
      res.statusCode = 503;
      res.end('app not built — run `npm run build` first');
      return;
    }
  }
  const ext = file.slice(file.lastIndexOf('.')).toLowerCase();
  res.statusCode = 200;
  res.setHeader('content-type', STATIC_MIME[ext] ?? 'application/octet-stream');
  // Vite hashes asset filenames — immutable forever; index.html never caches.
  res.setHeader('cache-control', file.includes(`${sep}assets${sep}`) ? 'public, max-age=31536000, immutable' : 'no-cache');
  createReadStream(file).pipe(res);
}

/* --------------------------------------------------------------- proxies */

/** Hop-by-hop headers that must never be forwarded. */
const DROP_REQ_HEADERS = new Set(['host', 'connection', 'content-length', 'origin', 'keep-alive', 'transfer-encoding', 'upgrade']);
const DROP_RES_HEADERS = new Set(['connection', 'keep-alive', 'transfer-encoding', 'content-encoding', 'content-length']);

async function proxyHttp(req: IncomingMessage, res: ServerResponse, targetBase: string, stripPrefix: string, extraHeaders: Record<string, string>): Promise<void> {
  try {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const target = targetBase + url.pathname.replace(new RegExp(`^${stripPrefix}`), '') + url.search;
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries(req.headers)) {
      if (!DROP_REQ_HEADERS.has(k.toLowerCase()) && typeof v === 'string') headers[k] = v;
    }
    Object.assign(headers, extraHeaders);
    let body: Uint8Array<ArrayBuffer> | undefined;
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk as Buffer);
      const buf = Buffer.concat(chunks);
      body = new Uint8Array(buf.buffer as ArrayBuffer, buf.byteOffset, buf.byteLength);
    }
    const upstream = await fetch(target, { method: req.method, headers, body, redirect: 'manual' });
    res.statusCode = upstream.status;
    upstream.headers.forEach((v, k) => {
      if (!DROP_RES_HEADERS.has(k.toLowerCase())) res.setHeader(k, v);
    });
    res.end(Buffer.from(await upstream.arrayBuffer()));
  } catch (e) {
    res.statusCode = 502;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ error: `proxy upstream failed: ${e instanceof Error ? e.message : String(e)}` }));
  }
}

/* ------------------------------------------------------------ server */

export function createEaiosServer(config: ProdConfig) {
  const server = createServer((req, res) => {
    void (async () => {
      const path = new URL(req.url ?? '/', 'http://localhost').pathname;
      if (path.startsWith('/api/')) {
        if (path === '/api/ws') {
          // WS endpoint over plain HTTP — the upgrade handler owns this path.
          res.statusCode = 426;
          res.end('websocket endpoint — connect with a WS client');
          return;
        }
        if (await handleApiRequest(req, res, config.apiCtx)) return;
        res.statusCode = 404;
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ error: 'unknown api endpoint' }));
        return;
      }
      if (path.startsWith('/composio-api')) {
        await proxyHttp(req, res, 'https://backend.composio.dev', '/composio-api', config.composioKey ? { 'x-api-key': config.composioKey } : {});
        return;
      }
      if (path.startsWith('/knowledge-api')) {
        await proxyHttp(req, res, config.knowledgeUrl, '/knowledge-api', {});
        return;
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.statusCode = 405;
        res.end('method not allowed');
        return;
      }
      serveStatic(config.distDir, req, res);
    })().catch((e) => {
      if (!res.headersSent) {
        res.statusCode = 500;
        res.end(String(e));
      } else {
        res.end();
      }
    });
  });

  // WebSocket tunnel: /api/ws → hermes serve. Raw TCP after upgrade; the
  // token is re-stamped and Origin stripped at the local edge (tailscale
  // serve drops the query string / sends a public origin — see vite.config).
  server.on('upgrade', (req, socket, head) => {
    if (!req.url?.startsWith('/api/ws')) {
      socket.destroy();
      return;
    }
    const upstream = connect(config.hermesWsPort, config.hermesWsHost, () => {
      let path = req.url ?? '/api/ws';
      if (config.hermesToken && !/[?&]token=/.test(path)) {
        path += `${path.includes('?') ? '&' : '?'}token=${encodeURIComponent(config.hermesToken)}`;
      }
      const lines = [`${req.method} ${path} HTTP/1.1`];
      for (const [k, v] of Object.entries(req.headers)) {
        const key = k.toLowerCase();
        if (key === 'origin') continue; // hermes serve accepts loopback origins only
        if (key === 'host') {
          lines.push(`host: ${config.hermesWsHost}:${config.hermesWsPort}`);
          continue;
        }
        if (Array.isArray(v)) for (const item of v) lines.push(`${k}: ${item}`);
        else if (v) lines.push(`${k}: ${v}`);
      }
      upstream.write(lines.join('\r\n') + '\r\n\r\n');
      if (head?.length) upstream.write(head);
      upstream.pipe(socket);
      socket.pipe(upstream);
    });
    upstream.on('error', () => socket.destroy());
    socket.on('error', () => upstream.destroy());
  });

  return server;
}

/* ---------------------------------------------------------------- main */

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const config = loadConfig();
  const server = createEaiosServer(config);
  server.listen(config.port, config.host, () => {
    console.log(`eaios-server listening on http://${config.host}:${config.port}`);
    console.log(`  dist:      ${config.distDir}`);
    console.log(`  hermes ws: ${config.hermesWsHost}:${config.hermesWsPort} (token ${config.hermesToken ? 'loaded' : 'MISSING — live mode will degrade'})`);
    console.log(`  knowledge: ${config.knowledgeUrl}`);
    console.log(`  composio:  key ${config.composioKey ? 'loaded' : 'absent'}`);
  });
}
