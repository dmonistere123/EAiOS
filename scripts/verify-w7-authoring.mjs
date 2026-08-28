// W7 live verification — the exact middleware sequences the adapters use:
// PUT /api/playbooks-index (create → v0.1.0, edit → v0.1.1) and
// POST /api/skill-create (201 + disk file + skills.manage visibility).
// Cleans up every artifact it creates.
import { readFileSync, existsSync, rmSync } from 'node:fs';

const put = (body) => fetch('http://localhost:5173/api/playbooks-index', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const post = (body) => fetch('http://localhost:5173/api/skill-create', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

// 1. playbook create
let res = await put({ name: 'W7 Verify Playbook', description: 'Disposable verification playbook.', status: 'draft', mode: 'task', skills: [], body: '## Steps\n1. Verify.' });
let data = await res.json();
console.log('1. PUT create:', res.status, JSON.stringify(data.playbook ?? data).slice(0, 220));
const pbFile = process.env.HOME + '/eaios/playbooks/w7-verify-playbook.md';
console.log('   file on disk:', existsSync(pbFile));

// 2. playbook edit → bump
res = await put({ id: 'w7-verify-playbook', name: 'W7 Verify Playbook', description: 'Edited.', status: 'draft', mode: 'task', skills: [], body: '## Steps\n1. Verify harder.' });
data = await res.json();
console.log('2. PUT edit:', res.status, 'version now', data.playbook?.version);

// 3. slug confinement through HTTP
res = await put({ id: '../evil-escape', name: 'x', description: 'x', status: 'draft', mode: 'task', skills: [], body: 'x' });
console.log('3. PUT ../evil-escape refused:', res.status, (await res.json()).error?.slice(0, 60));
console.log('   escape file absent:', !existsSync(process.env.HOME + '/eaios/evil-escape.md'));

// 4. skill create
res = await post({ name: 'w7-verify-skill', category: 'productivity', description: 'Disposable verification skill.', body: '# W7 Verify\n\n## When to Use\n- Never; disposable.' });
console.log('4. POST skill-create:', res.status, JSON.stringify(await res.json()));
const skillFile = process.env.HOME + '/.hermes/skills/productivity/w7-verify-skill/SKILL.md';
console.log('   file on disk:', existsSync(skillFile));

// 5. duplicate refused (409)
res = await post({ name: 'w7-verify-skill', category: 'productivity', description: 'Again.', body: 'x' });
console.log('5. duplicate refused:', res.status);

// 6. skills.manage RPC visibility (the page's list path)
const token = readFileSync(process.env.HOME + '/.hermes/.eaios-dev-token', 'utf8').trim();
const ws = new WebSocket(`ws://127.0.0.1:9119/api/ws?token=${encodeURIComponent(token)}`);
await new Promise((resolve) => {
  const t = setTimeout(() => { console.log('6. skills.manage: TIMEOUT'); resolve(); }, 15000);
  ws.onopen = () => ws.send(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'skills.manage', params: { action: 'list' } }));
  ws.onmessage = (ev) => {
    const msg = JSON.parse(String(ev.data));
    if (msg.id !== 1) return;
    clearTimeout(t);
    const names = Object.values(msg.result?.skills ?? {}).flat();
    console.log('6. skills.manage sees w7-verify-skill:', names.includes('w7-verify-skill'));
    ws.close();
    resolve();
  };
});

// 7. skills-index enrichment
const idx = await fetch('http://localhost:5173/api/skills-index').then((r) => r.json());
const entry = (idx.skills ?? []).find((s) => s.name === 'w7-verify-skill');
console.log('7. skills-index entry:', JSON.stringify(entry ?? '(missing)'));

// 8. cleanup everything created above
rmSync(pbFile, { force: true });
rmSync(process.env.HOME + '/.hermes/skills/productivity/w7-verify-skill', { recursive: true, force: true });
console.log('8. cleanup: playbook gone:', !existsSync(pbFile), '· skill dir gone:', !existsSync(skillFile));
