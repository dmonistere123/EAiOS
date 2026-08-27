// Live 5.4 verification: create an UNASSIGNED playbook run via cli.exec
// (same argv the adapter builds), confirm the marker is queryable, archive it.
import { readFileSync } from 'node:fs';

const token = readFileSync(process.env.HOME + '/.hermes/.eaios-dev-token', 'utf8').trim();
const ws = new WebSocket(`ws://127.0.0.1:9119/api/ws?token=${encodeURIComponent(token)}`);
let id = 0;
const pending = new Map();
const timeout = setTimeout(() => { console.log('TIMEOUT'); process.exit(1); }, 30000);

const call = (method, params) => new Promise((resolve, reject) => {
  const rid = ++id;
  pending.set(rid, { resolve, reject });
  ws.send(JSON.stringify({ jsonrpc: '2.0', id: rid, method, params }));
});

ws.onmessage = (ev) => {
  const msg = JSON.parse(String(ev.data));
  if (msg.id === undefined || !pending.has(msg.id)) return;
  const p = pending.get(msg.id);
  pending.delete(msg.id);
  msg.error ? p.reject(new Error(JSON.stringify(msg.error))) : p.resolve(msg.result);
};

const MARKER = /eaios-playbook: ([\w-]+)@v([\d.]+)/;

ws.onopen = async () => {
  try {
    const body = '# Monthly Expense Audit\n\n(live verification run — unassigned, will not execute)\n\n---\neaios-playbook: monthly-expense-audit@v1.2.0';
    const created = await call('cli.exec', { argv: ['kanban', 'create', 'Playbook: Monthly Expense Audit v1.2.0', '--body', body, '--json'] });
    console.log('create code:', created.code);
    const task = JSON.parse(created.output);
    console.log('task id:', task.id, '| assignee:', task.assignee ?? null, '| status:', task.status);

    const listed = await call('cli.exec', { argv: ['kanban', 'list', '--json', '--archived'] });
    const tasks = JSON.parse(listed.output);
    const hits = tasks.filter((t) => MARKER.test(t.body ?? '')).map((t) => ({ id: t.id, pb: t.body.match(MARKER)[1], v: t.body.match(MARKER)[2], status: t.status }));
    console.log('history hits:', JSON.stringify(hits));

    const archived = await call('cli.exec', { argv: ['kanban', 'archive', task.id] });
    console.log('archive code:', archived.code, archived.output.slice(0, 120));
    clearTimeout(timeout);
    process.exit(0);
  } catch (e) {
    console.log('FAIL', e.message);
    process.exit(1);
  }
};
ws.onerror = (e) => { console.log('WS ERROR', e.message ?? e); process.exit(1); };
