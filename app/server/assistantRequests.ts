import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { GatewayRpcClient, createGatewayClient } from './allyGateway.ts';

import type { AssistantRequest } from '../src/domain/assistantRequest.ts';
interface Stored extends AssistantRequest { cancelAcknowledged?: boolean; originalStoredSessionId?: string; fingerprint: string; prompt: string; phase: 'accepted' | 'creating' | 'dispatching' | 'submitted'; }
export const terminal = (r: AssistantRequest) => ['completed', 'recovered', 'cancelled', 'interrupted'].includes(r.state);
export interface Rpc {
  connect(timeout?: number): Promise<void>; call(method: string, params: Record<string, unknown>, timeout?: number): Promise<unknown>;
  isConnected: boolean; onEvent: GatewayRpcClient['onEvent']; disconnect(): void;
}
interface Resume { session_id?: string; stored_session_id?: string; session_key?: string; running?: boolean; status?: string; inflight?: { assistant?: string; streaming?: boolean; error?: string; status?: string }; pending_approval?: unknown; pending_clarify?: unknown; messages?: { role: string; text?: string; display_kind?: string }[]; }
const delay = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

/** A local durable receipt is authoritative. Transport loss never authorizes a second submission.
 * Shared by both dashboard ports. Lease ownership fences stale writers after a restart/takeover. */
