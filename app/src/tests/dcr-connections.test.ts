// @vitest-environment node
import {afterEach,expect,it,vi} from 'vitest';
import {mkdtempSync,rmSync,writeFileSync,readFileSync,symlinkSync,mkdirSync,unlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {once} from 'node:events';
import {stageDcrConnections} from '../../server/dcrConnectionFixtures.ts';
import {DcrConnectionsReader} from '../../server/dcrConnections.ts';
import {DcrStore} from '../../server/dcrStore.ts';
import {runDcrConversation} from '../../server/dcrConversation.ts';
import {startDcrStage} from '../../server/dcrStage.ts';
import {blankDcr} from '../domain/dcr';
const cleanup:(()=>void)[]=[];
afterEach(()=>cleanup.splice(0).reverse().forEach(fn=>fn()));
const draft={...blankDcr(),title:'Pilot measures',what:'Get the measures accepted.',why:'Agree on success.'};
function setup(){
  const root=mkdtempSync(join(tmpdir(),'dcr-connections-'));cleanup.push(()=>rmSync(root,{recursive:true,force:true}));
  const reader=stageDcrConnections(root),store=new DcrStore(root,reader);cleanup.push(()=>store.db.close());
  const path=join(root,'connection-fixtures','attachments','northstar-pilot-brief.txt');
  const db=new DatabaseSync(join(root,'connection-fixtures','kanban.db'));cleanup.push(()=>db.close());
  const human=new DatabaseSync(join(root,'connection-fixtures','human-delegation.db'));cleanup.push(()=>human.close());
  return {root,reader,store,path,db,human};
}
function sourceRecord(){const x=setup(),preview=x.reader.artifact('att-1'),source=x.store.addArtifact(preview.id,preview.version),record=x.store.save(draft,undefined,undefined,[source.id]);return {...x,preview,source,record};}
it('previews only selected bounded text and deduplicates the same Artifact version',()=>{
  const x=setup(),catalog=x.reader.catalog();expect(catalog.errors).toEqual([]);expect(catalog.artifacts[0]).not.toHaveProperty('text');expect(catalog.artifacts[0]).not.toHaveProperty('stored_path');
  expect(x.store.sources()).toEqual([]);const preview=x.reader.artifact('att-1');expect(preview.text).toContain('Fictional staging Artifact');
  const first=x.store.addArtifact(preview.id,preview.version);expect(x.store.addArtifact(preview.id,preview.version).id).toBe(first.id);expect(first.artifact).toEqual({id:preview.id,version:preview.version});
  const manual=x.store.addSource('Independent manual note',preview.text);expect(manual.id).not.toBe(first.id);
});
it('rejects changed previews and suppresses old evidence, answers and proposals after a file changes',()=>{
  const x=sourceRecord(),request=x.store.begin('Suggest a change',x.record.id,[],true);
  x.store.finish(request.id,{reply:'Original evidence',citations:[{sourceId:x.source.id,quote:'Fictional staging Artifact'}],suggestions:[{fields:draft,basis:'source',citations:[{sourceId:x.source.id,quote:'Fictional staging Artifact'}]}]});
  writeFileSync(x.path,'Replacement evidence with a different commitment.');
  expect(()=>x.store.addArtifact(x.preview.id,x.preview.version)).toThrow('changed');expect(x.store.availableSources()).toEqual([]);expect(x.store.visibleRequests()).toEqual([]);
  expect(()=>x.store.accept(request.id,[draft],false)).toThrow('changed');expect(()=>x.store.begin('Question',x.record.id,[])).toThrow('removed');
  const fresh=x.reader.artifact('att-1');expect(x.store.addArtifact(fresh.id,fresh.version).id).not.toBe(x.source.id);expect(x.store.record(x.record.id).status).toBe('open');
});
it('hides deleted Artifact conversations and stops a provider call if deletion occurs after queuing',async()=>{
  const x=sourceRecord(),request=x.store.begin('Question',x.record.id,[]),fetcher=vi.fn();
  x.db.prepare('DELETE FROM task_attachments WHERE id=1').run();
  await runDcrConversation(x.store,request.id,'test',fetcher);expect(fetcher).not.toHaveBeenCalled();expect(x.store.request(request.id).state).toBe('failed');expect(x.store.visibleRequests()).toEqual([]);
  x.store.revokeSource(x.source.id);expect(x.store.sources()[0].active).toBe(false);
});
it('rejects path escapes, intermediate/final symlinks and nonfiles',()=>{
  const x=setup(),outside=join(x.root,'private.txt');writeFileSync(outside,'Private content must never enter context.');
  const setPath=(path:string)=>x.db.prepare('UPDATE task_attachments SET stored_path=? WHERE id=1').run(path);
  setPath(outside);expect(()=>x.reader.artifact('att-1')).toThrow('permitted');
  const link=join(x.root,'connection-fixtures','attachments','linked.txt');symlinkSync(outside,link);setPath(link);expect(()=>x.reader.artifact('att-1')).toThrow('permitted');
  const inside=join(x.root,'connection-fixtures','attachments','linked-dir');symlinkSync(x.root,inside);setPath(join(inside,'private.txt'));expect(()=>x.reader.artifact('att-1')).toThrow('permitted');
  setPath(join(x.root,'connection-fixtures','attachments'));expect(()=>x.reader.artifact('att-1')).toThrow();
  expect(()=>x.reader.artifact('../private.txt')).toThrow('Invalid');
});
it('rejects oversized, binary, empty and unsupported evidence without truncating it',()=>{
  const x=setup();for(const value of ['x'.repeat(60001),'x'.repeat(20001),'',Buffer.from([0xff,0xfe]),'nul\0byte']){writeFileSync(x.path,value);expect(()=>x.reader.artifact('att-1')).toThrow();}
  writeFileSync(x.path,'Ordinary text');x.db.prepare("UPDATE task_attachments SET content_type='text/html'").run();expect(x.reader.catalog().artifacts).toEqual([]);expect(()=>x.reader.artifact('att-1')).toThrow('unsupported');
});
it('reports unavailable modules honestly without returning examples as fallback',()=>{
  const x=setup();const reader=new DcrConnectionsReader({kanban:join(x.root,'missing.db'),attachments:x.root,human:join(x.root,'also-missing.db')});
  expect(reader.catalog()).toMatchObject({artifacts:[],work:[],errors:['Artifacts are unavailable.','Agent tasks are unavailable.','Human delegations are unavailable.']});
});
it('reads existing agent and HI work without writing either source database or fulfilling the promise',()=>{
  const x=setup(),record=x.store.save(draft),before=readFileSync(join(x.root,'connection-fixtures','kanban.db')),humanBefore=readFileSync(join(x.root,'connection-fixtures','human-delegation.db'));
  const task=x.reader.work('task','t_dcr_sample_metrics')!;expect(task.status).toBe('done');
  const linked=x.store.linkWork(record.id,record.revision,task.kind,task.id,task.version);
  const human=x.reader.work('human','hd_dcr_sample_review')!;x.store.linkWork(record.id,linked.revision,human.kind,human.id,human.version);
  expect(x.store.workLinks()).toHaveLength(2);expect(x.store.record(record.id).status).toBe('open');expect(x.store.record(record.id).completionEvidence).toBe('');
  expect(x.store.db.prepare('SELECT * FROM tasks').all()).toHaveLength(0);
  expect(readFileSync(join(x.root,'connection-fixtures','kanban.db'))).toEqual(before);expect(readFileSync(join(x.root,'connection-fixtures','human-delegation.db'))).toEqual(humanBefore);
});
it('rejects stale work selection and stale record edits, while duplicate linking is idempotent',()=>{
  const x=setup(),record=x.store.save(draft),task=x.reader.work('task','t_dcr_sample_metrics')!;
  x.db.prepare("UPDATE tasks SET status='blocked' WHERE id=?").run(task.id);expect(()=>x.store.linkWork(record.id,record.revision,task.kind,task.id,task.version)).toThrow('changed');
  const current=x.reader.work(task.kind,task.id)!;const linked=x.store.linkWork(record.id,record.revision,current.kind,current.id,current.version);
  expect(()=>x.store.linkWork(record.id,record.revision,current.kind,current.id,current.version)).toThrow('changed');
  expect(x.store.linkWork(record.id,linked.revision,current.kind,current.id,current.version).revision).toBe(linked.revision);expect(x.store.workLinks()).toHaveLength(1);
});
it('passes only explicitly linked work to the assistant and invalidates proposals on progress changes',()=>{
  const x=setup(),record=x.store.save(draft),task=x.reader.work('task','t_dcr_sample_metrics')!;
  x.store.linkWork(record.id,record.revision,task.kind,task.id,task.version);const request=x.store.begin('Propose next step',record.id,[],true);
  expect(x.store.context(request.id).work).toEqual([task]);expect(JSON.stringify(x.store.context(request.id))).not.toContain('Jordan');
  x.store.finish(request.id,{reply:'Review the result',citations:[],suggestions:[{fields:draft,basis:'executive_statement',citations:[]}]});
  x.db.prepare("UPDATE tasks SET result='New result needing review' WHERE id=?").run(task.id);
  expect(x.store.current(request.id)).toBe(false);expect(x.store.visibleRequests()).toEqual([]);expect(()=>x.store.accept(request.id,[draft],false)).toThrow('changed');
  const next=x.store.begin('What changed?',record.id,[]);expect(x.store.context(next.id).history).toEqual([]);expect(x.store.context(next.id).work![0].summary).toBe('New result needing review');
});
it('keeps a missing work reference visible and unlinkable without replaying its old contents',()=>{
  const x=setup(),record=x.store.save(draft),work=x.reader.work('human','hd_dcr_sample_review')!;
  const linked=x.store.linkWork(record.id,record.revision,work.kind,work.id,work.version),request=x.store.begin('Question',record.id,[]);
  x.human.prepare('DELETE FROM human_delegations WHERE id=?').run(work.id);expect(x.store.workLinks()[0].work).toBeNull();expect(x.store.current(request.id)).toBe(false);
  x.store.linkWork(record.id,linked.revision,work.kind,work.id,'',true);expect(x.store.workLinks()).toEqual([]);expect(x.store.record(record.id).status).toBe('open');
});
it('rolls back link and revision if its audit write fails and retains links after reopening',()=>{
  const x=setup(),record=x.store.save(draft),work=x.reader.work('human','hd_dcr_sample_review')!;
  x.store.db.exec("CREATE TRIGGER reject_work_history BEFORE INSERT ON dcr_history WHEN NEW.action='work_linked' BEGIN SELECT RAISE(ABORT,'audit failed'); END;");
  expect(()=>x.store.linkWork(record.id,record.revision,work.kind,work.id,work.version)).toThrow('audit failed');expect(x.store.workLinks()).toEqual([]);expect(x.store.record(record.id).revision).toBe(1);
  x.store.db.exec('DROP TRIGGER reject_work_history');x.store.linkWork(record.id,record.revision,work.kind,work.id,work.version);
  const reopened=new DcrStore(x.root,x.reader);try{expect(reopened.workLinks()).toHaveLength(1);expect(reopened.workLinks()[0].work?.owner).toContain('Jordan');}finally{reopened.db.close();}
});
it('enforces preview versions and stale link checks through authenticated staging HTTP routes',async()=>{
  const root=mkdtempSync(join(tmpdir(),'dcr-connect-http-'));cleanup.push(()=>rmSync(root,{recursive:true,force:true}));const dist=join(root,'dist');mkdirSync(dist);writeFileSync(join(dist,'index.html'),'staging');
  const x=startDcrStage(root,dist,0);await once(x.server,'listening');cleanup.push(()=>{x.server.closeAllConnections();x.server.close();x.store.db.close();});
  const url=`http://127.0.0.1:${(x.server.address() as {port:number}).port}`,cookie=(await fetch(url+'/dcr')).headers.get('set-cookie')!.split(';')[0];
  const post=(path:string,body:unknown)=>fetch(url+'/api/dcr/'+path,{method:'POST',headers:{cookie,origin:url,'Content-Type':'application/json'},body:JSON.stringify(body)});
  expect((await fetch(url+'/api/dcr/connections')).status).toBe(401);
  const preview=await (await post('artifacts/preview',{id:'att-1'})).json();expect(preview.text).toContain('Fictional');expect((await post('artifacts/select',{id:'att-1',version:'outdated'})).status).toBe(409);
  expect((await post('artifacts/select',preview)).status).toBe(200);expect((await post('artifacts/preview',{id:'/etc/passwd'})).status).toBe(409);
  const work=x.store.connections!.work('task','t_dcr_sample_metrics')!,record=x.store.records().find(r=>r.kind==='commitment')!;
  const body={recordId:record.id,revision:record.revision,kind:work.kind,id:work.id,version:work.version};expect((await post('work-links',body)).status).toBe(200);expect((await post('work-links',body)).status).toBe(409);
  const prepared=await (await post('prepare',{recordId:record.id,revision:x.store.record(record.id).revision,body:'Review the reported work.'})).json();
  const envelope=x.store.db.prepare('SELECT body FROM tasks WHERE id=?').get(prepared.id)!;
  const sourceDb=new DatabaseSync(join(root,'connection-fixtures','kanban.db'));sourceDb.prepare("UPDATE tasks SET status='blocked' WHERE id=?").run(work.id);sourceDb.close();
  expect((await post('decide',{id:prepared.id,decision:'approved',reviewVersion:String(envelope.body)})).status).toBe(409);
  expect((await post('decide',{id:prepared.id,decision:'rejected',reviewVersion:String(envelope.body)})).status).toBe(200);
  unlinkSync(join(root,'connection-fixtures','attachments','northstar-pilot-brief.txt'));
  const snapshot=await (await fetch(url+'/api/dcr',{headers:{cookie}})).json();expect(snapshot.sources.some((s:{artifact?:unknown})=>s.artifact)).toBe(false);expect(snapshot.workLinks).toHaveLength(1);
});
it('keeps selected source and work IDs resolvable when newer records fill the catalog window',()=>{
 const x=sourceRecord();for(let n=2;n<104;n++){
  x.db.prepare('INSERT INTO task_attachments VALUES(?,?,?,?,?,?,?)').run(n,'t_new','new.txt',x.path,'text/plain',20,n);
  x.db.prepare('INSERT INTO tasks VALUES(?,?,?,?,?,?)').run('t_new_'+n,'New task','todo',null,'',n);
 }
 expect(x.reader.catalog().artifacts).toHaveLength(100);expect(x.reader.catalog().artifacts.some(a=>a.id==='att-1')).toBe(false);
 expect(x.store.availableSources()).toHaveLength(1);expect(x.reader.work('task','t_dcr_sample_metrics')?.status).toBe('done');
});
it('provides selected work as attributed, exact-quote reports while keeping validity tokens internal',async()=>{
 const x=setup(),record=x.store.save(draft),work=x.reader.work('task','t_dcr_sample_metrics')!;x.store.linkWork(record.id,record.revision,work.kind,work.id,work.version);
 const request=x.store.begin('What progress is reported?',record.id,[]);
 const fetcher=vi.fn(async(_url:unknown,options?:RequestInit)=>{
  const body=JSON.parse(String(options?.body)),context=JSON.parse(body.messages[1].content).context;
  expect(context.work).toBeUndefined();expect(context.sources).toHaveLength(1);expect(context.sources[0]).toMatchObject({id:'work:task:'+work.id,title:expect.stringContaining('Linked agent task report'),text:expect.stringContaining(work.summary)});
  return Response.json({choices:[{message:{content:JSON.stringify({reply:'The task reports a draft; acceptance is still unknown.',citations:[{sourceId:'work:task:'+work.id,quote:work.summary}],suggestions:[]})}}]});
 });
 await runDcrConversation(x.store,request.id,'test',fetcher as typeof fetch);expect(x.store.request(request.id).state).toBe('complete');
});
it('resolves model excerpt references to exact server-owned text instead of model-written quotations',async()=>{
 const x=sourceRecord(),work=x.reader.work('human','hd_dcr_sample_review')!;x.store.linkWork(x.record.id,x.record.revision,work.kind,work.id,work.version);
 const request=x.store.begin('What does the evidence say?',x.record.id,[]);
 const fetcher=vi.fn(async(_url:unknown,options?:RequestInit)=>{
  const context=JSON.parse(JSON.parse(String(options?.body)).messages[1].content).context;
  const report=context.sources.find((s:{id:string})=>s.id==='work:human:'+work.id),excerpt=report.excerpts.find((e:{quote:string})=>e.quote==='Reported status: in_progress');
  expect(excerpt).toBeTruthy();return Response.json({choices:[{message:{content:JSON.stringify({reply:'The HI delegation reports work in progress.',citations:[{sourceId:report.id,excerptId:excerpt.id}],suggestions:[]})}}]});
 });
 await runDcrConversation(x.store,request.id,'test',fetcher as typeof fetch);expect(x.store.request(request.id).answer?.citations).toEqual([{sourceId:'work:human:'+work.id,quote:'Reported status: in_progress'}]);
});
it('rejects invented excerpt references rather than falling back to fabricated text',async()=>{
 const x=sourceRecord(),request=x.store.begin('Question',x.record.id,[]);
 const fetcher=vi.fn(async()=>Response.json({choices:[{message:{content:JSON.stringify({reply:'Invented answer',citations:[{sourceId:x.source.id,excerptId:'e9999',quote:'Made up'}],suggestions:[]})}}]}));
 await runDcrConversation(x.store,request.id,'test',fetcher as typeof fetch);expect(x.store.request(request.id).state).toBe('failed');expect(x.store.request(request.id).error).toContain('reference could not be verified');expect(x.store.record(x.record.id).revision).toBe(1);
});
