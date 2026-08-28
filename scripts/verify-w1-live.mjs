// W1 live verification — replays the adapter's exact call sequences against
// the live gateway: quill Bot Chat lookup (expect none), new-chat round-trip
// (create → resume → history), then cleanup (delete from a FRESH connection —
// session.delete refuses while a transport holds the session active, 4023).
import { readFileSync } from 'node:fs';

const token = readFileSync(process.env.HOME + '/.hermes/.eaios-dev-token', 'utf8').trim();
const url = `ws://127.0.0.1:9119/api/ws?token=${encodeURIComponent(token)}`;

function rpc(calls, { collectMs = 0 } = {}) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const results = [];
    const timeout = setTimeout(() => reject(new Error('timeout')), 20000 + collectMs);
    ws.onopen = () => calls.forEach(([method, params], i) => ws.send(JSON.stringify({ jsonrpc: '2.0', id: i + 1, method, params })));
    ws.onmessage = (ev) => {
      const msg = JSON.parse(String(ev.data));
      if (msg.id === undefined) return;
      results[msg.id - 1] = msg.error ? { error: msg.error } : msg.result;
      if (results.filter(Boolean).length === calls.length) {
        clearTimeout(timeout);
        if (collectMs) setTimeout(() => { ws.close(); resolve(results); }, collectMs);
        else { ws.close(); resolve(results); }
      }
    };
    ws.onerror = (e) => reject(new Error(e.message ?? 'ws error'));
  });
}

// 1. quill channel read path: Bot Chat title lookup (expect none — honest absence)
const [bot] = await rpc([['session.list', { profile: 'quill', title: 'Bot Chat', include_hidden: true }]]);
console.log('1. quill Bot Chat lookup:', JSON.stringify(bot));

// 2. New-chat round-trip: create (as startNewAssistantChat does), then resume by stored id
const [created] = await rpc([['session.create', { title: 'EAiOS — My Assistant (W1 verify)' }]]);
console.log('2. session.create:', JSON.stringify(created));
const stored = created.stored_session_id;
const [resumed, history] = await rpc([
  ['session.resume', { session_id: stored }],
  ['session.history', { session_id: stored }],
]);
console.log('3. session.resume:', JSON.stringify(resumed));
console.log('4. session.history messages:', (history.messages ?? []).length);

// 3. Cleanup: delete from a FRESH connection (4023 while active on another transport)
let del;
for (let attempt = 1; attempt <= 3; attempt++) {
  await new Promise((r) => setTimeout(r, 1500 * attempt));
  [del] = await rpc([['session.delete', { session_id: stored }]]);
  console.log(`5. session.delete attempt ${attempt}:`, JSON.stringify(del));
  if (!del.error) break;
}
console.log(del.error ? 'CLEANUP FAILED — session left behind: ' + stored : 'CLEANUP OK — verification session removed');
