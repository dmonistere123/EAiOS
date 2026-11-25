import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, chmodSync, lstatSync } from 'node:fs';
import { join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { dayRatings, emptyJournal, lanes, limits, quickHits, recurrenceMatches, validPlannerDate } from '../src/domain/planner.ts';
import type { Attachment, Client, DayPlan, Journal, Lane, PlanSummary, PreviewDelegation, RepeatRule, Task, TaskSource, TaskState, TimeEntry } from '../src/domain/planner.ts';

export class PlannerError extends Error {
  status:number;
  constructor(status:number,message:string){super(message);this.status=status;}
}
type Body={body:string};
const parse=<T>(r:unknown)=>JSON.parse((r as Body).body) as T;
const id=()=>randomUUID();
const stamp=()=>new Date().toISOString();
const digest=(s:string|Uint8Array)=>createHash('sha256').update(s).digest('hex');
const invalid=(message:string):never=>{throw new PlannerError(400,message);};
const absent=():never=>{throw new PlannerError(404,'Record not found.');};
function line(s:unknown,max:number,required=false):string {
 if(typeof s!=='string'||s.length>max||(required&&!s.trim()))return invalid('Check the required fields and their lengths.');
 return s.trim();
}
function date(s:unknown):string {if(!validPlannerDate(s))return invalid('Choose a valid date.');return s;}
function lane(s:unknown):Lane {if(!lanes.includes(s as Lane))return invalid('Choose a valid planning lane.');return s as Lane;}
function safeEntry(path:string,dir=false){try{const info=lstatSync(path);if(info.isSymbolicLink()||!(dir?info.isDirectory():info.isFile()))throw new PlannerError(503,'Planner storage is unavailable.');}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}}

