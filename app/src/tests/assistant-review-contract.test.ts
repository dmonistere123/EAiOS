// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { AssistantRequests, MAX_RESPONSE_CHARS, type Rpc } from '../../server/assistantRequests';
const contract = JSON.parse(readFileSync(new URL('./fixtures/hermes-request-contract.json', import.meta.url),'utf8'));
const roots:string[]=[];const managers:AssistantRequests[]=[];
const root=()=>{const r=mkdtempSync(join(tmpdir(),'eaios-review-'));roots.push(r);return r;};
const flush=()=>vi.advanceTimersByTimeAsync(100);
beforeEach(()=>vi.useFakeTimers());
afterEach(async()=>{managers.forEach(m=>m.close());managers.length=0;await vi.advanceTimersByTimeAsync(2500);roots.forEach(r=>rmSync(r,{recursive:true,force:true}));roots.length=0;vi.useRealTimers();});
function fixture(options:{missing?:boolean;idle?:boolean;races?:number;unknown?:boolean;lostSubmit?:boolean}={}){
 let submitted=0,continued=0,activated=0;const clients:Rpc[]=[];
 const factory=():Rpc=>{const c:Rpc={isConnected:false,onEvent:null,connect:async()=>{c.isConnected=true;},disconnect:()=>{c.isConnected=false;},call:async(method)=>{
  if(method==='session.create')return{session_id:'lazy-runtime',stored_session_id:'stored-fixture'};
  if(method==='prompt.submit'){if(options.lostSubmit)throw new Error('crash before dispatch acknowledgement');submitted++;return{status:'streaming'};}
  // The dangerous installed cold path returns idle AND schedules another turn.
  if(method==='session.resume'){continued++;return contract.coldResume;}
  if(method==='session.activate'){
   activated++;if(options.missing)throw Object.assign(new Error('session not found'),{code:4001});
   if(activated<=(options.races??0))throw Object.assign(new Error(contract.resumeRace.message),{code:contract.resumeRace.code});
   if(options.unknown)return contract.lazyUnpersistedResume;
   return{...contract.activateLazy,running:!options.idle,status:options.idle?'idle':'working'};
  }
  if(method==='session.interrupt')return{interrupted:true};
  throw new Error(`Unexpected RPC ${method}`);
 }};clients.push(c);return c;};
 return{factory,clients,counts:()=>({submitted,continued,activated})};
}
function manager(r:string,f:ReturnType<typeof fixture>){const m=new AssistantRequests(r,{client:f.factory,pollMs:1000,evidence:()=>({available:true,response:'Saved evidence'})});managers.push(m);return m;}
it('captures the actual dangerous cold, incomplete lazy, and retryable race contracts',()=>{
 expect(contract.defaultAutoContinue).toBe(true);expect(contract.coldContinuationCalls).toBe(1);expect(contract.coldResume).toMatchObject({running:false,status:'idle',auto_continue:{scheduled:true}});
 expect(contract.lazyUnpersistedResume).not.toHaveProperty('running');expect(contract.lazyUnpersistedResume).not.toHaveProperty('status');expect(contract.activateLazy).toMatchObject({running:false,status:'idle'});expect(contract.resumeRace).toEqual({code:4007,message:'session no longer live; retry resume'});
});
it('never invokes cold resume after a lost runtime, even when auto-continuation is enabled',async()=>{
 const f=fixture({missing:true}),m=manager(root(),f);m.accept('request-review-0001','one');await vi.advanceTimersByTimeAsync(6500);
 expect(m.get('request-review-0001')).toMatchObject({state:'interrupted',response:'Saved evidence'});expect(f.counts().continued).toBe(0);expect(f.counts().submitted).toBe(1);expect(f.counts().activated).toBe(3);
});
it('handles identity-persisted/pre-submit crash and cancellation without infinite thinking or replay',async()=>{
 const f=fixture({idle:true,lostSubmit:true}),m=manager(root(),f);m.accept('request-review-0002','one');await flush();m.cancel('request-review-0002');await vi.advanceTimersByTimeAsync(2500);
 expect(['interrupted','recovered']).toContain(m.get('request-review-0002')?.state);expect(f.counts().continued).toBe(0);expect(f.counts().submitted).toBe(0);
});
it('treats missing running/status as uncertain, bounds retries, and never infers running',async()=>{
 const f=fixture({unknown:true}),m=manager(root(),f);m.accept('request-review-0003','one');await vi.advanceTimersByTimeAsync(6500);
 expect(m.get('request-review-0003')?.state).toBe('interrupted');expect(f.counts().activated).toBe(3);expect(f.counts().continued).toBe(0);
});
it('retries installed 4007 race twice and safely reattaches on the third attempt',async()=>{
 const f=fixture({races:2}),m=manager(root(),f);m.accept('request-review-0004','one');await vi.advanceTimersByTimeAsync(4500);
 expect(m.get('request-review-0004')?.state).toBe('running');expect(f.counts().continued).toBe(0);expect(f.counts().submitted).toBe(1);
});
it('bounds response snapshots and coalesces event writes without changing Hermes execution context',async()=>{
 const f=fixture(),m=manager(root(),f);m.accept('request-review-0005','original context');await flush();const before=m.get('request-review-0005')!.revision;
 for(let n=0;n<1000;n++)f.clients[0].onEvent?.({session_id:'lazy-runtime',type:'message.delta',payload:{text:'x'.repeat(100)}});
 await vi.advanceTimersByTimeAsync(300);const row=m.get('request-review-0005')!;
 expect(row.response).toHaveLength(MAX_RESPONSE_CHARS);expect(row.responseLimited).toBe(true);expect(row.revision-before).toBeLessThan(5);expect(row.text).toBe('original context');expect(row.state).toBe('running');
});
it('rejects additional active work at capacity while preserving all accepted identities',async()=>{
 const f=fixture(),m=manager(root(),f);for(let n=0;n<16;n++)m.accept(`request-capacity-${n}`,'keep this context');
 expect(()=>m.accept('request-capacity-overflow','other')).toThrow('capacity');expect(m.list()).toHaveLength(16);expect(m.list().every(r=>r.text==='keep this context')).toBe(true);
});
