// Dogfood-fix live verification (2026-08-29): profile-env middleware
// round-trip + SOUL edit surface on a THROWAWAY profile (real profiles'
// secrets are never touched). Cleans up after itself.
import { readFileSync, existsSync } from 'node:fs';

const token = readFileSync(process.env.HOME + '/.hermes/.eaios-dev-token', 'utf8').trim();
const ws = new WebSocket(`ws://127.0.0.1:9119/api/ws?token=${encodeURIComponent(token)}`);
const rpc = (id, method, params) => ws.send(JSON.stringify({ jsonrpc: '2.0', id, method, params }));
const replies = new Map();
const wait = (id) => new Promise((res, rej) => {
  const t = setTimeout(() => rej(new Error(`timeout waiting ${id}`)), 20000);
  replies.set(id, (v) => { clearTimeout(t); res(v); });
});
ws.onmessage = (ev) => {
  const msg = JSON.parse(String(ev.data));
  if (msg.id !== undefined && replies.has(msg.id)) replies.get(msg.id)(msg.error ? { error: msg.error } : msg.result);
};
ws.onerror = (e) => { console.log('WS ERR', e.message ?? e); process.exit(1); };
await new Promise((r) => { ws.onopen = r; });

// 1. throwaway profile (no credential mirroring → clean .env stub)
rpc(1, 'profiles.create', { name: 'eaios-verify-bind', description: 'throwaway', mirror_credentials: false });
console.log('1. profiles.create:', JSON.stringify((await wait(1)).error ?? 'ok'));

// 2. GET existence → false
let r = await fetch('http://localhost:5173/api/profile-env?profile=eaios-verify-bind&key=TELEGRAM_BOT_TOKEN').then((x) => x.json());
console.log('2. GET before bind:', JSON.stringify(r));

// 3. POST bind (fake token — my own test artifact)
r = await fetch('http://localhost:5173/api/profile-env', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ profile: 'eaios-verify-bind', key: 'TELEGRAM_BOT_TOKEN', value: 'fake-token-for-verification' }),
}).then((x) => x.json());
console.log('3. POST bind:', JSON.stringify(r));

// 4. GET existence → true; disk content + perms (reading MY fake artifact only)
r = await fetch('http://localhost:5173/api/profile-env?profile=eaios-verify-bind&key=TELEGRAM_BOT_TOKEN').then((x) => x.json());
const envPath = process.env.HOME + '/.hermes/profiles/eaios-verify-bind/.env';
console.log('4. GET after bind:', JSON.stringify(r), '· disk:', readFileSync(envPath, 'utf8').includes('TELEGRAM_BOT_TOKEN=fake-token-for-verification'));

// 5. default profile refused
r = await fetch('http://localhost:5173/api/profile-env', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ profile: 'default', key: 'TELEGRAM_BOT_TOKEN', value: 'nope' }),
});
console.log('5. POST default refused:', r.status);

// 6. SOUL edit surface on the throwaway profile (profiles.describe/configure)
rpc(6, 'profiles.configure', { name: 'eaios-verify-bind', soul: '# Verify Soul\nDisposable.' });
console.log('6. configure soul:', JSON.stringify((await wait(6)).error ?? 'ok'));
rpc(7, 'profiles.describe', { name: 'eaios-verify-bind' });
const desc = await wait(7);
console.log('7. describe soul round-trip:', JSON.stringify(desc?.soul ?? desc.error));

// 7. cleanup: delete the throwaway profile
rpc(8, 'profiles.delete', { name: 'eaios-verify-bind' });
console.log('8. profiles.delete:', JSON.stringify((await wait(8)).error ?? 'ok'));
console.log('   profile dir gone:', !existsSync(process.env.HOME + '/.hermes/profiles/eaios-verify-bind'));
process.exit(0);
