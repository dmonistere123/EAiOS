// @vitest-environment node
import {afterEach,expect,it,vi} from 'vitest';
import {createServer,request as httpRequest} from 'node:http';
import {once} from 'node:events';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync,existsSync,statSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {DatabaseSync} from 'node:sqlite';
import {handleApiRequest} from '../../server/httpApi.ts';
import {productionDcrStore,closeProductionDcrStores,checkDcrApproval} from '../../server/dcrProduction.ts';
import {decideReplyApproval} from '../../server/mailReplies.ts';
import {moduleConfig} from '../../server/modules.ts';
import {DcrScannerStore} from '../../server/dcrScannerStore.ts';
import {DcrStore} from '../../server/dcrStore.ts';
import {blankDcr} from '../domain/dcr';
const clean:(()=>void)[]=[];
afterEach(()=>{closeProductionDcrStores();clean.splice(0).reverse().forEach(fn=>fn());vi.restoreAllMocks();});
const fields={...blankDcr(),title:'Confirm the measures',what:'Get acceptance.',why:'Agree on success.'};
async function setup(enabled=true){
 const root=mkdtempSync(join(tmpdir(),'dcr-prod-'));clean.push(()=>rmSync(root,{recursive:true,force:true}));
 const ctx={hermesHome:join(root,'hermes'),eaiosRoot:join(root,'code'),dataRoot:join(root,'data')};
 const attachments=join(ctx.hermesHome,'kanban','attachments');mkdirSync(attachments,{recursive:true});mkdirSync(join(ctx.hermesHome,'eaios'),{recursive:true});mkdirSync(join(ctx.eaiosRoot,'app'),{recursive:true});mkdirSync(ctx.dataRoot);
 writeFileSync(join(ctx.eaiosRoot,'app','.env.local'),'VITE_AGENT_NAME="Pepper"\n');
 const db=new DatabaseSync(join(ctx.hermesHome,'kanban.db'));clean.push(()=>db.close());
 db.exec(`CREATE TABLE tasks(id TEXT PRIMARY KEY,title TEXT NOT NULL,body TEXT,status TEXT,assignee TEXT,result TEXT,created_by TEXT,created_at INTEGER,claim_lock TEXT,current_run_id INTEGER);
 CREATE TABLE task_attachments(id INTEGER PRIMARY KEY,task_id TEXT,filename TEXT,stored_path TEXT,content_type TEXT,created_at INTEGER);
 CREATE TABLE task_events(task_id TEXT,kind TEXT,payload TEXT,created_at INTEGER);
 CREATE TABLE task_links(parent_id TEXT,child_id TEXT);`);
 const file=join(attachments,'note.txt');writeFileSync(file,'The executive promised to confirm the measures.');db.prepare("INSERT INTO tasks(id,title,status,result,created_at) VALUES('t_source','Draft measures','done','Draft prepared',1)").run();
 db.prepare('INSERT INTO task_attachments VALUES(1,?,?,?,?,1)').run('t_source','note.txt',file,'text/plain');
 const human=new DatabaseSync(join(ctx.hermesHome,'eaios','human-delegation.db'));human.exec('CREATE TABLE human_contacts(id TEXT,body TEXT);CREATE TABLE human_delegations(id TEXT,contact_id TEXT,body TEXT);');human.close();
 const server=createServer((req,res)=>{void handleApiRequest(req,res,ctx).then(handled=>{if(!handled){res.statusCode=404;res.end();}});});server.listen(0,'127.0.0.1');await once(server,'listening');clean.push(()=>{server.closeAllConnections();server.close();});
 const url=`http://127.0.0.1:${(server.address() as {port:number}).port}`,policy=join(ctx.dataRoot,'dcr.local.json');
 if(enabled)writeFileSync(policy,JSON.stringify({enabled:true,principal:'executive',origins:[url],allowAi:false}));
 const post=(path:string,input:unknown,extra:Record<string,string>={})=>fetch(url+'/api/dcr'+path,{method:'POST',headers:{'Content-Type':'application/json',origin:url,...extra},body:JSON.stringify(input)});
 return {ctx,db,url,policy,post,file};
}
it('launches an empty production workspace with box identity and real source adapters, never fixtures',async()=>{
 const x=await setup(),s=await (await fetch(x.url+'/api/dcr')).json();expect(s).toMatchObject({staging:false,records:[],sources:[],requests:[],assistantName:'Pepper',aiAvailable:false,followUps:[]});
 const catalog=await (await fetch(x.url+'/api/dcr/connections')).json();expect(catalog.artifacts[0].title).toBe('note.txt');expect(catalog.label).toContain('Your saved');
 expect(existsSync(join(x.ctx.hermesHome,'eaios','dcr','connection-fixtures'))).toBe(false);expect(statSync(join(x.ctx.hermesHome,'eaios','dcr','kanban.db')).mode&0o777).toBe(0o600);
 expect(moduleConfig(x.ctx.dataRoot).enabled).toContain('dcr');
});
it('fails closed for disabled policy, foreign origins and unsupported mutation types',async()=>{
 const x=await setup(false);expect((await fetch(x.url+'/api/dcr')).status).toBe(403);expect(moduleConfig(x.ctx.dataRoot).enabled).not.toContain('dcr');expect(existsSync(join(x.ctx.hermesHome,'eaios','dcr'))).toBe(false);
 writeFileSync(x.policy,JSON.stringify({enabled:true,principal:'executive',origins:[x.url]}));
 expect((await x.post('/records',{fields},{origin:'https://foreign.test'})).status).toBe(403);
 const foreignHostStatus=await new Promise<number|undefined>((resolve,reject)=>{const req=httpRequest(x.url+'/api/dcr',{headers:{host:'foreign.test'}},res=>{res.resume();resolve(res.statusCode);});req.on('error',reject);req.end();});expect(foreignHostStatus).toBe(403);
 expect((await fetch(x.url+'/api/dcr',{headers:{'sec-fetch-site':'cross-site'}})).status).toBe(403);
 expect((await x.post('/records',{fields},{'Content-Type':'text/plain'})).status).toBe(403);
});
it('persists explicit records and selected real Artifacts without altering source work',async()=>{
 const x=await setup(),preview=await (await x.post('/artifacts/preview',{id:'att-1'})).json();
 const source=await (await x.post('/artifacts/select',preview)).json();expect(source.fixture).toBe(false);
 const record=await (await x.post('/records',{fields,sourceIds:[source.id],linkedIds:[]})).json();expect(record.revision).toBe(1);
 expect(x.db.prepare('SELECT count(*) AS n FROM tasks').get()!.n).toBe(1);
 closeProductionDcrStores();const s=await (await fetch(x.url+'/api/dcr')).json();expect(s.records[0].id).toBe(record.id);
 writeFileSync(x.file,'Changed source');expect((await (await fetch(x.url+'/api/dcr')).json()).sources).toEqual([]);
 expect((await x.post('/prepare',{recordId:record.id,revision:1,body:'Follow up'})).status).toBe(409);
});
it('creates an unassigned blocked approval once and requires mailbox binding before any send',async()=>{
 const x=await setup(),record=await (await x.post('/records',{fields})).json(),input={recordId:record.id,revision:record.revision,body:'Please confirm the measures.'};
 const prepared=await (await x.post('/prepare',input)).json();expect((await (await x.post('/prepare',input)).json()).id).toBe(prepared.id);
 const row=x.db.prepare('SELECT * FROM tasks WHERE id=?').get(prepared.id)!;expect(row.status).toBe('blocked');expect(row.assignee).toBeNull();const env=JSON.parse(String(row.body));expect(env.dcrStaging).toBeUndefined();expect(env.mailReply).toBeUndefined();expect(env.payload).toBe(input.body);
 const provider={verify:vi.fn(),source:vi.fn(),send:vi.fn()};await expect(decideReplyApproval(x.ctx,prepared.id,{decision:'approved',expectedBody:row.body},provider)).rejects.toThrow('originating mailbox');expect(provider.send).not.toHaveBeenCalled();
 const snapshot=await (await fetch(x.url+'/api/dcr')).json();expect(snapshot.followUps[0]).toMatchObject({id:prepared.id,status:'pending'});expect(snapshot.records[0].status).toBe('open');
});
it('blocks DCR approval execution when the record, work or enablement changes',async()=>{
 const x=await setup(),store=productionDcrStore(x.ctx),record=store.save(fields),work=store.connections!.work('task','t_source')!;
 const linked=store.linkWork(record.id,record.revision,work.kind,work.id,work.version);
 const {id}=await (await x.post('/prepare',{recordId:record.id,revision:linked.revision,body:'Review the draft'})).json();const env=JSON.parse(String(x.db.prepare('SELECT body FROM tasks WHERE id=?').get(id)!.body));
 expect(()=>checkDcrApproval(x.ctx,env)).not.toThrow();x.db.prepare("UPDATE tasks SET result='Changed result' WHERE id='t_source'").run();expect(()=>checkDcrApproval(x.ctx,env)).toThrow('Linked work changed');
 store.save({...fields,why:'A changed reason'},record.id,linked.revision);expect(()=>checkDcrApproval(x.ctx,env)).toThrow('record changed');
 writeFileSync(x.policy,'{}');expect(()=>checkDcrApproval(x.ctx,env)).toThrow('disabled');
});
it('does not cancel another listener’s active request and refuses unconfigured AI',async()=>{
 const x=await setup(),store=productionDcrStore(x.ctx),record=store.save(fields),request=store.begin('Question',record.id,[]);
 const second=new DcrStore(join(x.ctx.hermesHome,'eaios','dcr'),store.connections,{production:true});try{expect(second.request(request.id).state).toBe('running');}finally{second.db.close();}
 expect((await x.post('/ask',{prompt:'Question',recordId:record.id})).status).toBe(503);
});

