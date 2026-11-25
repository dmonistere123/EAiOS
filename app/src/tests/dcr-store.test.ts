// @vitest-environment node
import {afterEach,expect,it,vi} from 'vitest';
import {mkdtempSync,rmSync,mkdirSync,writeFileSync,readdirSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {once} from 'node:events';
import {DcrStore,fields} from '../../server/dcrStore.ts';
import {runDcrConversation} from '../../server/dcrConversation.ts';
import {startDcrStage} from '../../server/dcrStage.ts';
import {blankDcr,dcrAttention} from '../domain/dcr';
const cleanup:(()=>void)[]=[];
afterEach(()=>{cleanup.splice(0).reverse().forEach(fn=>fn());});
function setup(){const root=mkdtempSync(join(tmpdir(),'dcr-test-'));cleanup.push(()=>rmSync(root,{recursive:true,force:true}));const store=new DcrStore(root);cleanup.push(()=>store.db.close());return {root,store};}
const draft={...blankDcr(),title:'Send scope',what:'Send the proposed scope.',why:'Keep the pilot moving.',owner:'Executive'};
function proposal(){const x=setup();const source=x.store.addSource('Note','Maya promised to send the roster.');const request=x.store.begin('Find commitments',null,[source.id]);const answer={reply:'A promise was made; the due date is unknown.',citations:[{sourceId:source.id,quote:'Maya promised to send the roster.'}],suggestions:[{fields:{...draft,title:'Roster from Maya',direction:'owed_to_me' as const},basis:'source' as const,citations:[{sourceId:source.id,quote:'Maya promised to send the roster.'}]}]};return {...x,source,request,answer};}
it('keeps suggestions outside real counts until one atomic acceptance, rejects replay and retains history',()=>{
 const x=proposal();x.store.finish(x.request.id,x.answer);expect(x.store.records()).toHaveLength(0);
 const records=x.store.accept(x.request.id,[x.answer.suggestions[0].fields],false);expect(records).toHaveLength(1);expect(records[0].dueDate).toBe('');expect(x.store.history()[0].action).toBe('created');
 expect(()=>x.store.accept(x.request.id,[draft],false)).toThrow('already handled');expect(x.store.records()).toHaveLength(1);
});
it('rejects unknown fields, fabricated evidence, invalid dates and unsupported completion',()=>{
 const x=proposal();expect(()=>x.store.finish(x.request.id,{...x.answer,citations:[{sourceId:x.source.id,quote:'This never occurred'}]})).toThrow('verified');
 expect(()=>fields({...draft,executor:'real-worker'})).toThrow('Unsupported');expect(()=>fields({...draft,dueDate:'2026-02-30'})).toThrow('date');expect(()=>fields({...draft,status:'completed'})).toThrow('outcome');
});
it('rolls back all records if any accepted suggestion is invalid',()=>{const x=proposal();x.store.finish(x.request.id,{...x.answer,suggestions:[...x.answer.suggestions,...x.answer.suggestions]});expect(()=>x.store.accept(x.request.id,[draft,{...draft,title:''}],true)).toThrow();expect(x.store.records()).toHaveLength(0);expect(x.store.history()).toHaveLength(0);});
it('prevents stale concurrent edits and proposal acceptance',()=>{
 const x=setup(),record=x.store.save(draft),request=x.store.begin('Change the title',record.id,[],true);
 x.store.finish(request.id,{reply:'Review the proposed name.',citations:[],suggestions:[{fields:{...draft,title:'Revised scope'},basis:'executive_statement',citations:[]}]});
 x.store.save({...draft,why:'Updated reason'},record.id,record.revision);
 expect(()=>x.store.save(draft,record.id,record.revision)).toThrow('changed');expect(x.store.visibleRequests()[0].state).toBe('stale');expect(()=>x.store.accept(request.id,[draft],false)).toThrow('changed');
});
it('removes revoked-source conversations from replay and rejects their pending proposals',()=>{
 const x=proposal();x.store.finish(x.request.id,x.answer);x.store.revokeSource(x.source.id);expect(x.store.visibleRequests()).toHaveLength(0);expect(()=>x.store.accept(x.request.id,[draft],false)).toThrow('changed');
});
it('does not reuse conversation evidence that was not selected for the next request',()=>{
 const x=setup(),record=x.store.save(draft),s=x.store.addSource('Private note','Private context.'),r=x.store.begin('Question',record.id,[s.id]);x.store.finish(r.id,{reply:'Private answer',citations:[],suggestions:[]});const next=x.store.begin('New question',record.id,[]);expect(x.store.context(next.id).history).toHaveLength(0);
});
it('recovers interrupted requests after restart without retrying providers',()=>{
 const x=setup(),r=x.store.save(draft);const request=x.store.begin('Question',r.id,[]);const reopened=new DcrStore(x.root);expect(reopened.request(request.id).state).toBe('interrupted');expect(reopened.record(r.id).title).toBe(draft.title);reopened.db.close();
});
it('uses a tool-free model call and leaves speculative discussion read-only',async()=>{
 const x=setup(),r=x.store.save(draft),request=x.store.begin('What if we moved it to Monday?',r.id,[]);
 const fetcher=vi.fn(async(_url:unknown,input?:RequestInit)=>{const body=JSON.parse(String(input?.body));expect(body.tools).toBeUndefined();expect(body.messages[0].content).toContain('Hypothetical');return Response.json({choices:[{message:{content:JSON.stringify({reply:'We can discuss the trade-offs; the date is still unchanged.',citations:[],suggestions:[]})}}]});});
 await runDcrConversation(x.store,request.id,'test-only',fetcher as typeof fetch);expect(x.store.request(request.id).state).toBe('complete');expect(x.store.record(r.id).revision).toBe(1);expect(x.store.record(r.id).dueDate).toBe('');
});
it('provider failure is explicit and does not alter records or retry',async()=>{const x=setup(),r=x.store.save(draft),request=x.store.begin('Question',r.id,[]),fetcher=vi.fn(async()=>new Response('',{status:503}));await runDcrConversation(x.store,request.id,'test',fetcher as typeof fetch);expect(x.store.request(request.id).state).toBe('failed');expect(fetcher).toHaveBeenCalledOnce();expect(x.store.record(r.id).revision).toBe(1);});
it('only confirmed open records contribute to deterministic attention',()=>{const x=setup(),r=x.store.save({...draft,dueDate:'2026-11-12'});expect(dcrAttention(r,'2026-11-13')).toContain('Overdue');expect(dcrAttention({...r,status:'completed'},'2026-11-13')).toBeNull();});
async function server(){const root=mkdtempSync(join(tmpdir(),'dcr-http-'));cleanup.push(()=>rmSync(root,{recursive:true,force:true}));const dist=join(root,'dist');mkdirSync(dist);writeFileSync(join(dist,'index.html'),'<html>staging</html>');const x=startDcrStage(root,dist,0);await once(x.server,'listening');const port=(x.server.address() as {port:number}).port;const url=`http://127.0.0.1:${port}`;const page=await fetch(url+'/dcr');const cookie=page.headers.get('set-cookie')!.split(';')[0];cleanup.push(()=>{x.server.closeAllConnections();x.server.close();x.store.db.close();});const post=(path:string,body:unknown)=>fetch(url+path,{method:'POST',headers:{cookie,'content-type':'application/json',origin:url},body:JSON.stringify(body)});return {...x,root,url,cookie,post};}
it('isolates HTTP routes and blocks missing sessions, foreign origins and unexpected APIs',async()=>{const x=await server();expect((await fetch(x.url+'/api/dcr')).status).toBe(401);expect((await fetch(x.url+'/api/dcr',{headers:{cookie:x.cookie,origin:'https://foreign.test'}})).status).toBe(403);expect((await fetch(x.url+'/api/keys',{headers:{cookie:x.cookie}})).status).toBe(404);expect((await x.post('/api/dcr/ask',{prompt:'Question'})).status).toBe(503);expect((await fetch(x.url+'/human-assistant')).status).toBe(404);});
it('routes exact reviewed content through existing mail approval and captures once, never a provider',async()=>{
 const x=await server(),r=x.store.records()[0];const prepared=await x.post('/api/dcr/prepare',{recordId:r.id,revision:r.revision,body:'Reviewed fixture follow-up.'});expect(prepared.status).toBe(200);const {id}=await prepared.json();const task=x.store.db.prepare('SELECT * FROM tasks WHERE id=?').get(id)!;expect(task.assignee).toBeNull();expect(task.status).toBe('blocked');
 expect((await x.post('/api/dcr/prepare',{recordId:r.id,revision:r.revision,body:'Duplicate'})).status).toBe(409);
 expect((await x.post('/api/dcr/decide',{id,decision:'approved',reviewVersion:'wrong'})).status).toBe(409);
 const decision={id,decision:'approved',reviewVersion:String(task.body)};const result=await x.post('/api/dcr/decide',decision);expect(await result.json()).toMatchObject({ok:true});
 expect((await x.post('/api/dcr/decide',decision)).status).toBe(409);const captures=readdirSync(join(x.root,'outbox'));expect(captures).toHaveLength(1);const captured=JSON.parse(readFileSync(join(x.root,'outbox',captures[0]),'utf8'));expect(captured.package.body).toBe('Reviewed fixture follow-up.');expect(captured.provider).toBe('staging-capture');expect(x.store.record(r.id).status).toBe(r.status);
});
it('stale approvals remain rejectable after record changes',async()=>{const x=await server(),r=x.store.records()[0];const {id}=await (await x.post('/api/dcr/prepare',{recordId:r.id,revision:r.revision,body:'Old draft'})).json();const task=x.store.db.prepare('SELECT body FROM tasks WHERE id=?').get(id)!;const f=Object.fromEntries(Object.keys(blankDcr()).map(k=>[k,r[k as keyof typeof r]]));x.store.save({...f,why:'Changed'},r.id,r.revision,r.sourceIds,r.linkedIds);expect((await x.post('/api/dcr/decide',{id,decision:'approved',reviewVersion:task.body})).status).toBe(409);expect((await x.post('/api/dcr/decide',{id,decision:'rejected',reviewVersion:task.body})).status).toBe(200);});
it('discussion intent suppresses model-proposed mutations even if the provider ignores instructions',()=>{const x=setup(),r=x.store.save(draft),request=x.store.begin('What if Monday?',r.id,[]);x.store.finish(request.id,{reply:'We can consider that option.',citations:[],suggestions:[{fields:{...draft,dueDate:'2026-11-16'},basis:'executive_statement',citations:[]}]});expect(x.store.request(request.id).answer?.suggestions).toEqual([]);expect(()=>x.store.accept(request.id,[draft],false)).toThrow('Review');expect(x.store.record(r.id).revision).toBe(1);});
it('reuses extraction for unchanged evidence instead of duplicating accepted suggestions',()=>{const x=proposal();x.store.finish(x.request.id,x.answer);x.store.accept(x.request.id,[x.answer.suggestions[0].fields],false);const repeat=x.store.begin('Find commitments',null,[x.source.id]);expect(repeat.id).toBe(x.request.id);expect(x.store.requests()).toHaveLength(1);expect(x.store.records()).toHaveLength(1);});
it('excludes exact same-source record duplicates from AI extraction without merging identities',()=>{const x=proposal();x.store.save(x.answer.suggestions[0].fields,undefined,undefined,[x.source.id]);x.store.finish(x.request.id,x.answer);expect(x.store.request(x.request.id).answer?.suggestions).toHaveLength(0);expect(x.store.request(x.request.id).answer?.reply).toContain('already exist');expect(x.store.records()).toHaveLength(1);});
it('does not treat decisions or relationships as promises owed in either direction',()=>{expect(fields({...draft,kind:'decision',direction:'owed_to_me'}).direction).toBe('none');expect(fields({...draft,kind:'relationship',direction:'i_owe'}).direction).toBe('none');});
it('keeps recommendation separate from actual decision and requires an explicit complete outcome',()=>{
 const x=setup();const brief={...blankDcr('decision'),title:'Choose pilot scope',what:'Choose a scope',why:'Confirm resource needs',decisionOptions:'One location — focused\nThree locations — broader',recommendation:'Try one location first'};
 const record=x.store.save(brief);expect(record.decisionOutcome).toBe('');expect(record.status).toBe('open');
 expect(()=>x.store.save({...brief,status:'completed'},record.id,record.revision)).toThrow('actual decision');
 const decided=x.store.save({...brief,status:'completed',decisionOutcome:'Approve one location',decisionRationale:'Limit coordination risk',decidedOn:'2026-11-14'},record.id,record.revision);
 expect(decided.revision).toBe(2);expect(decided.recommendation).toBe(brief.recommendation);expect(decided.decisionOutcome).toBe('Approve one location');
 expect(x.store.history()[0].detail).toContain('executive');
});
it('creates connected promises only from a reviewed current decision and never assigns a task',()=>{
 const x=setup();const source=x.store.addSource('Pilot summary','The pilot has several scope options.');
 const person=x.store.save({...blankDcr('relationship'),title:'Maya',what:'Pilot contact',why:'Coordinates pilot',personName:'Maya Chen'});
 const decision=x.store.save({...blankDcr('decision'),title:'Approve pilot',what:'Choose scope',why:'Move pilot forward',status:'completed',decisionOutcome:'One location',decisionRationale:'Start small',decidedOn:'2026-11-14'},undefined,undefined,[source.id],[person.id]);
 expect(()=>x.store.commitmentFromDecision(decision.id,decision.revision-1,draft)).toThrow('changed');
 const commitment=x.store.commitmentFromDecision(decision.id,decision.revision,{...draft,promisor:'Executive',promisee:'Maya Chen'});
 expect(commitment.linkedIds).toEqual([decision.id,person.id]);expect(commitment.sourceIds).toEqual([source.id]);expect(commitment.status).toBe('open');expect(x.store.db.prepare('SELECT count(*) n FROM tasks').get()?.n).toBe(0);
 expect(x.store.history()[0].detail).toContain('decisionRevision');
});
it('refuses extracted decisions or fulfillment even if the provider presents them as fact',()=>{
 const x=proposal();expect(()=>x.store.finish(x.request.id,{...x.answer,suggestions:[{...x.answer.suggestions[0],fields:{...draft,status:'completed',completionEvidence:'AI says done'}}]})).toThrow('Extraction');
 expect(x.store.records()).toHaveLength(0);
});
it('preserves typed record details when a provider omits them from a proposed revision',()=>{
 const x=setup(),record=x.store.save({...draft,promisor:'Executive',promisee:'Maya Chen',blockers:'Waiting on scope'}),request=x.store.begin('Change the title',record.id,[],true);
 x.store.finish(request.id,{reply:'Review the title',citations:[],suggestions:[{fields:{title:'Send revised scope'},basis:'executive_statement',citations:[]}]});
 const proposed=x.store.request(request.id).answer!.suggestions[0].fields;expect(proposed.promisee).toBe('Maya Chen');expect(proposed.blockers).toBe('Waiting on scope');
 x.store.accept(request.id,[proposed],false);expect(x.store.record(record.id).promisor).toBe('Executive');
});
it('reads earlier staging records without inventing people, outcomes or interactions',()=>{
 const x=setup();const r=x.store.save(draft);const old={...r} as Record<string,unknown>;delete old.promisor;delete old.promisee;delete old.decisionOutcome;delete old.importance;delete old.personName;
 x.store.db.prepare('UPDATE dcr_records SET body=? WHERE id=?').run(JSON.stringify(old),r.id);
 expect(x.store.record(r.id)).toMatchObject({promisor:'',promisee:'',decisionOutcome:'',importance:'not_set',personName:''});
});
it('requires an account of a confirmed interaction and never merges people sharing a name',()=>{
 const x=setup();const person={...blankDcr('relationship'),title:'Alex Lee',personName:'Alex Lee',what:'Business contact',why:'Relevant to pilot',lastInteractionDate:'2026-11-14'};
 expect(()=>x.store.save(person)).toThrow('confirmed interaction');
 const a=x.store.save({...person,lastInteractionNote:'Executive account: discussed pilot scope',organization:'First Co'}),b=x.store.save({...person,lastInteractionNote:'Executive account: discussed renewal',organization:'Second Co'});
 expect(a.id).not.toBe(b.id);expect(x.store.records()).toHaveLength(2);
});
it('uses calendar-day attention, respects snoozes and does not change the underlying deadline',()=>{
 const x=setup(),r=x.store.save({...draft,dueDate:'2026-11-21'});
 expect(dcrAttention(r,'2026-11-14',7)).toBe('Due soon');expect(dcrAttention(r,'2026-11-14',3)).toBeNull();
 expect(dcrAttention({...r,snoozedUntil:'2026-11-16'},'2026-11-14')).toBeNull();expect(dcrAttention({...r,snoozedUntil:'2026-11-16'},'2026-11-16')).toBe('Due soon');
 expect(dcrAttention({...r,status:'archived',priority:'high'},'2026-11-14')).toBeNull();
 expect(dcrAttention({...r,kind:'relationship',dueDate:'2026-11-13'},'2026-11-14')).toBe('Follow-up overdue');
 expect(x.store.record(r.id).dueDate).toBe('2026-11-21');
});
it('rolls back a record save if history cannot be written',()=>{
 const x=setup();x.store.db.exec("CREATE TRIGGER reject_history BEFORE INSERT ON dcr_history BEGIN SELECT RAISE(ABORT,'history unavailable'); END;");
 expect(()=>x.store.save(draft)).toThrow('history unavailable');expect(x.store.records()).toHaveLength(0);
});
