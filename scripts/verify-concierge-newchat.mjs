#!/usr/bin/env node
/**
 * Live probe for the concierge "New chat" path (t_09cc51e8, 2026-08-30).
 * Verifies the exact RPC sequence startNewAssistantChat('concierge') now runs:
 *   session.create { title: 'EAiOS — Concierge' } (NO profile param — the
 *   concierge is a lane on the default profile, not a profile).
 * Prints the returned ids, then closes the session so the gateway can reap it.
 */
import { readFileSync } from 'node:fs';

const token = readFileSync(`${process.env.HOME}/.hermes/.eaios-dev-token`, 'utf8').trim();
const ws = new WebSocket(`ws://127.0.0.1:9119/api/ws?token=${encodeURIComponent(token)}`);
let id = 0;
const pending = new Map();
const call = (method, params) =>
  new Promise((resolve, reject) => {
    const mid = ++id;
    pending.set(mid, { resolve, reject });
    ws.send(JSON.stringify({ jsonrpc: '2.0', id: mid, method, params }));
  });

const done = (code) => { try { ws.close(); } catch {} process.exit(code); };
setTimeout(() => { console.error('TIMEOUT'); done(2); }, 20000);

ws.onerror = (e) => { console.error('WS error', e.message ?? e); done(2); };
ws.onmessage = (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id);
    pending.delete(msg.id);
    msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
  }
};
ws.onopen = async () => {
  try {
    const c = await call('session.create', { title: 'EAiOS — Concierge' });
    console.log('session.create ok:', JSON.stringify(c));
    if (!c.session_id) throw new Error('no session_id returned');
    // prompt.submit is what the first post-clear message does (full nav brief rides the text)
    const p = await call('prompt.submit', { session_id: c.session_id, text: '[probe] reply with the single word: fresh' });
    console.log('prompt.submit ok:', JSON.stringify(p));
    // wait for completion event on this sid
    await new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('no message.complete within 120s')), 120000);
      ws.addEventListener('message', (ev2) => {
        const m = JSON.parse(ev2.data);
        if (m.method === 'event' && m.params?.session_id === c.session_id && m.params?.type === 'message.complete') {
          clearTimeout(t);
          console.log('message.complete ok:', JSON.stringify(m.params.payload).slice(0, 200));
          resolve();
        }
      });
    });
    const close = await call('session.close', { session_id: c.session_id });
    console.log('session.close ok:', JSON.stringify(close));
    console.log('PROBE PASS — concierge new-chat RPC sequence works against the live gateway');
    done(0);
  } catch (e) {
    console.error('PROBE FAIL:', e.message);
    done(1);
  }
};
