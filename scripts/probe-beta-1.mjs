// Beta-readiness probe batch (2026-08-28): bot_relay storage, session.list
// fields, cron.manage list fields. Read-only. Composio /toolkits via proxy.
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

const HOME = process.env.HOME;
const out = (k, v) => console.log(`\n=== ${k} ===\n${typeof v === 'string' ? v : JSON.stringify(v, null, 1).slice(0, 3000)}`);

// ---- 1a. state.db: sessions shape + bot-chat usage ----
try {
  const db = new DatabaseSync(HOME + '/.hermes/state.db', { readOnly: true });
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map(r => r.name);
  out('state.db tables', tables.join(', '));
  const sessTable = tables.find(t => t === 'sessions') ?? tables.find(t => t.includes('session'));
  if (sessTable) {
    const cols = db.prepare(`PRAGMA table_info(${sessTable})`).all().map(c => c.name);
    out(`sessions columns`, cols.join(', '));
    out('sessions grouped (profile/source/title)', db.prepare(
      `SELECT profile_name, source, title, COUNT(*) n, MAX(updated_at) last FROM ${sessTable} GROUP BY 1,2,3 ORDER BY last DESC LIMIT 40`).all());
    out('bot-chat-ish sessions', db.prepare(
      `SELECT profile_name, source, title, session_key, updated_at FROM ${sessTable} WHERE lower(title) LIKE '%bot%' OR session_key LIKE '%bot%' ORDER BY updated_at DESC LIMIT 20`).all());
  }
  db.close();
} catch (e) { out('state.db ERROR', e.message); }

// ---- 1b. bot_relay on-disk storage ----
for (const p of [HOME + '/.hermes/bot_relay', HOME + '/.hermes/profiles/quill/bot_relay']) {
  try {
    out(`ls ${p}`, existsSync(p) ? JSON.stringify(readdirSync(p, { recursive: true }).slice(0, 40)) : '(missing)');
  } catch (e) { out(`ls ${p} ERROR`, e.message); }
}

// ---- 2 + 4. WS probes: session.list, cron.manage list ----
const token = readFileSync(HOME + '/.hermes/.eaios-dev-token', 'utf8').trim();
const ws = new WebSocket(`ws://127.0.0.1:9119/api/ws?token=${encodeURIComponent(token)}`);
const calls = [
  ['session.list', { limit: 3 }],
  ['cron.manage', { action: 'list' }],
];
const timeout = setTimeout(() => { console.log('\nWS TIMEOUT'); process.exit(1); }, 25000);
ws.onopen = () => calls.forEach(([method, params], i) =>
  ws.send(JSON.stringify({ jsonrpc: '2.0', id: i + 1, method, params })));
const seen = new Set();
ws.onmessage = async (ev) => {
  const msg = JSON.parse(String(ev.data));
  if (msg.id === undefined || seen.has(msg.id)) return;
  seen.add(msg.id);
  const [method] = calls[msg.id - 1];
  if (msg.error) { out(`RPC ${method} ERROR`, JSON.stringify(msg.error).slice(0, 400)); }
  else {
    const r = msg.result;
    const rows = r?.sessions ?? r?.jobs ?? r?.items ?? (Array.isArray(r) ? r : null);
    if (rows) {
      out(`RPC ${method} — ${rows.length} rows, FIRST row fields`, rows[0]);
      out(`RPC ${method} — field names`, Object.keys(rows[0] ?? {}).join(', '));
    } else out(`RPC ${method} raw`, JSON.stringify(r).slice(0, 2000));
  }
  if (seen.size === calls.length) {
    clearTimeout(timeout);
    // ---- 3. Composio /toolkits via vite proxy (key injected server-side) ----
    try {
      const res = await fetch('http://localhost:5173/composio-api/api/v3/toolkits?limit=5');
      const body = await res.json();
      const items = body?.items ?? body?.data ?? (Array.isArray(body) ? body : []);
      out('Composio /v3/toolkits status', String(res.status));
      out('Composio toolkit[0] fields', items[0] ? Object.keys(items[0]).join(', ') : '(no items)');
      out('Composio toolkit[0]', items[0] ?? body);
    } catch (e) { out('Composio ERROR', e.message); }
    process.exit(0);
  }
};
ws.onerror = (e) => { console.log('WS ERROR', e.message ?? e); process.exit(1); };