export type SyntheticBundle={
 format:'ecp-planner-synthetic-v1'; fixtureId:string; sourceOwner:'sample-ecp-owner';
 tasks:Task[]; dayJournals:{day:string;journal:Journal}[]; clients:Client[]; timeEntries:TimeEntry[];
 files:{id:string;taskId:string;name:string;sha256:string;bytes:string}[];
};
export class PlannerStore {
 root:string;
 constructor(root:string){this.root=root;}
 private transaction<T>(run:(db:DatabaseSync)=>T,dryRun=false):T{
  const dir=join(this.root,'planner-data'),file=join(dir,'planner.db');
  safeEntry(this.root,true);mkdirSync(this.root,{recursive:true,mode:0o700});
  safeEntry(dir,true);mkdirSync(dir,{mode:0o700,recursive:true});
  for(const p of [file,file+'-shm',file+'-wal',file+'-journal'])safeEntry(p);
  const db=new DatabaseSync(file);
  try {
   chmodSync(file,0o600);
   db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000; BEGIN IMMEDIATE;');
   try{
    const ver=(db.prepare('PRAGMA user_version').get() as {user_version:number}).user_version;
    if(ver===0)db.exec(`
      CREATE TABLE tasks(owner TEXT NOT NULL,id TEXT NOT NULL,day TEXT NOT NULL,body TEXT NOT NULL,PRIMARY KEY(owner,id));
      CREATE INDEX tasks_by_day ON tasks(owner,day);
      CREATE TABLE events(owner TEXT NOT NULL, task_id TEXT NOT NULL, event TEXT NOT NULL, at TEXT NOT NULL, body TEXT NOT NULL, FOREIGN KEY(owner,task_id) REFERENCES tasks(owner,id));
      CREATE INDEX events_by_task ON events(owner,task_id,at);
      CREATE TABLE journals(owner TEXT NOT NULL,day TEXT NOT NULL,body TEXT NOT NULL,PRIMARY KEY(owner,day));
      CREATE TABLE clients(owner TEXT NOT NULL,id TEXT NOT NULL,name_key TEXT NOT NULL,body TEXT NOT NULL,PRIMARY KEY(owner,id),UNIQUE(owner,name_key));
      CREATE TABLE time_entries(owner TEXT NOT NULL,id TEXT NOT NULL,day TEXT NOT NULL,client_id TEXT NOT NULL,body TEXT NOT NULL,PRIMARY KEY(owner,id),FOREIGN KEY(owner,client_id) REFERENCES clients(owner,id));
      CREATE INDEX time_by_day ON time_entries(owner,day);
      CREATE TABLE files(owner TEXT NOT NULL,id TEXT NOT NULL,task_id TEXT NOT NULL,name TEXT NOT NULL,sha TEXT NOT NULL,bytes BLOB NOT NULL,PRIMARY KEY(owner,id),FOREIGN KEY(owner,task_id) REFERENCES tasks(owner,id));
      CREATE TABLE requests(owner TEXT NOT NULL,id TEXT NOT NULL,hash TEXT NOT NULL,body TEXT NOT NULL,PRIMARY KEY(owner,id));
      CREATE TABLE crm_links(owner TEXT NOT NULL,note_id TEXT NOT NULL,task_id TEXT NOT NULL,PRIMARY KEY(owner,note_id),FOREIGN KEY(owner,task_id) REFERENCES tasks(owner,id));
      CREATE TABLE delegations(owner TEXT NOT NULL,task_id TEXT NOT NULL,body TEXT NOT NULL,PRIMARY KEY(owner,task_id),FOREIGN KEY(owner,task_id) REFERENCES tasks(owner,id));
      CREATE TABLE imports(owner TEXT NOT NULL,bundle_id TEXT NOT NULL,hash TEXT NOT NULL,body TEXT NOT NULL,PRIMARY KEY(owner,bundle_id));
      PRAGMA user_version=1;`);
    else if(ver!==1)throw new PlannerError(503,'Planner storage version is unavailable.');
    db.exec('CREATE TABLE IF NOT EXISTS archived_plan_years(owner TEXT NOT NULL,year INTEGER NOT NULL,PRIMARY KEY(owner,year));');
    const result=run(db);db.exec(dryRun?'ROLLBACK':'COMMIT');return result;
   }catch(e){db.exec('ROLLBACK');throw e;}
  }finally{db.close();}
 }
 private tasks(db:DatabaseSync,owner:string,day:string){return db.prepare('SELECT body FROM tasks WHERE owner=? AND day=?').all(owner,day).map(parse<Task>);}
 private task(db:DatabaseSync,owner:string,taskId:unknown){const r=db.prepare('SELECT body FROM tasks WHERE owner=? AND id=?').get(owner,line(taskId,80,true));return r?parse<Task>(r):absent();}
 private save(db:DatabaseSync,owner:string,t:Task,event:string) {
  db.prepare('INSERT INTO tasks VALUES (?,?,?,?) ON CONFLICT(owner,id) DO UPDATE SET day=excluded.day,body=excluded.body').run(owner,t.id,t.day,JSON.stringify(t));
  db.prepare('INSERT INTO events VALUES (?,?,?,?,?)').run(owner,t.id,event,stamp(),JSON.stringify(t));
  return t;
 }
 private placement(db:DatabaseSync,owner:string,t:Task,day:string,ln:Lane,replacement:unknown) {
  const others=this.tasks(db,owner,day).filter(o=>o.id!==t.id&&o.lane===ln&&!o.archived);
  const active=others.filter(o=>o.state!=='done');
  if(t.state!=='done'&&active.length>=limits[ln]){
   const demote=active.find(o=>o.id===replacement);
   if(!demote)throw new PlannerError(409,'That lane is full. Choose a task to move to Backlog, or select Backlog.');
   const rank=Math.max(0,...this.tasks(db,owner,day).filter(o=>o.lane==='backlog').map(o=>o.rank))+1;
   this.save(db,owner,{...demote,lane:'backlog',rank,revision:demote.revision+1},'replaced');
  }
  return {...t,day,lane:ln,rank:Math.max(0,...others.map(o=>o.rank))+1};
 }
 private recur(db:DatabaseSync,owner:string,day:string){
  const sources=db.prepare("SELECT body FROM tasks WHERE owner=? AND json_extract(body,'$.repeat') IS NOT NULL AND json_extract(body,'$.archived')=0").all(owner).map(parse<Task>);
  for(const source of sources){
   if(!source.repeat||source.occurrence||!recurrenceMatches(source.repeat,day))continue;
   const occurrenceId=digest('planner-recurrence:'+source.id+':'+day);
   if(db.prepare('SELECT 1 FROM tasks WHERE owner=? AND id=?').get(owner,occurrenceId))continue;
   const instance:Task={...source,id:occurrenceId,day,lane:'backlog',due:day,state:'not_started',archived:false,
    source:null,parentId:null,shareable:false,repeat:undefined,occurrence:{sourceId:source.id,day},rank:0,carryAge:0,revision:1,createdAt:stamp()};
   this.save(db,owner,this.placement(db,owner,instance,day,'backlog',undefined),'recurring occurrence');
  }
 }
 private readJournal(db:DatabaseSync,owner:string,day:string){const r=db.prepare('SELECT body FROM journals WHERE owner=? AND day=?').get(owner,day);return r?parse<Journal>(r):emptyJournal();}
 summary(owner:string,value:string):PlanSummary {
  return this.transaction(db=>{
   const tasks=this.tasks(db,owner,date(value)).filter(t=>!t.archived).sort((a,b)=>a.rank-b.rank);
   const one=tasks.find(t=>t.lane==='one'&&t.state!=='done')??tasks.find(t=>t.lane==='one');
   const progress=(lane:Lane)=>{const items=tasks.filter(t=>t.lane===lane);return {done:items.filter(t=>t.state==='done').length,total:items.length};};
   return {one:one?{title:one.title,state:one.state}:null,three:progress('three'),five:progress('five')};
  });
 }
 day(owner:string,value:string):DayPlan{
  return this.transaction(db=>{
   const day=date(value);
   this.recur(db,owner,day);
   const tasks=this.tasks(db,owner,day).filter(t=>!t.archived).sort((a,b)=>a.rank-b.rank),files:DayPlan['files']={};
   for(const t of tasks)files[t.id]=db.prepare('SELECT id,name,length(bytes) as size,sha as sha256 FROM files WHERE owner=? AND task_id=? ORDER BY name,id').all(owner,t.id) as unknown as Attachment[];
   const delegations:DayPlan['delegations']={};
   for(const t of tasks){const r=db.prepare('SELECT body FROM delegations WHERE owner=? AND task_id=?').get(owner,t.id);if(r)delegations[t.id]=parse<PreviewDelegation>(r);}
   const previouslyPlaced=db.prepare("SELECT body FROM events WHERE owner=? AND json_extract(body,'$.day')=? ORDER BY rowid DESC").all(owner,day).map(parse<Task>);
   const currentIds=new Set(this.tasks(db,owner,day).map(t=>t.id));
   const previous=[...new Map(previouslyPlaced.filter(t=>!currentIds.has(t.id)).reverse().map(t=>[t.id,t])).values()];
   const previousOpen=db.prepare("SELECT day, COUNT(*) AS count FROM tasks WHERE owner=? AND day<? AND json_extract(body,'$.archived')=0 AND json_extract(body,'$.state')<>'done' GROUP BY day ORDER BY day DESC LIMIT 1").get(owner,day) as DayPlan['previousOpen'];
   const scheduled=db.prepare("SELECT body FROM tasks WHERE owner=? AND day>? AND json_extract(body,'$.archived')=0 AND json_extract(body,'$.state')<>'done' ORDER BY day, id LIMIT 50").all(owner,day).map(parse<Task>);
   return {tasks,previouslyPlaced:previous,files,delegations,previousOpen,scheduled,journal:this.readJournal(db,owner,day),time:db.prepare('SELECT body FROM time_entries WHERE owner=? AND day=? ORDER BY json_extract(body,\'$.started\')').all(owner,day).map(parse<TimeEntry>),clients:db.prepare('SELECT body FROM clients WHERE owner=? ORDER BY name_key').all(owner).map(parse<Client>)};
  });
 }
 private historyDates(db:DatabaseSync,owner:string,before:string){
  return db.prepare('SELECT day FROM journals WHERE owner=? AND day<? UNION SELECT day FROM tasks WHERE owner=? AND day<? UNION SELECT day FROM time_entries WHERE owner=? AND day<? UNION SELECT json_extract(body,\'$.day\') as day FROM events WHERE owner=? AND json_extract(body,\'$.day\')<? ORDER BY day DESC')
    .all(owner,before,owner,before,owner,before,owner,before).map(r=>String(r.day));
 }
 ranges(owner:string,value:string,kind:string){
  return this.transaction(db=>{
   const day=date(value);
   if(kind==='history'||kind==='archived-days'){
    const years=new Set(db.prepare('SELECT year FROM archived_plan_years WHERE owner=?').all(owner).map(r=>String(r.year)));
    return this.historyDates(db,owner,day).filter(d=>years.has(d.slice(0,4))===(kind==='archived-days')).slice(0,366);
   }
   if(kind==='archive')return db.prepare("SELECT body FROM tasks WHERE owner=? AND json_extract(body,'$.archived')=1 ORDER BY day DESC LIMIT 500").all(owner).map(parse<Task>);
   if(kind==='upcoming')return db.prepare("SELECT body FROM tasks WHERE owner=? AND day>? AND json_extract(body,'$.archived')=0 ORDER BY day,id LIMIT 500").all(owner,day).map(parse<Task>);
   if(kind==='time')return db.prepare('SELECT body FROM time_entries WHERE owner=? AND day LIKE ? ORDER BY day,id').all(owner,day.slice(0,7)+'-%').map(parse<TimeEntry>);
   return invalid('Unknown Planner view.');
  });
 }
 history(owner:string,taskId:string){return this.transaction(db=>{const t=this.task(db,owner,taskId);return db.prepare('SELECT at,event,body FROM events WHERE owner=? AND task_id=? ORDER BY rowid DESC LIMIT 200').all(owner,t.id).map(r=>({at:r.at,event:r.event,task:parse<Task>(r)}));});}
 private action(db:DatabaseSync,owner:string,a:Record<string,unknown>,source?:TaskSource){
  const op=a.op;
  if(op==='create'||op==='crm'){
   if(op==='crm'&&!source)return absent();
   if(source){
    const link=db.prepare('SELECT task_id FROM crm_links WHERE owner=? AND note_id=?').get(owner,source.noteId);
    if(link)return this.task(db,owner,link.task_id);
   }
   const t:Task={id:id(),day:date(a.day),lane:lane(a.lane),title:line(a.title,180,true),detail:line(a.detail??'',8000),due:a.due?date(a.due):'',rank:0,state:'not_started',archived:false,parentId:null,carryAge:0,createdAt:stamp(),revision:1,source:source??null};
   const result=this.save(db,owner,this.placement(db,owner,t,t.day,t.lane,a.replacement),'created');
   if(source)db.prepare('INSERT INTO crm_links VALUES(?,?,?)').run(owner,source.noteId,t.id);
   return result;
  }
  if(op==='archive-year'){
   const year=Number(a.year);
   if(!Number.isInteger(year)||year<2000||year>=new Date().getFullYear())return invalid('Choose a past calendar year.');
   db.prepare('INSERT OR IGNORE INTO archived_plan_years VALUES(?,?)').run(owner,year);
   return {year};
  }
  if(op==='carry'){
   const from=date(a.from),to=date(a.to);if(to<=from)return invalid('Carry-forward needs a later date.');
   let moved=0,backlog=0;
   for(const t of this.tasks(db,owner,from).filter(t=>!t.archived&&t.state!=='done').sort((x,y)=>x.rank-y.rank)){
    const fits=this.tasks(db,owner,to).filter(o=>!o.archived&&o.state!=='done'&&o.lane===t.lane).length<limits[t.lane];
    const dest=fits?t.lane:'backlog';if(!fits)backlog++;
    this.save(db,owner,{...this.placement(db,owner,t,to,dest,undefined),carryAge:t.carryAge+(t.lane==='backlog'?0:1),revision:t.revision+1},'carried');moved++;
   }
   return {moved,backlog};
  }
  if(op==='journal'||op==='journal-patch'||op==='journal-add'||op==='journal-remove'){
   const day=date(a.day),j=this.readJournal(db,owner,day);
   if(op==='journal'){
    if(j.revision!==a.revision)throw new PlannerError(409,'This journal changed in another tab. Reload before saving.');
    const hits=Array.isArray(a.hits)?a.hits:[];
    if(hits.some(h=>!quickHits.includes(h)))return invalid('Invalid Quick Hit.');
    if(a.rating!==null&&!(typeof a.rating==='string'&&Object.hasOwn(dayRatings,a.rating))&&!(typeof a.rating==='number'&&Number.isInteger(a.rating)&&a.rating>=1&&a.rating<=5))return invalid('Choose a valid day rating.');
    Object.assign(j,{notes:line(a.notes,12000),reflection:line(a.reflection,12000),gratitude:line(a.gratitude,4000),legacy:line(a.legacy,4000),hits:[...new Set(hits)],rating:a.rating});
   }else if(op==='journal-patch'){
    const patch=a.patch, baseline=a.baseline;
    if(!patch||typeof patch!=='object'||Array.isArray(patch)||!baseline||typeof baseline!=='object'||Array.isArray(baseline))return invalid('No journal changes supplied.');
    const previous=baseline as Record<string,unknown>;
    for(const [key,value] of Object.entries(patch)){
     if(!['notes','reflection','gratitude','legacy','hits','rating'].includes(key))return invalid('Unknown journal field.');
     const field=key as 'notes'|'reflection'|'gratitude'|'legacy'|'hits'|'rating';
     if(JSON.stringify(j[field])!==JSON.stringify(previous[field]))throw new PlannerError(409,'This reflection changed in another tab. Refresh before saving.');
     if(field==='hits'){
      if(!Array.isArray(value)||value.some(h=>!quickHits.includes(h)))return invalid('Invalid Quick Hit.');
      j.hits=[...new Set(value)];
     }else if(field==='rating'){
      if(value!==null&&!(typeof value==='string'&&Object.hasOwn(dayRatings,value)))return invalid('Choose Great Day, Good Day, or Difficult Day.');
      j.rating=value as Journal['rating'];
     }else{
      if(typeof value!=='string'||value.length>(field==='gratitude'||field==='legacy'?4000:12000))return invalid('The journal field is too long.');
      j[field]=value;
     }
    }
   }else if(op==='journal-add')j.entries.push({id:id(),at:stamp(),text:line(a.text,8000,true)});
   else {if(!j.entries.some(e=>e.id===a.id))return absent();j.entries=j.entries.filter(e=>e.id!==a.id);}
   j.revision++;
   db.prepare('INSERT INTO journals VALUES(?,?,?) ON CONFLICT(owner,day) DO UPDATE SET body=excluded.body').run(owner,day,JSON.stringify(j));return j;
  }
  if(op==='client'){
   const name=line(a.name,140,true),key=name.normalize('NFKC').toLowerCase();
   let clientId:string=id();
   if(a.id){clientId=line(a.id,80,true);if(!db.prepare('SELECT 1 FROM clients WHERE owner=? AND id=?').get(owner,clientId))return absent();}
   const duplicate=db.prepare('SELECT id FROM clients WHERE owner=? AND name_key=?').get(owner,key);
   if(duplicate&&duplicate.id!==clientId)throw new PlannerError(409,'This client name already exists.');
   const client={id:clientId,name};
   db.prepare('INSERT INTO clients VALUES(?,?,?,?) ON CONFLICT(owner,id) DO UPDATE SET name_key=excluded.name_key,body=excluded.body').run(owner,clientId,key,JSON.stringify(client));return client;
  }
  if(op==='time'){
   const day=date(a.day),clientId=line(a.clientId,80,true),r=db.prepare('SELECT body FROM clients WHERE owner=? AND id=?').get(owner,clientId);
   if(!r)return absent();
   const tc=(x:unknown)=>{const s=line(x,8,true);if(!/^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(s))return invalid('Enter valid start and end times.');const [h,m,z=0]=s.split(':').map(Number);return {s,v:h*3600+m*60+z};};
   const start=tc(a.started),end=tc(a.ended),timezone=line(a.timezone??'UTC',100,true);
   let formatter:Intl.DateTimeFormat;
   try{formatter=new Intl.DateTimeFormat('en-CA',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'});}catch{return invalid('Choose a valid time zone.');}
   const local=(ms:number)=>{
    const p=Object.fromEntries(formatter.formatToParts(ms).map(x=>[x.type,x.value]));
    return Date.UTC(Number(p.year),Number(p.month)-1,Number(p.day),Number(p.hour),Number(p.minute),Number(p.second));
   };
   const midnight=Date.parse(day+'T00:00:00Z');
   const offsets=[...new Set([-2,-1,0,1,2].map(d=>{const sample=midnight+d*86400000;return local(sample)-sample;}))];
   const instant=(delta:number)=>{
    const target=midnight+delta*1000,results=offsets.map(o=>target-o).filter(v=>local(v)===target);
    if(results.length!==1)return invalid('That time is skipped or occurs twice in your time zone. Choose a different time.');
    return results[0];
   };
   const seconds=(instant(end.v)-instant(start.v))/1000;
   if(end.v<=start.v||seconds<=0||seconds>86400)return invalid('End time must be after start time on the same day.');
   const entry:TimeEntry={id:id(),day,clientId,clientName:parse<Client>(r).name,started:start.s,ended:end.s,timezone,seconds,notes:line(a.notes??'',8000)};
   db.prepare('INSERT INTO time_entries VALUES(?,?,?,?,?)').run(owner,entry.id,day,clientId,JSON.stringify(entry));return entry;
  }
  if(!['edit','place','state','follow','archive','restore','order','delegate','mock-deliver','delegate-decide'].includes(String(op)))return invalid('Unknown Planner action.');
  const t=this.task(db,owner,a.id);
  if(t.revision!==a.revision)throw new PlannerError(409,'This task changed in another tab. Reload before saving.');
  if(t.archived&&op!=='restore')throw new PlannerError(409,'Restore this task before changing it.');
  const workRow=db.prepare('SELECT body FROM delegations WHERE owner=? AND task_id=?').get(owner,t.id);
  const work=workRow?parse<PreviewDelegation>(workRow):null;
  if(op==='delegate'||op==='mock-deliver'||op==='delegate-decide'){
   let w:PreviewDelegation;
   if(op==='delegate'){
    if(t.state==='done')throw new PlannerError(409,'Reopen the task before delegating.');
    if(work&&work.state!=='rejected')return work;
    if(a.recipient!=='ally'&&a.recipient!=='human')return invalid('Choose a preview recipient.');
    const context=[t.title];
    if(a.shareTaskNotes===true&&t.detail)context.push(t.detail);
    const ids=Array.isArray(a.files)?[...new Set(a.files)]:[];
    if(ids.length>10)return invalid('Too many selected attachments.');
    const names=ids.map(val=>{const r=db.prepare('SELECT name FROM files WHERE owner=? AND task_id=? AND id=?').get(owner,t.id,line(val,80,true));if(!r)return absent();return String(r.name);});
    w={id:id(),recipient:a.recipient,objective:line(a.objective,1200,true),expected:line(a.expected,1200,true),context,fileNames:names,state:'pending',result:''};
   }else{
    if(!work||work.id!==a.workId)return absent();
    if(op==='mock-deliver'){
     if(work.state!=='pending')return work;
     w={...work,state:'review',result:'Synthetic preview result for: '+work.expected};
    }else{
     if(work.state!=='review'||typeof a.accept!=='boolean')throw new PlannerError(409,'No result is awaiting your review.');
     w={...work,state:a.accept?'accepted':'rejected'};
     if(a.accept)this.save(db,owner,{...t,state:'done',revision:t.revision+1},'delegation-accepted');
    }
   }
   db.prepare('INSERT INTO delegations VALUES(?,?,?) ON CONFLICT(owner,task_id) DO UPDATE SET body=excluded.body').run(owner,t.id,JSON.stringify(w));
   return w;
  }
  if(work&&(work.state==='pending'||work.state==='review')&&(op==='follow'||op==='state'&&a.state==='done'||op==='archive'))throw new PlannerError(409,'Review the delegated result before completing or archiving this task.');
  if(op==='edit'){
   let repeat=t.repeat;
   if(a.repeatKind!==undefined&&!t.occurrence){
    if(a.repeatKind==='none')repeat=undefined;
    else{
     if(a.repeatKind!=='daily'&&a.repeatKind!=='weekdays'&&a.repeatKind!=='weekly'&&a.repeatKind!=='monthly')return invalid('Choose a valid repeat option.');
     const startsOn=date(a.repeatStartsOn),endsOn=a.repeatEndsOn?date(a.repeatEndsOn):'';
     if(startsOn<=t.day||endsOn&&endsOn<startsOn)return invalid('Repeat starts after this task’s plan date, and its end cannot be before its start.');
     repeat={kind:a.repeatKind,startsOn,endsOn} as RepeatRule;
    }
   }
   return this.save(db,owner,{...t,title:line(a.title,180,true),detail:line(a.detail??'',8000),due:a.due?date(a.due):'',repeat,
    shareable:a.shareable===undefined?t.shareable:a.shareable===true,revision:t.revision+1},'edited');
  }
  if(op==='archive')return this.save(db,owner,{...t,archived:true,revision:t.revision+1},'archived');
  if(op==='restore')return this.save(db,owner,{...this.placement(db,owner,{...t,archived:false},t.day,lane(a.lane??'backlog'),a.replacement),revision:t.revision+1},'restored');
  if(op==='place')return this.save(db,owner,{...this.placement(db,owner,t,date(a.day),lane(a.lane),a.replacement),revision:t.revision+1},'moved');
  if(op==='order'){
   const tasks=this.tasks(db,owner,t.day).filter(x=>!x.archived&&x.lane===t.lane).sort((x,y)=>x.rank-y.rank||x.id.localeCompare(y.id));
   const i=tasks.findIndex(x=>x.id===t.id),direction=a.direction==='up'?-1:a.direction==='down'?1:0;
   if(!direction)return invalid('Choose an order direction.');
   const other=tasks[i+direction];if(!other)return t;
   this.save(db,owner,{...other,rank:t.rank,revision:other.revision+1},'reordered');return this.save(db,owner,{...t,rank:other.rank,revision:t.revision+1},'reordered');
  }
  if(op==='state'){
   const state=a.state as TaskState;
   if(!['not_started','in_progress','blocked','done'].includes(state))return invalid('Choose a valid task status.');
   const next={...t,state,revision:t.revision+1};
   return this.save(db,owner,t.state==='done'&&state!=='done'?this.placement(db,owner,next,t.day,t.lane,a.replacement):next,'status');
  }
  const day=date(a.day);
  if(day<=t.day||t.state==='done')return invalid('Choose a later date for an open task.');
  const ln=lane(a.lane??'backlog');
  const next:Task={...t,id:id(),parentId:t.id,source:null,repeat:undefined,occurrence:undefined,shareable:false,day,lane:ln,state:'not_started',due:'',createdAt:stamp(),carryAge:0,revision:1};
  const result=this.save(db,owner,this.placement(db,owner,next,day,ln,a.replacement),'follow-up');
  this.save(db,owner,{...t,state:'done',revision:t.revision+1},'completed-with-follow-up');return result;
 }
 act(owner:string,a:Record<string,unknown>,source?:TaskSource){
  if(!a||Array.isArray(a)||typeof a!=='object')return invalid('Invalid action.');
  const key=line(a.requestId,100,true);if(!/^[\w-]{16,100}$/.test(key))return invalid('Invalid request ID.');
  return this.transaction(db=>{
   const hash=digest(JSON.stringify({a,source})),prev=db.prepare('SELECT hash,body FROM requests WHERE owner=? AND id=?').get(owner,key);
   if(prev){if(prev.hash!==hash)throw new PlannerError(409,'That request was already used.');return parse<unknown>(prev);}
   const result=this.action(db,owner,a,source);
   db.prepare('INSERT INTO requests VALUES(?,?,?,?)').run(owner,key,hash,JSON.stringify(result));return result;
  });
 }
 rehearseImport(owner:string,bundle:SyntheticBundle,dryRun=true){
  if(!['executive','second-user'].includes(owner)||bundle?.format!=='ecp-planner-synthetic-v1'||bundle.sourceOwner!=='sample-ecp-owner')return invalid('Only a mapped synthetic Planner fixture is allowed.');
  const key=line(bundle.fixtureId,100,true);
  if(!/^[\w-]+$/.test(key))return invalid('Invalid fixture ID.');
  for(const value of [bundle.tasks,bundle.dayJournals,bundle.clients,bundle.timeEntries,bundle.files])if(!Array.isArray(value)||value.length>500)return invalid('Check the fixture manifest.');
  return this.transaction(db=>{
   const hash=digest(JSON.stringify(bundle)),old=db.prepare('SELECT hash,body FROM imports WHERE owner=? AND bundle_id=?').get(owner,key);
   if(old){if(old.hash!==hash)throw new PlannerError(409,'That fixture ID was already used for different content.');return {...parse<{count:Record<string,number>;monthlySeconds:Record<string,number>;checksums:Record<string,string>}>(old),alreadyApplied:true};}
   const at=(value:unknown)=>{const s=line(value,40,true);if(!Number.isFinite(Date.parse(s))||new Date(s).toISOString()!==s)return invalid('Invalid fixture timestamp.');return s;};
   const identifier=(value:unknown)=>{const v=line(value,36,true);if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v))return invalid('Invalid fixture ID.');return v;};
   const second=(value:unknown)=>{if(!Number.isInteger(value)||Number(value)<1||Number(value)>86400)return invalid('Invalid time duration.');return Number(value);};
   const conflict=()=>{throw new PlannerError(409,'The fixture conflicts with existing records or references.');};
   const taskIds=new Set(bundle.tasks.map(t=>identifier(t.id)));
   const parents=new Map(bundle.tasks.map(t=>[t.id,t.parentId]));
   if(taskIds.size!==bundle.tasks.length)return conflict();
   for(const t of bundle.tasks){
    if(t.parentId!==null&&(!taskIds.has(t.parentId)||t.parentId===t.id))return conflict();
    const chain=new Set([t.id]);let p=t.parentId;while(p){if(chain.has(p))return conflict();chain.add(p);p=parents.get(p)??null;}
    if(db.prepare('SELECT 1 FROM tasks WHERE owner=? AND id=?').get(owner,t.id))return conflict();
    if(!['not_started','in_progress','blocked','done'].includes(t.state)||typeof t.archived!=='boolean'||!Number.isInteger(t.rank)||t.rank<1||!Number.isInteger(t.carryAge)||t.carryAge<0||t.source!==null)return invalid('Invalid fixture task or out-of-scope source.');
    const clean:Task={id:t.id,title:line(t.title,180,true),detail:line(t.detail,8000),due:t.due?date(t.due):'',day:date(t.day),lane:lane(t.lane),rank:t.rank,state:t.state,archived:t.archived,parentId:t.parentId,source:null,createdAt:at(t.createdAt),carryAge:t.carryAge,revision:1};
    if(!clean.archived&&clean.state!=='done'&&this.tasks(db,owner,clean.day).filter(x=>x.lane===clean.lane&&!x.archived&&x.state!=='done').length>=limits[clean.lane])return conflict();
    this.save(db,owner,clean,'imported-synthetic');
   }
   for(const {day,journal:j} of bundle.dayJournals){
    if(this.readJournal(db,owner,date(day)).revision!==0)return conflict();
    if(!Array.isArray(j.entries)||j.entries.length>500||!Array.isArray(j.hits)||j.hits.some(h=>!quickHits.includes(h as typeof quickHits[number]))||(j.rating!==null&&!(typeof j.rating==='string'&&Object.hasOwn(dayRatings,j.rating))&&!(typeof j.rating==='number'&&Number.isInteger(j.rating)&&j.rating>=1&&j.rating<=5)))return invalid('Invalid fixture journal.');
    const journal:Journal={notes:line(j.notes,12000),entries:j.entries.map(x=>({id:identifier(x.id),at:at(x.at),text:line(x.text,8000,true)})),hits:[...new Set(j.hits)],gratitude:line(j.gratitude,4000),reflection:line(j.reflection,12000),legacy:line(j.legacy,4000),rating:j.rating,revision:1};
    db.prepare('INSERT INTO journals VALUES(?,?,?)').run(owner,day,JSON.stringify(journal));
   }
   const importedClients=new Set<string>();
   for(const c of bundle.clients){
    const cid=identifier(c.id),name=line(c.name,140,true),lower=name.normalize('NFKC').toLowerCase();
    if(db.prepare('SELECT 1 FROM clients WHERE owner=? AND (id=? OR name_key=?)').get(owner,cid,lower))return conflict();
    db.prepare('INSERT INTO clients VALUES(?,?,?,?)').run(owner,cid,lower,JSON.stringify({id:cid,name}));importedClients.add(cid);
   }
   const monthlySeconds:Record<string,number>={};
   for(const e of bundle.timeEntries){
    const eid=identifier(e.id);
    if(!importedClients.has(identifier(e.clientId))||db.prepare('SELECT 1 FROM time_entries WHERE owner=? AND id=?').get(owner,eid))return conflict();
    const clean:TimeEntry={id:eid,day:date(e.day),clientId:e.clientId,clientName:line(e.clientName,140,true),started:line(e.started,40,true),ended:line(e.ended,40,true),seconds:second(e.seconds),notes:line(e.notes,8000),...(e.timezone?{timezone:line(e.timezone,100,true)}:{})};
    const month=e.day.slice(0,7);monthlySeconds[month]=(monthlySeconds[month]??0)+clean.seconds;
    db.prepare('INSERT INTO time_entries VALUES(?,?,?,?,?)').run(owner,eid,e.day,e.clientId,JSON.stringify(clean));
   }
   const checksums:Record<string,string>={};
   let size=0;
   for(const f of bundle.files){
    const fid=identifier(f.id),name=line(f.name,180,true),encoded=line(f.bytes,28*1024*1024,true);
    if(!taskIds.has(identifier(f.taskId))||db.prepare('SELECT 1 FROM files WHERE owner=? AND id=?').get(owner,fid))return conflict();
    const bytes=Buffer.from(encoded,'base64');size+=bytes.length;
    if(/[\/\\\x00-\x1f\x7f]/.test(name)||!/[.](pdf|docx?|xlsx?|pptx?|txt|jpe?g|png)$/i.test(name)||!bytes.length||bytes.length>20*1024*1024||size>32*1024*1024||bytes.toString('base64')!==encoded||digest(bytes)!==f.sha256)return invalid('Fixture attachment bytes or checksum do not match.');
    checksums[fid]=f.sha256;db.prepare('INSERT INTO files VALUES(?,?,?,?,?,?)').run(owner,fid,f.taskId,name,f.sha256,bytes);
   }
   const count={tasks:bundle.tasks.length,journals:bundle.dayJournals.length,clients:bundle.clients.length,timeEntries:bundle.timeEntries.length,files:bundle.files.length};
   const result={count,monthlySeconds,checksums,alreadyApplied:false};
   db.prepare('INSERT INTO imports VALUES(?,?,?,?)').run(owner,key,hash,JSON.stringify(result));return result;
  },dryRun);
 }
 upload(owner:string,taskId:string,fileId:string,name:string,bytes:Uint8Array){
  return this.transaction(db=>{
   const t=this.task(db,owner,taskId);
   if(t.archived)throw new PlannerError(409,'Restore the task before attaching a file.');
   name=line(name,180,true);
   if(/[\\/\x00-\x1f\x7f]/.test(name)||!/[.](pdf|docx?|xlsx?|pptx?|txt|jpe?g|png)$/i.test(name)||bytes.length<1||bytes.length>20*1024*1024)return invalid('Choose a supported attachment up to 20 MB.');
   if(!/^[0-9a-f-]{36}$/i.test(fileId))return invalid('Invalid upload ID.');
   const sha256=digest(bytes),old=db.prepare('SELECT sha,name,task_id FROM files WHERE owner=? AND id=?').get(owner,fileId);
   if(old&&(old.sha!==sha256||old.name!==name||old.task_id!==t.id))throw new PlannerError(409,'That upload was already used.');
   if(!old){
    const count=db.prepare('SELECT count(*) as n FROM files WHERE owner=? AND task_id=?').get(owner,t.id);
    if(Number(count?.n)>=10)throw new PlannerError(409,'A task can have up to 10 attachments.');
    db.prepare('INSERT INTO files VALUES(?,?,?,?,?,?)').run(owner,fileId,t.id,name,sha256,bytes);
   }
   return {id:fileId,name,size:bytes.length,sha256};
  });
 }
 file(owner:string,fileId:string){return this.transaction(db=>{const r=db.prepare('SELECT name,bytes FROM files WHERE owner=? AND id=?').get(owner,fileId);return r?{name:String(r.name),bytes:r.bytes as Uint8Array}:absent();});}
}
