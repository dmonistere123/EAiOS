import { shareableTaskCsv } from '../domain/planner';
// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { PlannerStore, type SyntheticBundle } from '../../server/plannerStore';
import { createPlannerPreview } from '../../server/plannerPreview';
import { emptyJournal, shiftDay, validPlannerDate, type Task } from '../domain/planner';

const day='2026-11-23',next='2026-11-24';
const sample=(f:(s:PlannerStore,root:string)=>void)=>{
 const root=mkdtempSync(join(tmpdir(),'2ep-planner-test-'));
 try{f(new PlannerStore(root),root);}finally{rmSync(root,{recursive:true,force:true});}
};
const run=(store:PlannerStore,a:Record<string,unknown>,owner='executive')=>store.act(owner,{requestId:randomUUID(),...a});
const create=(s:PlannerStore,b:Record<string,unknown>={})=>run(s,{op:'create',day,lane:'one',title:'Plan revenue review',...b}) as Task;
const unique=(n:number)=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
describe('2EP-owned Planner',()=>{
 it('isolates records, files, journals and time; Today retrieves only summary fields',()=>sample((s,root)=>{
  const t=create(s,{detail:'private task note'});
  const file=s.upload('executive',t.id,unique(9),'sample.txt',Buffer.from('test bytes'));
  const c=run(s,{op:'client',name:'Sample client'}) as {id:string};
  run(s,{op:'time',day,clientId:c.id,started:'09:00:00',ended:'09:30:01',timezone:'America/Chicago'});
  run(s,{op:'journal',day,...emptyJournal(),notes:'Private journal'});
  const reopened=new PlannerStore(root);
  expect(reopened.day('executive',day).tasks).toHaveLength(1);
  expect(reopened.day('executive',day).journal.notes).toBe('Private journal');
  expect(reopened.day('executive',day).time[0].seconds).toBe(1801);
  expect(reopened.summary('executive',day)).toEqual({one:{title:t.title,state:'not_started'},three:{done:0,total:0},five:{done:0,total:0}});
  expect(reopened.day('second-user',day)).toEqual({tasks:[],previouslyPlaced:[],previousOpen:undefined,scheduled:[],files:{},delegations:{},journal:emptyJournal(),time:[],clients:[]});
  expect(()=>reopened.file('second-user',file.id)).toThrow('Record not found');
  expect(()=>reopened.history('second-user',t.id)).toThrow('Record not found');
  expect(()=>run(reopened,{op:'state',id:t.id,revision:t.revision,state:'done'},'second-user')).toThrow('Record not found');
  expect(Buffer.from(reopened.file('executive',file.id).bytes).toString()).toBe('test bytes');
 }));
 it('autosaves ECP-style journal fields without overwriting timestamped notes or conflicting tab edits',()=>sample(s=>{
  run(s,{op:'journal-add',day,text:'First private note'});
  run(s,{op:'journal-patch',day,baseline:{gratitude:'',rating:null},patch:{gratitude:'  Saved as typed  ',rating:'great'}});
  run(s,{op:'journal-patch',day,baseline:{hits:[]},patch:{hits:['Pray']}});
  expect(()=>run(s,{op:'journal-patch',day,baseline:{rating:null},patch:{rating:'good'}})).toThrow('another tab');
  expect(s.day('executive',day).journal).toMatchObject({gratitude:'  Saved as typed  ',rating:'great',hits:['Pray'],entries:[{text:'First private note'}]});
  expect(s.day('second-user',day).journal.rating).toBe(null);
 }));
 it('creates one private occurrence per day and clamps monthly repeats to month end',()=>sample(s=>{
  const t=create(s,{title:'Recurring task',detail:'Original task notes'});
  run(s,{op:'edit',id:t.id,revision:t.revision,title:t.title,detail:t.detail,repeatKind:'monthly',repeatStartsOn:'2027-01-31',repeatEndsOn:'2027-03-01'});
  const row=s.day('executive','2027-02-28').tasks[0];
  expect(row).toMatchObject({title:t.title,lane:'backlog',due:'2027-02-28',state:'not_started',occurrence:{sourceId:t.id,day:'2027-02-28'}});
  expect(s.day('executive','2027-02-28').tasks.map(x=>x.id)).toEqual([row.id]);
  expect(s.day('executive','2027-02-27').tasks).toEqual([]);
  expect(s.day('executive','2027-03-31').tasks).toEqual([]);
  expect(s.day('second-user','2027-02-28').tasks).toEqual([]);
 }));
 it('reports the most recent open plan and scheduled tasks without exposing them to another owner',()=>sample(s=>{
  const old=create(s,{day:'2026-10-10',lane:'backlog'});
  const upcoming=create(s,{day:'2026-12-11',lane:'backlog'});
  const target='2026-10-13';
  expect(s.day('executive',target)).toMatchObject({previousOpen:{day:old.day,count:1},scheduled:[{id:upcoming.id}]});
  expect(s.day('second-user',target)).toMatchObject({scheduled:[]});
  run(s,{op:'carry',from:old.day,to:target});
  expect(s.day('executive',target).previousOpen).toBeUndefined();
  expect(s.day('executive',target).tasks.map(t=>t.id)).toEqual([old.id]);
 }));
 it('exports only explicitly shareable fields and protects CSV cells from spreadsheet execution',()=>sample(s=>{
  create(s,{title:'Private task title',lane:'backlog'});
  const t=create(s,{title:'=1+1',detail:'private task notes',lane:'backlog'});
  run(s,{op:'edit',id:t.id,revision:t.revision,title:t.title,detail:t.detail,shareable:true,repeatKind:'none'});
  const csv=shareableTaskCsv(day,s.day('executive',day).tasks);
  expect(csv).toContain('"\'=1+1"');
  expect(csv).not.toContain('Private task title');
  expect(csv).not.toContain('private task notes');
 }));
 it('archives prior-year plans without deleting records or affecting another owner',()=>sample(s=>{
  const archived=create(s,{day:'2025-10-09',lane:'backlog'});
  run(s,{op:'create',title:'Another owner',day:archived.day,lane:'backlog'},'second-user');
  run(s,{op:'journal-add',day:archived.day,text:'Retained note'});
  run(s,{op:'archive-year',year:2025});
  expect(s.ranges('executive',day,'history')).not.toContain(archived.day);
  expect(s.ranges('executive',day,'archived-days')).toContain(archived.day);
  expect(s.ranges('second-user',day,'history')).toContain(archived.day);
  expect(s.day('executive',archived.day).journal.entries).toMatchObject([{text:'Retained note'}]);
  expect(s.day('executive',archived.day).tasks[0].id).toBe(archived.id);
 }));
 it('requires explicit replacement and prevents stale overwrites',()=>sample(s=>{
  const t=create(s);
  expect(()=>create(s,{title:'Another priority'})).toThrow('lane is full');
  const b=create(s,{title:'Another priority',replacement:t.id});
  expect(s.day('executive',day).tasks.map(t=>[t.id,t.lane])).toEqual(expect.arrayContaining([[t.id,'backlog'],[b.id,'one']]));
  expect(()=>run(s,{op:'edit',id:t.id,revision:t.revision,title:'out of date'})).toThrow('another tab');
 }));
 it('persists exactly one carry-forward and keeps earlier placement accessible',()=>sample(s=>{
  const t=create(s);
  create(s,{day:next,title:'Priority already selected'});
  expect(run(s,{op:'carry',from:day,to:next})).toEqual({moved:1,backlog:1});
  expect(run(s,{op:'carry',from:day,to:next})).toEqual({moved:0,backlog:0});
  expect(s.day('executive',next).tasks.find(x=>x.id===t.id)).toMatchObject({lane:'backlog',carryAge:1});
  expect(s.day('executive',day).previouslyPlaced[0].id).toBe(t.id);
  expect(s.ranges('executive',next,'history')).toEqual([day]);
 }));
 it('rolls back a failed follow-up and deduplicates a successful one',()=>sample(s=>{
  const t=create(s);create(s,{day:next});
  const command={op:'follow',id:t.id,revision:t.revision,day:next,lane:'one'};
  expect(()=>run(s,command)).toThrow('lane is full');
  expect(s.day('executive',day).tasks[0].state).toBe('not_started');
  const requestId=randomUUID(),saved={...command,lane:'backlog',requestId};
  const f=s.act('executive',saved) as Task;
  expect(s.act('executive',saved)).toEqual(f);
  expect(()=>run(s,{...saved,requestId:randomUUID()})).toThrow('another tab');
  expect(s.day('executive',day).tasks[0].state).toBe('done');
  expect((s.ranges('executive',day,'upcoming') as Task[]).filter(t=>t.parentId)).toEqual([f]);
 }));
 it('archives and restores without losing bytes or history',()=>sample(s=>{
  const t=create(s);
  const f=s.upload('executive',t.id,unique(12),'report.txt',Buffer.from('private'));
  run(s,{op:'archive',id:t.id,revision:t.revision});
  expect(s.day('executive',day).tasks).toEqual([]);
  const archived=(s.ranges('executive',day,'archive') as Task[])[0];
  run(s,{op:'restore',id:t.id,revision:archived.revision,lane:'backlog'});
  expect(s.day('executive',day).files[t.id][0].sha256).toBe(f.sha256);
  expect(s.history('executive',t.id).map(x=>x.event)).toEqual(['restored','archived','created']);
 }));
 it('requires owner review to complete one simulated delegation and shares only selected context',()=>sample(s=>{
  const t=create(s,{detail:'not included'});
  const action={op:'delegate',id:t.id,revision:t.revision,recipient:'ally',objective:'Compare options',expected:'Short recommendation'};
  const w=run(s,action) as {id:string;context:string[];fileNames:string[]};
  expect(w.context).toEqual([t.title]);expect(w.fileNames).toEqual([]);
  expect(run(s,action)).toEqual(w);
  expect(()=>run(s,{op:'state',id:t.id,revision:t.revision,state:'done'})).toThrow('Review the delegated result');
  run(s,{op:'mock-deliver',id:t.id,revision:t.revision,workId:w.id});
  expect(s.day('executive',day).tasks[0].state).toBe('not_started');
  run(s,{op:'delegate-decide',id:t.id,revision:t.revision,workId:w.id,accept:false});
  expect(s.day('executive',day).tasks[0].state).toBe('not_started');
  const w2=run(s,{...action,recipient:'human'}) as {id:string};
  run(s,{op:'mock-deliver',id:t.id,revision:t.revision,workId:w2.id});
  run(s,{op:'delegate-decide',id:t.id,revision:t.revision,workId:w2.id,accept:true});
  expect(s.day('executive',day).tasks[0].state).toBe('done');
 }));
 it('keeps historical client names and exact seconds, handles Central dates around DST',()=>sample(s=>{
  expect(shiftDay('2026-03-08',1)).toBe('2026-03-09');
  expect(validPlannerDate('2026-02-29')).toBe(false);
  const c=run(s,{op:'client',name:'Old name'}) as {id:string};
  const a={op:'time',clientId:c.id,timezone:'America/Chicago'};
  expect(()=>run(s,{...a,day:'2026-03-08',started:'02:00',ended:'04:00'})).toThrow('skipped');
  expect(()=>run(s,{...a,day:'2026-11-01',started:'01:15',ended:'03:00'})).toThrow('occurs twice');
  expect(run(s,{...a,day:'2026-03-08',started:'01:59:59',ended:'03:00:01'})).toMatchObject({seconds:2});
  run(s,{op:'client',id:c.id,name:'New name'});
  expect(s.ranges('executive','2026-03-05','time')).toEqual([expect.objectContaining({clientName:'Old name',seconds:2})]);
 }));
 it('rehearses a one-time import, rolled-back failure, receipt checks and restore',()=>sample((s,root)=>{
  const packet: SyntheticBundle={
   format:'ecp-planner-synthetic-v1',fixtureId:'sample-fixture',sourceOwner:'sample-ecp-owner',
   tasks:[1,2].map((n):Task=>({id:unique(n),title:'Synthetic task '+n,day:n===1?day:next,detail:'',due:'',lane:'one',rank:1,state:n===1?'done':'not_started',archived:false,parentId:n===1?null:unique(1),source:null,createdAt:'2026-11-23T15:00:00.000Z',carryAge:0,revision:1})),
   dayJournals:[{day,journal:{...emptyJournal(),notes:'Fixture only'}}],
   clients:[{id:unique(3),name:'Current name'}],
   timeEntries:[{id:unique(4),clientId:unique(3),clientName:'Historical name',day,started:'09:00:00',ended:'09:03:02',seconds:182,notes:'Fixture only',timezone:'America/Chicago'}],
   files:[{id:unique(5),taskId:unique(1),name:'sample.txt',bytes:Buffer.from('fixture').toString('base64'),sha256:createHash('sha256').update('fixture').digest('hex')}],
  };
  const dry=s.rehearseImport('executive',packet);
  expect(dry).toMatchObject({count:{tasks:2,journals:1,clients:1,timeEntries:1,files:1},monthlySeconds:{'2026-11':182},checksums:{[unique(5)]:packet.files[0].sha256}});
  expect(s.day('executive',day).tasks).toHaveLength(0);
  expect(()=>s.rehearseImport('executive',{...packet,files:[{...packet.files[0],sha256:'wrong'}]},false)).toThrow('checksum');
  expect(s.day('executive',day).tasks).toHaveLength(0);
  expect(s.rehearseImport('executive',packet,false)).toEqual(dry);
  expect(s.rehearseImport('executive',packet,false).alreadyApplied).toBe(true);
  expect(s.day('executive',next).tasks[0].parentId).toBe(unique(1));
  expect(s.day('second-user',day).tasks).toHaveLength(0);
  mkdirSync(join(root,'restore','planner-data'),{recursive:true});
  copyFileSync(join(root,'planner-data','planner.db'),join(root,'restore','planner-data','planner.db'));
  const back=new PlannerStore(join(root,'restore'));
  expect(back.day('executive',day).time[0]).toMatchObject({clientName:'Historical name',seconds:182});
  expect(Buffer.from(back.file('executive',unique(5)).bytes).toString()).toBe('fixture');
 }));
 it('enforces server-side sessions, source permission, deduplication and origin independently of the browser',async()=>{
  const root=mkdtempSync(join(tmpdir(),'2ep-planner-http-'));
  let handler:ReturnType<typeof createPlannerPreview>;
  const server=createServer((req,res)=>void handler(req,res,()=>{res.statusCode=404;res.end();}));
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
  try{
   const address=server.address();if(!address||typeof address==='string')throw Error();
   const origin='http://127.0.0.1:'+address.port,api=origin+'/api/daily-planner';
   handler=createPlannerPreview(root,origin);
   const secrets=JSON.parse(readFileSync(join(root,'preview-access.json'),'utf8'));
   const login=async (account:string)=>(await fetch(api+'/session',{method:'POST',headers:{'Content-Type':'application/json',Origin:origin},body:JSON.stringify({passcode:secrets[account]})})).headers.get('set-cookie')!.split(';')[0];
   expect((await fetch(api+'/day?on='+day)).status).toBe(401);
   expect((await fetch(api+'/session',{method:'POST',headers:{'Content-Type':'application/json',Origin:'https://example.test'},body:'{}'})).status).toBe(403);
   const a=await login('executive'),b=await login('second-user');
   const source={op:'crm',contactId:'preview-contact-01',noteId:'preview-note-01',day,lane:'three'};
   const add=(cookie:string)=>fetch(api+'/actions',{method:'POST',headers:{cookie,Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({...source,requestId:randomUUID()})});
   expect((await add(b)).status).toBe(404);
   const one=await (await add(a)).json() as Task,two=await (await add(a)).json() as Task;
   expect(one.id).toBe(two.id);expect(one.source).toMatchObject({noteId:'preview-note-01'});expect(one.detail).toBe('');
   const exact=origin+'/api/erm/contacts/'+source.contactId+'/notes/'+source.noteId;
   expect((await fetch(exact,{headers:{cookie:a}})).status).toBe(200);
   expect((await fetch(exact,{headers:{cookie:b}})).status).toBe(404);
   expect((await fetch(exact,{method:'PATCH',headers:{cookie:a,Origin:origin}})).status).toBe(403);
   expect(await (await fetch(origin+'/api/erm/follow-ups',{headers:{cookie:a}})).json()).toMatchObject({total:1});
   expect((await fetch(api+'/session',{method:'DELETE',headers:{cookie:a,Origin:origin}})).status).toBe(200);
   expect((await fetch(api+'/summary?on='+day,{headers:{cookie:a}})).status).toBe(401);
  }finally{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));rmSync(root,{recursive:true,force:true});}
 });
});
