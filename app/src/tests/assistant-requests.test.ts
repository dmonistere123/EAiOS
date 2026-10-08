// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { AssistantRequests, type Rpc } from '../../server/assistantRequests';
import lazyContract from './fixtures/hermes-lazy-contract.json';
import { requestArtifacts } from '../../server/assistantArtifacts';

const roots: string[] = []; const managers: AssistantRequests[] = [];
const id = (n: number) => `request-fixture-${n}`;
const root = () => { const r = mkdtempSync(join(tmpdir(), 'eaios-requests-')); roots.push(r); return r; };
class FakeGateway {
  resumes: Record<string, unknown>[] = []; allowLazy = false;
  creates = 0; submissions: { sid: string; text: string }[] = []; interrupts: string[] = [];
  sessions = new Map<string, { running: boolean; inflight?: { assistant: string; error?: string; status?: string }; messages: { role: string; text: string }[] }>();
  clients: Rpc[] = []; offline = false; loseAck = false;
  client = (): Rpc => {
    const client: Rpc = {
      isConnected: false, onEvent: null,
      connect: async () => { if (this.offline) throw new Error('offline'); client.isConnected = true; },
      disconnect: () => { client.isConnected = false; },
      call: async (method, p) => {
        if (!client.isConnected || this.offline) throw new Error('disconnected');
        if (method === 'session.create') { const sid = `session-${++this.creates}`; this.sessions.set(sid, { running: false, messages: [] }); return { session_id: sid, stored_session_id: sid }; }
        const sid = String(p.session_id); const session = this.sessions.get(sid); if (!session) throw new Error('missing');
        if (method === 'prompt.submit') { session.running = true; session.messages.push({ role: 'user', text: String(p.text) }); this.submissions.push({ sid, text: String(p.text) }); if (this.loseAck) throw new Error('ack lost'); return { status: 'streaming' }; }
        if (method === 'session.history') return { messages: [...session.messages] };
        if (method === 'session.resume') { if (!this.allowLazy || p.lazy !== true) throw new Error('FORBIDDEN: cold resume may auto-continue'); this.resumes.push(p); return {...lazyContract.reply,session_id:sid,session_key:sid}; }
        if (method === 'session.activate') return { session_id: sid, stored_session_id: sid, running: session.running, inflight: session.inflight, messages: [...session.messages] };
        if (method === 'session.interrupt') { this.interrupts.push(sid); session.running = false; return { interrupted: true }; }
        throw new Error(`Unexpected ${method}`);
      },
    }; this.clients.push(client); return client;
  };
  finish(sid: string, text: string, emit = true) { const s = this.sessions.get(sid)!; s.running = false; s.messages.push({ role: 'assistant', text }); if (emit) this.event(sid, 'message.complete', { text, status: 'complete' }); }
  event(sid: string, type: string, payload: Record<string, unknown>) { this.clients.filter(c => c.isConnected).forEach(c => c.onEvent?.({ session_id: sid, type, payload })); }
}
const manager = (r: string, gateway: FakeGateway) => { const m = new AssistantRequests(r, { client: gateway.client, pollMs: 1000, evidence: sid => { const last=gateway.sessions.get(sid)?.messages.at(-1); return {available:true,response:last?.role==='assistant'?last.text:undefined}; } }); managers.push(m); return m; };
beforeEach(() => vi.useFakeTimers());
afterEach(async () => { managers.splice(0).forEach(m => m.close()); await vi.advanceTimersByTimeAsync(2000); vi.useRealTimers(); roots.splice(0).forEach(r => rmSync(r, { recursive: true, force: true })); });