it('uses the existing Hermes provider configuration without exposing its key',async()=>{
 const x=await setup();writeFileSync(join(x.ctx.hermesHome,'.env'),'OPENROUTER_API_KEY=fixture-private-token\n');writeFileSync(x.policy,JSON.stringify({enabled:true,principal:'executive',origins:[x.url],allowAi:true}));
 const response=await fetch(x.url+'/api/dcr'),body=await response.text();expect(JSON.parse(body).aiAvailable).toBe(true);expect(body).not.toContain('fixture-private-token');
});

it('returns collected relationship sources with the saved record without exposing unrelated queued mail',async()=>{
 const x=await setup(),store=productionDcrStore(x.ctx),scanner=new DcrScannerStore(store);
 const quote='We should review the customer planning and budget constraints together before agreeing the next steps.';
 const relationship={...blankDcr('relationship'),title:'Jeff Mitchell',personName:'Jeff Mitchell',email:'jeff@example.test',organization:'Example',what:'Coordinate planning',why:'Maintain alignment',recommendation:'Discuss the planning constraints'};
 const record=store.save(relationship);const before=store.records();
 for(const id of ['relevant','unrelated'])scanner.ingest({key:id,version:'1',title:id,text:quote,origin:{kind:'sent',externalId:id,observedAt:'2026-11-14T15:00:00Z'}});
 const source=store.sources().find(s=>s.title==='relevant')!;
 scanner.saveFindings([{fields:relationship,explanation:'Substantive planning exchange',citations:[{sourceId:source.id,quote}]}],[source.id]);
 const snapshot=await (await fetch(x.url+'/api/dcr')).json();expect(snapshot.scanner.findings).toEqual([]);expect(snapshot.scanner.relationshipEvidence[0]).toMatchObject({recordId:record.id,sourceIds:[source.id]});expect(snapshot.sources.map((s:any)=>s.id)).toEqual([source.id]);expect(snapshot.records).toEqual(before);
});