export class AssistantRequests {
  private db: DatabaseSync;
  private owner = randomUUID();
  private working = new Set<string>();
  private clients = new Set<Rpc>();
  private timer?: ReturnType<typeof setInterval>;
  private stopped = false;
  constructor(root: string, privateOptions: { client?: () => Rpc; pollMs?: number; leaseMs?: number; autoStart?: boolean } = {}) {
    this.options = { client: privateOptions.client ?? (() => { const c = createGatewayClient(); if (!c) throw new Error('Gateway unavailable'); return c; }), pollMs: privateOptions.pollMs ?? 2000, leaseMs: privateOptions.leaseMs ?? 12000 };
    const dir = join(root, 'assistant-requests'); mkdirSync(dir, { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(join(dir, 'requests.sqlite')); chmodSync(join(dir, 'requests.sqlite'), 0o600);
    this.db.exec('PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS requests(id TEXT PRIMARY KEY, data TEXT NOT NULL, owner TEXT, lease INTEGER NOT NULL DEFAULT 0)');
    if (privateOptions.autoStart !== false) { this.timer = setInterval(() => this.recover(), 2000); this.timer.unref(); this.recover(); }
  }
  private options: { client: () => Rpc; pollMs: number; leaseMs: number };
  private raw(id: string): Stored | undefined { const row = this.db.prepare('SELECT data FROM requests WHERE id=?').get(id) as { data: string } | undefined; return row ? JSON.parse(row.data) : undefined; }
  get(id: string): AssistantRequest | undefined { const r = this.raw(id); if (!r) return; const { fingerprint: _f, prompt: _p, phase: _s, originalStoredSessionId: _o, cancelAcknowledged: _c, ...publicRow } = r; return publicRow; }
  sessionRoots(id: string): string[] { const r = this.raw(id); return [r?.originalStoredSessionId, r?.storedSessionId].filter((v): v is string => !!v); }
  list(): AssistantRequest[] { return (this.db.prepare("SELECT id FROM requests WHERE json_extract(data,'$.state') NOT IN ('completed','recovered','cancelled','interrupted') OR rowid IN (SELECT rowid FROM requests ORDER BY rowid DESC LIMIT 100) ORDER BY rowid DESC").all() as { id: string }[]).map(r => this.get(r.id)!); }
  accept(id: string, text: string, attachments: { name: string; mimeType: string; content: string; encoding: string }[] = [], profile?: string) {
    if (!/^[a-zA-Z0-9_-]{16,80}$/.test(id) || (!text.trim() && !attachments.length) || text.length > 100000 || attachments.length > 10 || JSON.stringify(attachments).length > 4000000) throw new Error('Invalid request');
    const fingerprint = createHash('sha256').update(JSON.stringify({ text, attachments, profile })).digest('hex');
    const now = new Date().toISOString();
    const row: Stored = { id, text: text || `[${attachments.length} attached document${attachments.length === 1 ? '' : 's'}]`, attachmentNames: attachments.map(a => a.name), profile, fingerprint, prompt: text + (attachments.length ? '\n\n--- attached documents ---\n' + attachments.map(a => `File: ${a.name}\n${a.encoding === 'base64' ? '[base64 content omitted]' : a.content}`).join('\n---\n') : ''), phase: 'accepted', state: 'accepted', revision: 1, response: '', progress: 'Accepted', createdAt: now, updatedAt: now };
    const inserted = this.db.prepare('INSERT OR IGNORE INTO requests(id,data,owner,lease) VALUES(?,?,?,?)').run(id, JSON.stringify(row), this.owner, Date.now() + this.options.leaseMs).changes;
    if (this.raw(id)!.fingerprint !== fingerprint) throw new Error('Request ID already belongs to different input');
    // Insert reserves ownership atomically, so the other dashboard cannot recover a half-started receipt.
    // Only the process that durably inserted the request may perform its first submission.
    if (inserted) this.launch(id, true);
    return this.get(id)!;
  }
  private patch(id: string, fields: Partial<Stored>, owned = true) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const r = this.raw(id); if (!r) throw new Error('Unknown request');
      if (terminal(r)) { this.db.exec('COMMIT'); return false; }
      const next = { ...r, ...fields, revision: r.revision + 1, updatedAt: new Date().toISOString() };
      const changed = owned
        ? this.db.prepare('UPDATE requests SET data=? WHERE id=? AND owner=? AND lease>?').run(JSON.stringify(next), id, this.owner, Date.now()).changes
        : this.db.prepare('UPDATE requests SET data=? WHERE id=?').run(JSON.stringify(next), id).changes;
      this.db.exec('COMMIT'); return !!changed;
    } catch (e) { this.db.exec('ROLLBACK'); throw e; }
  }
  cancel(id: string) {
    const r = this.raw(id); if (!r) return;
    if (!terminal(r)) this.patch(id, { cancelRequested: true, state: 'cancelling', progress: 'Cancellation requested; waiting for Hermes to stop' }, false);
    this.recover(); return this.get(id);
  }
  recover() { try { if (!this.stopped) for (const r of this.list()) if (!terminal(r)) this.launch(r.id, false); } catch { /* A storage outage must not crash the dashboard; the next tick retries. */ } }
  private launch(id: string, fresh: boolean) {
    if (this.stopped || this.working.has(id)) return;
    const claimed = this.db.prepare("UPDATE requests SET owner=?, lease=? WHERE id=? AND (owner IS NULL OR lease<? OR owner=?) AND json_extract(data,'$.state') NOT IN ('completed','recovered','cancelled','interrupted')").run(this.owner, Date.now() + this.options.leaseMs, id, Date.now(), this.owner).changes;
    if (!claimed) return;
    this.working.add(id);
    void this.run(id, fresh).catch(() => { /* Receipt remains durable; never replay after persistence failure. */ }).finally(() => {
      this.working.delete(id);
      try { if (!this.stopped) this.db.prepare('UPDATE requests SET owner=NULL,lease=0 WHERE id=? AND owner=?').run(id, this.owner); else if (!this.working.size) this.db.close(); } catch { /* lease expires if storage is temporarily unavailable */ }
    });
  }
  private owns(id: string) {
    return !!this.db.prepare('UPDATE requests SET lease=? WHERE id=? AND owner=? AND lease>?').run(Date.now() + this.options.leaseMs, id, this.owner, Date.now()).changes;
  }
  private async run(id: string, fresh: boolean) {
    let client: Rpc | undefined;
    let leaseLost = false;
    const leaseTimer = setInterval(() => { try { if (!this.stopped && !this.owns(id)) { leaseLost = true; client?.disconnect(); } } catch { leaseLost = true; client?.disconnect(); } }, Math.max(10, this.options.leaseMs / 3));
    leaseTimer.unref();
    try {
      let r = this.raw(id)!;
      const promptToSubmit = r.prompt;
      if (r.cancelRequested && r.phase === 'accepted') { this.patch(id, { state: 'cancelled', progress: 'Cancelled before submission' }); return; }
      if (!fresh && !r.storedSessionId) { this.patch(id, { state: 'interrupted', error: 'Request acceptance was interrupted before a recoverable session was recorded. It was not resubmitted.', progress: 'Needs review' }); return; }
      client = this.options.client(); this.clients.add(client);
      await client.connect(5000);
      if (this.stopped || leaseLost) return;
      if (fresh) {
        if (!this.patch(id, { phase: 'creating' })) return;
        const c = await client.call('session.create', { title: `EAiOS request ${id}`, ...(r.profile ? { profile: r.profile } : {}) }, 15000) as Resume;
        if (!c.session_id || !c.stored_session_id) throw new Error('Hermes did not return durable session identity');
        if (!this.patch(id, { runtimeSessionId: c.session_id, storedSessionId: c.stored_session_id, originalStoredSessionId: c.stored_session_id, prompt: '', phase: 'dispatching' })) return;
      } else {
        this.patch(id, { state: 'reconnecting', progress: 'Recovering the original request; no prompt replay' });
      }
      r = this.raw(id)!;
      let sid = r.runtimeSessionId;
      let completionSeen = false;
      client.onEvent = e => {
        try {
        const eventPatch = (fields: Partial<Stored>) => this.patch(id, { ...fields, lastActivityAt: new Date().toISOString() });
        if (this.stopped || leaseLost || String(e.session_id ?? e.sid ?? '') !== sid || terminal(this.raw(id)!)) return;
        const p = (e.payload ?? {}) as Record<string, unknown>; const type = String(e.type ?? '');
        if (type === 'message.delta' && typeof p.text === 'string') eventPatch({ response: this.raw(id)!.response + p.text });
        else if (type === 'message.complete') {
          completionSeen = true;
          const current = this.raw(id)!;
          const ok = !p.status || p.status === 'complete';
          eventPatch({ state: ok ? 'completed' : ['interrupted', 'cancelled'].includes(String(p.status)) ? 'cancelled' : 'interrupted', response: typeof p.text === 'string' && p.text.trim() ? p.text : current.response, progress: ok ? 'Completed' : 'Stopped', error: ok ? undefined : 'Hermes stopped before completing the request.' });
        } else if (type === 'turn.error' || type === 'error') {
          completionSeen = true; eventPatch({ state: 'interrupted', error: 'Hermes reported an execution error. The request was not resubmitted.', progress: 'Stopped' });
        } else if (type === 'tool.start' || type === 'tool.complete') eventPatch({ progress: `${type === 'tool.start' ? 'Using' : 'Finished'} ${String(p.name ?? 'a tool').replace(/_/g, ' ').slice(0, 80)}` });
        else if (type === 'status.update' || type === 'message.interim') eventPatch({ progress: String(p.text ?? 'Working').slice(0, 500) });
        else if (type === 'reasoning.delta' || type === 'thinking.delta') eventPatch({ progress: 'Thinking…' });
        else if (type === 'clarify.request' || type === 'approval.request') eventPatch({ progress: 'Waiting for input in Hermes Desktop; open this request’s session there' });
        } catch { client?.disconnect(); } // Reconcile if a progress write could not be persisted.
      };
      if (fresh) {
        if (this.raw(id)!.cancelRequested) { this.patch(id, { state: 'cancelled', progress: 'Cancelled before submission' }); return; }
        // phase=dispatching was persisted before this call. An ambiguous acknowledgement is NEVER retried.
        if (this.stopped || leaseLost || !this.owns(id) || terminal(this.raw(id)!)) return;
        await client.call('prompt.submit', { session_id: sid, text: promptToSubmit }, 15000);
        if (!completionSeen) this.patch(id, { phase: 'submitted', state: 'running', progress: 'Working on your request…' });
      }
      let interruptSent = false;
      while (!this.stopped && !leaseLost && !terminal(this.raw(id)!)) {
        if (!client.isConnected) throw new Error('Gateway disconnected');
        const snapshot = await client.call('session.resume', { session_id: this.raw(id)!.storedSessionId, omit_messages: true, ...(r.profile ? { profile: r.profile } : {}) }, 15000) as Resume;
        sid = snapshot.session_id;
        if (!sid) throw new Error('Missing recovered session');
        this.patch(id, { runtimeSessionId: sid, storedSessionId: snapshot.stored_session_id ?? snapshot.session_key ?? this.raw(id)!.storedSessionId });
        if (terminal(this.raw(id)!)) break;
        const current = this.raw(id)!;
        const recoveredPartial = snapshot.inflight?.assistant;
        if (typeof recoveredPartial === 'string' && recoveredPartial.length > current.response.length) this.patch(id, { response: recoveredPartial, lastActivityAt: new Date().toISOString() });
        if (snapshot.inflight?.error || snapshot.inflight?.status === 'error') {
          this.patch(id, { state: 'interrupted', progress: 'Recovered an execution error', error: 'Hermes retained a failed turn. Partial output is preserved; the prompt was not replayed.' });
          break;
        }
        if (current.cancelRequested && !interruptSent && snapshot.running) {
          await client.call('session.interrupt', { session_id: sid }, 15000); interruptSent = true; this.patch(id, { cancelAcknowledged: true });
        }
        if (snapshot.running === false && !['starting', 'waiting'].includes(snapshot.status ?? '')) {
          const history = snapshot.messages?.length ? snapshot : await client.call('session.history', { session_id: sid }, 15000) as Resume;
          const msgs = history.messages ?? []; const last = msgs.at(-1);
          const answer = last?.role === 'assistant' && !last.display_kind ? last.text?.trim() : '';
          this.patch(id, { state: answer ? 'recovered' : current.cancelRequested && (interruptSent || current.cancelAcknowledged) ? 'cancelled' : 'interrupted', response: answer || current.response, recovered: true, progress: answer ? 'Saved response recovered; original completion status unavailable' : current.cancelRequested && (interruptSent || current.cancelAcknowledged) ? 'Cancelled' : 'Stopped without a final response', error: !answer && !current.cancelRequested ? 'The original session is no longer running. No prompt was replayed.' : undefined });
          break;
        }
        if (!current.cancelRequested) this.patch(id, { state: 'running', error: undefined, ...(snapshot.pending_approval || snapshot.pending_clarify ? { progress: 'Waiting for input in Hermes Desktop; open this request’s session there' } : {}) });
        await delay(this.options.pollMs);
      }
    } catch (error) {
      if (!this.stopped && !leaseLost && !terminal(this.raw(id)!)) {
        const missing = this.raw(id)!.storedSessionId && [4001, 4007].includes(Number((error as { code?: number })?.code));
        this.patch(id, missing
          ? { state: 'interrupted', progress: 'Original session unavailable', error: 'Hermes could not find the original session. Existing output is preserved; no prompt was resubmitted.' }
          : { state: 'reconnecting', progress: 'Connection interrupted; recovering the original session', error: 'Delivery is uncertain. Do not resend this prompt; recovery will not replay it.' });
      }
    } finally { clearInterval(leaseTimer); client?.disconnect(); if (client) this.clients.delete(client); }
  }
  /** Test/process shutdown: disconnect, leave durable receipts for reconciliation, never cancel/replay. */
  close() { this.stopped = true; clearInterval(this.timer); for (const c of this.clients) c.disconnect(); this.clients.clear(); this.db.prepare('UPDATE requests SET owner=NULL,lease=0 WHERE owner=?').run(this.owner); if (!this.working.size) this.db.close(); /* workers close the DB once they finish unwinding */ }
}
const managers = new Map<string, AssistantRequests>();
export function assistantRequests(root: string) { let manager = managers.get(root); if (!manager) { manager = new AssistantRequests(root); managers.set(root, manager); } return manager; }