describe('durable Assistant requests', () => {
  it('continues native saved context only on explicit Send, using the compression tip and one submission after lost acknowledgement', async () => {
    const g = new FakeGateway(); g.allowLazy = true; g.loseAck = true;
    g.sessions.set('saved-tip', { running: false, messages: [{role:'user',text:'Remember blue'}, {role:'assistant',text:'Remembered blue'}] });
    const evidence = vi.fn(() => ({available:true}));
    const m = new AssistantRequests(root(), {client:g.client,pollMs:1000,checkpoint:()=>({afterMessageId:42,sessionId:'saved-tip'}),evidence}); managers.push(m);
    m.accept(id(20),'What color?',[],undefined,'saved-root');
    expect(() => m.accept(id(21),'Race?',[],undefined,'saved-root')).toThrow('still responding');
    await vi.advanceTimersByTimeAsync(5000);
    expect(g.creates).toBe(0); expect(g.resumes).toEqual([{session_id:'saved-tip',lazy:true,omit_messages:true}]);
    expect(g.submissions).toEqual([{sid:'saved-tip',text:'What color?'}]);
    expect(g.sessions.get('saved-tip')!.messages).toHaveLength(3);
    g.sessions.get('saved-tip')!.running=false;
    await vi.advanceTimersByTimeAsync(2000);
    expect(evidence).toHaveBeenCalledWith('saved-tip',undefined,42);
    expect(m.get(id(20))).toMatchObject({state:'interrupted',response:'',conversationId:'saved-root'});
    expect(m.get(id(20))).not.toHaveProperty('afterMessageId');
    expect(g.resumes).toHaveLength(1); expect(g.submissions).toHaveLength(1);
  });
  it('does not send a follow-up to a session still running outside EAiOS', async () => {
    const g=new FakeGateway(); g.allowLazy=true; g.sessions.set('busy',{running:true,messages:[]});
    const m=new AssistantRequests(root(),{client:g.client,checkpoint:()=>({afterMessageId:1,sessionId:'busy'})}); managers.push(m);
    m.accept(id(22),'follow up',[],undefined,'busy'); await vi.advanceTimersByTimeAsync(100);
    expect(g.submissions).toHaveLength(0); expect(m.get(id(22))).toMatchObject({state:'interrupted',progress:'Follow-up not sent'});
  });

  it('keeps context and progress past 150 seconds; browser subscriptions are not execution owners', async () => {
    const g = new FakeGateway(), m = manager(root(), g); const receipt = m.accept(id(1), 'one');
    expect(receipt.id).toBe(id(1)); await vi.advanceTimersByTimeAsync(180000);
    expect(m.get(id(1))?.state).toBe('running'); expect(g.submissions).toHaveLength(1);
    g.event('session-1', 'tool.start', { name: 'read_file', args: { secret: 'hidden' } }); await vi.advanceTimersByTimeAsync(251);
    expect(m.get(id(1))?.progress).toBe('Using read file'); expect(JSON.stringify(m.get(id(1)))).not.toContain('hidden');
    g.finish('session-1', 'final'); expect(m.get(id(1))?.response).toBe('final'); expect(m.get(id(1))?.state).toBe('completed');
  });
  it('deduplicates identical IDs across two dashboard processes and rejects changed inputs', async () => {
    const g = new FakeGateway(), r = root(), a = manager(r,g), b = manager(r,g);
    a.accept(id(1), 'one'); b.accept(id(1), 'one'); expect(() => b.accept(id(1), 'other')).toThrow('different input');
    await vi.advanceTimersByTimeAsync(10000); expect(g.creates).toBe(1); expect(g.submissions).toHaveLength(1);
  });
  it('reattaches after backend restart, recovers saved completion, and never repeats submission', async () => {
    const g = new FakeGateway(), r = root(), a = manager(r,g); a.accept(id(1),'one'); await vi.advanceTimersByTimeAsync(100);
    a.close(); managers.splice(managers.indexOf(a),1); await vi.advanceTimersByTimeAsync(1100);
    g.finish('session-1','finished while detached',false);
    const b = manager(r,g); await vi.advanceTimersByTimeAsync(100);
    expect(b.get(id(1))).toMatchObject({ state:'recovered',response:'finished while detached',recovered:true }); expect(g.submissions).toHaveLength(1);
  });
  it('recovers an uncertain submission acknowledgement without resubmitting', async () => {
    const g = new FakeGateway(); g.loseAck = true; const m = manager(root(),g); m.accept(id(1),'one');
    await vi.advanceTimersByTimeAsync(4000); expect(g.submissions).toHaveLength(1); expect(m.get(id(1))?.state).toBe('running');
    g.finish('session-1','answer'); expect(m.get(id(1))?.state).toBe('completed');
  });
  it('marks a restart before session identity as interrupted instead of replaying', async () => {
    const g = new FakeGateway(), r=root(); const m = manager(r,g); g.offline=true; m.accept(id(1),'one'); await vi.advanceTimersByTimeAsync(4000);
    expect(m.get(id(1))?.state).toBe('interrupted'); g.offline=false; await vi.advanceTimersByTimeAsync(10000); expect(g.submissions).toHaveLength(0);
  });
  it('cancels the original session, waits for settlement, and leaves terminal requests terminal', async () => {
    const g=new FakeGateway(),m=manager(root(),g);m.accept(id(1),'one');await vi.advanceTimersByTimeAsync(100);
    expect(m.cancel(id(1))?.state).toBe('cancelling');await vi.advanceTimersByTimeAsync(2200);
    expect(g.interrupts).toEqual(['session-1']);expect(m.get(id(1))?.state).toBe('cancelled');expect(m.cancel(id(1))?.state).toBe('cancelled');
  });
  it('isolates concurrent fresh prompts and injects only explicitly attached handoff text', async () => {
    const g=new FakeGateway(),m=manager(root(),g);m.accept(id(1),'first');m.accept(id(2),'second',[{name:'handoff.md',mimeType:'text/markdown',encoding:'text',content:'chosen context'}]);await vi.advanceTimersByTimeAsync(100);
    expect(g.creates).toBe(2);expect(g.submissions[1].text).not.toContain('first');expect(g.submissions[1].text).toContain('chosen context');
    g.event('session-1','message.delta',{text:'A'});expect(m.get(id(2))?.response).toBe('');g.finish('session-2','B');expect(m.get(id(1))?.state).toBe('running');
  });
  it('recovers from gateway disconnect and preserves partial output until a terminal answer', async () => {
    const g=new FakeGateway(),m=manager(root(),g);m.accept(id(1),'one');await vi.advanceTimersByTimeAsync(100);g.event('session-1','message.delta',{text:'partial'});
    g.offline=true;await vi.advanceTimersByTimeAsync(4000);expect(m.get(id(1))?.state).toBe('reconnecting');expect(m.get(id(1))?.response).toBe('partial');
    g.offline=false;await vi.advanceTimersByTimeAsync(4000);g.finish('session-1','full');expect(m.get(id(1))?.response).toBe('full');expect(g.submissions).toHaveLength(1);
  });
  it('fences a stale worker after another process takes its lease', async () => {
    const g=new FakeGateway(),r=root(),a=manager(r,g);a.accept(id(1),'one');await vi.advanceTimersByTimeAsync(100);
    const db=new DatabaseSync(join(r,'assistant-requests','requests.sqlite'));db.prepare('UPDATE requests SET owner=NULL,lease=0 WHERE id=?').run(id(1));db.close();
    const b=manager(r,g);await vi.advanceTimersByTimeAsync(100);g.finish('session-1','one final');
    expect(b.get(id(1))?.state).toBe('completed');expect(g.submissions).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(12000);expect(a.get(id(1))?.response).toBe('one final');
  });
  it('does not treat a recovered partial/error transcript as a confirmed successful completion',async()=>{
    const g=new FakeGateway(),r=root(),a=manager(r,g);a.accept(id(1),'one');await vi.advanceTimersByTimeAsync(100);a.close();managers.splice(managers.indexOf(a),1);await vi.advanceTimersByTimeAsync(1100);
    g.finish('session-1','saved assistant text without a terminal receipt',false);const b=manager(r,g);await vi.advanceTimersByTimeAsync(100);
    expect(b.get(id(1))?.state).toBe('recovered');expect(b.get(id(1))?.progress).toContain('completion status unavailable');
  });
  it('stops recovery on an authoritative missing-session response without creating replacement work',async()=>{
    const g=new FakeGateway(),r=root(),a=manager(r,g);a.accept(id(1),'one');await vi.advanceTimersByTimeAsync(100);a.close();managers.splice(managers.indexOf(a),1);await vi.advanceTimersByTimeAsync(1100);
    const original=g.client;g.client=()=>{const c=original();c.call=async()=>{throw Object.assign(new Error('session not found'),{code:4007});};return c;};
    const b=manager(r,g);await vi.advanceTimersByTimeAsync(6500);expect(b.get(id(1))?.state).toBe('interrupted');expect(g.creates).toBe(1);expect(g.submissions).toHaveLength(1);
  });
  it('recovers retained Hermes errors and partial text rather than displaying endless thinking',async()=>{
    const g=new FakeGateway(),m=manager(root(),g);m.accept(id(1),'one');await vi.advanceTimersByTimeAsync(100);
    const s=g.sessions.get('session-1')!;s.running=false;s.inflight={assistant:'saved partial',error:'provider failure detail',status:'error'};
    await vi.advanceTimersByTimeAsync(1100);expect(m.get(id(1))).toMatchObject({state:'interrupted',response:'saved partial'});expect(JSON.stringify(m.get(id(1)))).not.toContain('provider failure detail');expect(g.submissions).toHaveLength(1);
  });
  it('links late artifacts using explicit session ancestry, never unrelated timestamps or names', () => {
    const r=root();const s=new DatabaseSync(join(r,'state.db'));s.exec("CREATE TABLE sessions(id TEXT,parent_session_id TEXT,end_reason TEXT,model_config TEXT,source TEXT,started_at REAL,ended_at REAL,last_activity_at REAL); INSERT INTO sessions VALUES('origin',NULL,'compression','{}','tui',0,1,1),('compressed','origin',NULL,'{}','tui',1,NULL,2),('other',NULL,NULL,'{}','tui',1,NULL,2)");s.close();
    const k=new DatabaseSync(join(r,'kanban.db'));k.exec("CREATE TABLE tasks(id TEXT,session_id TEXT);CREATE TABLE task_attachments(id INTEGER,task_id TEXT,filename TEXT,created_at INTEGER);INSERT INTO tasks VALUES('task-a','compressed'),('task-b','other')");
    expect(requestArtifacts(r,['origin']).taskIds).toEqual(['task-a']);expect(requestArtifacts(r,['origin']).artifacts).toEqual([]);
    k.exec("INSERT INTO task_attachments VALUES(1,'task-a','report.pdf',100),(2,'task-b','report.pdf',100)");k.close(); vi.advanceTimersByTime(10001);
    expect(requestArtifacts(r,['origin']).artifacts.map(a=>a.id)).toEqual(['att-1']);
  });
});
