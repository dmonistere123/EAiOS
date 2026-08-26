// Probe skills.manage variants for a richer shape (descriptions, etc.)
import { readFileSync } from 'node:fs';

const token = readFileSync(process.env.HOME + '/.hermes/.eaios-dev-token', 'utf8').trim();
const ws = new WebSocket(`ws://127.0.0.1:9119/api/ws?token=${encodeURIComponent(token)}`);
const attempts = [
  { action: 'list', verbose: true },
  { action: 'list', descriptions: true },
  { action: 'describe', name: 'arxiv' },
  { action: 'view', name: 'arxiv' },
  { action: 'info', name: 'arxiv' },
];
let id = 0;
const timeout = setTimeout(() => { console.log('TIMEOUT'); process.exit(1); }, 20000);

ws.onopen = () => {
  for (const params of attempts) {
    ws.send(JSON.stringify({ jsonrpc: '2.0', id: ++id, method: 'skills.manage', params }));
  }
};
const seen = new Set();
ws.onmessage = (ev) => {
  const msg = JSON.parse(String(ev.data));
  if (msg.id === undefined || seen.has(msg.id)) return;
  seen.add(msg.id);
  const params = attempts[msg.id - 1];
  const out = msg.error ? `ERROR ${JSON.stringify(msg.error).slice(0, 160)}` : JSON.stringify(msg.result).slice(0, 600);
  console.log(`--- ${JSON.stringify(params)}\n${out}\n`);
  if (seen.size === attempts.length) { clearTimeout(timeout); process.exit(0); }
};
ws.onerror = (e) => { console.log('WS ERROR', e.message ?? e); process.exit(1); };
