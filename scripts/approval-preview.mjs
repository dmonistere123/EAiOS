/** Isolated Approvals preview: only approval APIs and static assets are served.
 * No gateway, Composio, provider proxy, scheduler, or worker is available. */
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { basename, resolve, sep, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { handleApiRequest } from '../app/server/httpApi.ts';
const root = resolve(process.argv[2] ?? '');
if (!basename(root).startsWith('eaios-hermes-approval-')) throw new Error('A disposable approval fixture directory is required');
const dist = fileURLToPath(new URL('../app/dist/', import.meta.url));
const port = Number(process.argv[3] ?? 5275);
const server = createServer((req, res) => {
  const path = new URL(req.url ?? '/', 'http://localhost').pathname;
  if (path === '/api/kanban' || /^\/api\/kanban\/approvals\/[^/]+\/decision$/.test(path)) {
    void handleApiRequest(req, res, { hermesHome: root, eaiosRoot: root }).catch(() => { res.writeHead(500); res.end(); });
    return;
  }
  if (path.startsWith('/api') || path.includes('-api')) {
    res.writeHead(503, { 'content-type': 'application/json' }); res.end('{"error":"Unavailable in isolated approval test"}'); return;
  }
  let file = resolve(dist, '.' + path);
  if (!file.startsWith(resolve(dist) + sep)) file = resolve(dist, 'index.html');
  try { if (!statSync(file).isFile()) file = resolve(dist, 'index.html'); } catch { file = resolve(dist, 'index.html'); }
  const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' }[extname(file)] ?? 'application/octet-stream';
  let body = readFileSync(file);
  if (extname(file) === '.html') body = Buffer.from(body.toString().replace('</body>', '<div style="position:fixed;bottom:0;left:0;right:0;z-index:99999;background:#fde68a;color:#422006;text-align:center;padding:4px;font:14px sans-serif">ISOLATED APPROVAL TEST — sample drafts only; no emails can be sent</div></body>'));
  res.writeHead(200, { 'content-type': mime, 'cache-control': 'no-store' }); res.end(body);
});
server.on('upgrade', (_req, socket) => socket.destroy());
server.listen(port, '127.0.0.1', () => console.log(`Isolated approval test: http://127.0.0.1:${port}/approvals`));
