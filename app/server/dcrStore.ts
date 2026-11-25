/** Dedicated DCR records and review history; optional read-only evidence/work adapters. */
import { DatabaseSync } from 'node:sqlite';
import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import {DcrConnectionsReader} from './dcrConnections.ts';
import type {DcrWork,DcrWorkKind,DcrWorkLink} from '../src/domain/dcr.ts';
import { blankDcr } from '../src/domain/dcr.ts';
import type { DcrRecord, DcrFields, DcrSource, DcrRequest, DcrHistory, DcrAnswer, DcrCitation } from '../src/domain/dcr.ts';
export class DcrError extends Error { status: number; constructor(status: number, message: string) { super(message); this.status=status; } }
export function insist(condition: unknown, message: string, status=400): asserts condition { if(!condition) throw new DcrError(status,message); }
const now=()=>new Date().toISOString();
const digest=(s:string)=>createHash('sha256').update(s).digest('hex');
export function fields(input: unknown): DcrFields {
  insist(input && typeof input==='object' && !Array.isArray(input),'Record fields are required.');
  const v=input as Record<string,unknown>, base=blankDcr();
  insist(Object.keys(v).every(k=>Object.hasOwn(base,k)),'Unsupported record field.');
  for(const [k,fallback] of Object.entries(base)) { const value=v[k]??fallback; insist(typeof value==='string' && value.length <= (['what','why','completionEvidence','decisionOptions','recommendation','decisionOutcome','decisionRationale','blockers','preferences','lastInteractionNote'].includes(k)?6000:500),`Invalid ${k}.`); (base as unknown as Record<string,string>)[k]=value.trim(); }
  insist(['decision','commitment','relationship'].includes(base.kind),'Choose a record type.');
  insist(['open','blocked','completed','archived'].includes(base.status),'Choose a status.');
  insist(['i_owe','owed_to_me','none'].includes(base.direction),'Choose a promise direction.');
  if(base.kind!=='commitment')base.direction='none';
  insist(base.title && base.what && base.why,'Title, What and Why are required.');
  insist(['normal','high'].includes(base.priority),'Choose a priority.');
  insist(['not_set','standard','important','key'].includes(base.importance),'Choose relationship importance.');
  for (const date of [base.snoozedUntil,base.decidedOn,base.lastInteractionDate]) insist(!date || (/^\d{4}-\d{2}-\d{2}$/.test(date) && !Number.isNaN(Date.parse(date)) && new Date(date).toISOString().slice(0,10)===date),'Use a valid calendar date.');
  insist(!base.dueDate || (/^\d{4}-\d{2}-\d{2}$/.test(base.dueDate) && !Number.isNaN(Date.parse(base.dueDate)) && new Date(base.dueDate).toISOString().slice(0,10)===base.dueDate),'Use a valid due date.');
  insist(!base.email || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(base.email),'Use a valid email.');
  if(base.kind==='decision'){
    if(base.status==='completed'||base.decisionOutcome||base.decisionRationale||base.decidedOn){
      insist(base.decisionOutcome&&base.decisionRationale&&base.decidedOn,'Record your actual decision, rationale and decision date. A recommendation is not your decision.');
      insist(base.status==='completed'||base.status==='archived','A recorded decision must have Decision recorded status. Clear the outcome to reopen the question.');
    }
  } else insist(!base.decisionOutcome&&!base.decisionRationale&&!base.decidedOn,'Only decisions can record a decision outcome.');
  if(base.kind==='relationship')insist(!base.lastInteractionDate||base.lastInteractionNote,'Describe the confirmed interaction before recording its date.');
  insist(base.status!=='completed' || base.kind==='decision' || base.completionEvidence,'Explain the outcome before marking complete. A finished task is not proof of a fulfilled promise.');
  return base;
}
export class DcrStore {
  db: DatabaseSync;
  private transactionDepth=0;
  readonly connections?:DcrConnectionsReader;
  constructor(root:string, connections?:DcrConnectionsReader, options:{production?:boolean}={}) {
    this.connections=connections;
    mkdirSync(root,{recursive:true,mode:0o700}); this.db=new DatabaseSync(join(root,'kanban.db'));
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS dcr_records(id TEXT PRIMARY KEY,body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS dcr_work_links(recordId TEXT,kind TEXT,externalId TEXT,PRIMARY KEY(recordId,kind,externalId));
      CREATE TABLE IF NOT EXISTS dcr_sources(id TEXT PRIMARY KEY,body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS dcr_requests(id TEXT PRIMARY KEY,body TEXT NOT NULL,context TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS dcr_history(id INTEGER PRIMARY KEY,recordId TEXT,action TEXT,at TEXT,detail TEXT);
      CREATE TABLE IF NOT EXISTS tasks(id TEXT PRIMARY KEY,body TEXT,status TEXT,assignee TEXT,claim_lock TEXT,current_run_id INTEGER);
      CREATE TABLE IF NOT EXISTS task_links(parent_id TEXT,child_id TEXT);
      CREATE TABLE IF NOT EXISTS task_events(task_id TEXT,kind TEXT,payload TEXT,created_at INTEGER);`);
    for(const r of this.requests()) if(r.state==='running'&&(!options.production||Date.now()-Date.parse(r.createdAt)>120000)) this.setRequest({...r,state:'interrupted',error:'The service restarted before this answer completed. Start a new request to retry.'});
  }
  transaction<T>(fn:()=>T):T { if(this.transactionDepth)return fn();this.db.exec('BEGIN IMMEDIATE');this.transactionDepth++;try{const r=fn();this.db.exec('COMMIT');return r;}catch(e){this.db.exec('ROLLBACK');throw e;}finally{this.transactionDepth--;} }
  private rows<T>(table:string):T[] {return this.db.prepare(`SELECT body FROM ${table}`).all().map(r=>JSON.parse(String(r.body)));}
  records(){return this.rows<DcrRecord>('dcr_records').map(r=>({...blankDcr(r.kind),...r}));}
  sources(){return this.rows<DcrSource>('dcr_sources');}
  requests(){return this.rows<DcrRequest>('dcr_requests').map(r=>({...r,...(r.answer?{answer:{...r.answer,suggestions:r.answer.suggestions.map(s=>({...s,fields:{...blankDcr(s.fields.kind),...s.fields}}))}}:{})}));}
  history(){return this.db.prepare('SELECT * FROM dcr_history ORDER BY id DESC LIMIT 300').all() as unknown as DcrHistory[];}
  record(id:string){const r=this.records().find(x=>x.id===id);insist(r,'Record not found.',404);return r;}
  source(id:string){const s=this.availableSources().find(x=>x.id===id);insist(s,'A selected source was removed. Select current evidence again.',409);return s;}
  request(id:string){const r=this.requests().find(x=>x.id===id);insist(r,'Request not found.',404);return r;}
  audit(id:string,action:string,detail:string){this.db.prepare('INSERT INTO dcr_history(recordId,action,at,detail) VALUES(?,?,?,?)').run(id,action,now(),detail);}
  save(input:unknown,id?:string,revision?:number,sourceIds:string[]=[],linkedIds:string[]=[]):DcrRecord {
    return this.transaction(()=>{
    const f=fields(input), old=id?this.record(id):undefined;
    insist(!old || old.kind===f.kind,'Record type cannot change.');
    insist(!old || old.revision===revision,'This record changed. Reload and review the current version.',409);
    insist(Array.isArray(sourceIds)&&sourceIds.length<=8&&sourceIds.every(x=>typeof x==='string'),'Select up to eight sources.');
    insist(Array.isArray(linkedIds)&&linkedIds.length<=20&&linkedIds.every(x=>typeof x==='string'),'Invalid links.');
    sourceIds.forEach(x=>this.source(x));linkedIds.forEach(x=>{this.record(x);insist(x!==id,'A record cannot link to itself.');});
    const record={...f,id:old?.id??randomUUID(),revision:(old?.revision??0)+1,createdAt:old?.createdAt??now(),updatedAt:now(),sourceIds:[...new Set(sourceIds)],linkedIds:[...new Set(linkedIds)]};
    this.db.prepare('INSERT OR REPLACE INTO dcr_records VALUES(?,?)').run(record.id,JSON.stringify(record));
    this.audit(record.id,old?'updated':'created',JSON.stringify({before:old??null,after:record,actor:'executive'}));return record;
    });
  }
  commitmentFromDecision(id:string,revision:number,input:unknown){return this.transaction(()=>{
    const decision=this.record(id);
    insist(decision.revision===revision,'This decision changed. Reload before creating a commitment.',409);
    insist(decision.kind==='decision'&&decision.status==='completed'&&decision.decisionOutcome,'Record your decision before creating its commitment.');
    const value=fields(input);insist(value.kind==='commitment'&&value.status==='open','Create a new open commitment.');
    const record=this.save(value,undefined,undefined,decision.sourceIds,[decision.id,...this.records().filter(r=>r.kind==='relationship'&&(decision.linkedIds.includes(r.id)||r.linkedIds.includes(decision.id))).map(r=>r.id)]);
    this.audit(record.id,'created_from_decision',JSON.stringify({decisionId:id,decisionRevision:revision,actor:'executive'}));return record;
  });}
  availableSources(){return this.sources().filter(s=>this.sourceAvailable(s));}
  private sourceAvailable(s:DcrSource):boolean {
    if(!s.active)return false;
    if(!s.artifact)return true;
    try{return this.connections?.artifact(s.artifact.id).version===s.artifact.version;}catch{return false;}
  }
  addSource(title:unknown,text:unknown,fixture=false,artifact?:DcrSource['artifact']){
    insist(typeof title==='string'&&title.trim()&&title.length<=300,'Give the source a title.');
    insist(typeof text==='string'&&text.trim()&&text.length<=20000,'Evidence must contain 1–20,000 characters of text.');
    const hash=digest(text);const existing=this.availableSources().find(s=>s.hash===hash&&JSON.stringify(s.artifact)===JSON.stringify(artifact));if(existing)return existing;
    const s:DcrSource={id:randomUUID(),title:title.trim(),text,hash,active:true,fixture,createdAt:now(),...(artifact?{artifact}:{})};this.db.prepare('INSERT INTO dcr_sources VALUES(?,?)').run(s.id,JSON.stringify(s));return s;
  }
  addArtifact(id:string,version:string){
    insist(this.connections,'Artifact connection unavailable.',503);
    let preview;try{preview=this.connections.artifact(id);}catch{throw new DcrError(409,'Artifact unavailable. Preview a current text Artifact again.');}
    insist(version===preview.version,'This Artifact changed. Preview it again before adding it.',409);
    return this.transaction(()=>{const source=this.addSource(preview.title,preview.text,this.connections!.label==='Isolated staging examples',{id,version});this.audit('','artifact_selected',JSON.stringify({sourceId:source.id,artifactId:id,version}));return source;});
  }
  revokeSource(id:string){const s=this.sources().find(s=>s.id===id&&s.active);insist(s,'Source already removed.',409);this.db.prepare('UPDATE dcr_sources SET body=? WHERE id=?').run(JSON.stringify({...s,active:false}),id);this.audit('', 'source_removed',s.title);}
  workLinks():DcrWorkLink[]{
    return this.db.prepare('SELECT recordId,kind,externalId FROM dcr_work_links').all().map(row=>({recordId:String(row.recordId),kind:row.kind as DcrWorkKind,id:String(row.externalId),work:this.connections?.work(row.kind as DcrWorkKind,String(row.externalId))??null}));
  }
  linkWork(recordId:string,revision:number,kind:DcrWorkKind,id:string,version:string,remove=false){return this.transaction(()=>{
    const record=this.record(recordId);insist(record.kind==='commitment','Connect execution work to a commitment.');
    insist(record.revision===revision,'This commitment changed. Reload before changing its work links.',409);
    insist(['task','human'].includes(kind)&&typeof id==='string'&&id.length<=200,'Choose an existing task or human delegation.');
    const exists=this.db.prepare('SELECT 1 FROM dcr_work_links WHERE recordId=? AND kind=? AND externalId=?').get(recordId,kind,id);
    if(remove){insist(exists,'Work link not found.',404);this.db.prepare('DELETE FROM dcr_work_links WHERE recordId=? AND kind=? AND externalId=?').run(recordId,kind,id);}
    else {
      insist(this.workLinks().filter(l=>l.recordId===recordId).length<10||exists,'Link up to ten work items.');
      const work=this.connections?.work(kind,id);insist(work,'Work item unavailable. Refresh the list.',409);insist(work.version===version,'Work item changed. Refresh and review it again.',409);
      if(exists)return record;
      this.db.prepare('INSERT INTO dcr_work_links VALUES(?,?,?)').run(recordId,kind,id);
    }
    // Link changes invalidate pending proposals without altering business fields or
    // requiring a now-unavailable evidence source to be restored.
    const next={...record,revision:record.revision+1,updatedAt:now()};
    this.db.prepare('UPDATE dcr_records SET body=? WHERE id=?').run(JSON.stringify(next),recordId);
    this.audit(recordId,remove?'work_unlinked':'work_linked',JSON.stringify({kind,id,actor:'executive'}));return next;
  });}
  begin(prompt:unknown,recordId:string|null,sourceIds:string[],propose=false):DcrRequest {return this.transaction(()=>{
    insist(this.requests().filter(r=>r.state==='running').length<2,'Two answers are already in progress. Please wait.',429);
    insist(typeof prompt==='string'&&prompt.trim()&&prompt.length<=4000,'Enter a question (up to 4,000 characters).');
    insist(Array.isArray(sourceIds)&&sourceIds.length<=8&&sourceIds.every(x=>typeof x==='string'),'Select up to eight evidence sources.');
    insist(!this.requests().some(r=>r.state==='running'&&r.recordId===recordId),'An answer is already being prepared here.',409);
    const record=recordId?this.record(recordId):null;
    const selected=[...new Set([...sourceIds,...(record?.sourceIds??[])])];insist(selected.length<=8,'Select up to eight sources.');
    const sources=selected.map(id=>this.source(id));insist(record||sources.length,'Select evidence before asking for suggestions.');
    if(!record){const previous=this.visibleRequests().find(r=>!r.recordId&&r.state==='complete'&&r.prompt===prompt.trim()&&r.sourceIds.length===selected.length&&r.sourceIds.every(id=>selected.includes(id)));if(previous)return previous;}
    const linked=record?this.records().filter(r=>record.linkedIds.includes(r.id)||r.linkedIds.includes(record.id)).slice(0,12):[];
    // Linked records with revoked evidence cannot be fed back to the model.
    const visibleLinked=linked.filter(r=>r.sourceIds.every(id=>this.availableSources().some(s=>s.id===id)));
    const history=this.visibleRequests().filter(r=>r.recordId===recordId&&r.state==='complete'&&r.sourceIds.every(id=>selected.includes(id))).slice(-6).map(r=>({question:r.prompt,answer:r.answer?.reply}));
    const request:DcrRequest={id:randomUUID(),intent:recordId?(propose?'propose':'discuss'):'extract',recordId,revision:record?.revision??null,prompt:prompt.trim(),sourceIds:selected,state:'running',createdAt:now(),accepted:false};
    const candidates=record?[]:this.records().filter(r=>r.sourceIds.some(id=>selected.includes(id))).slice(0,40).map(r=>({id:r.id,kind:r.kind,title:r.title,what:r.what}));
    const work=this.workLinks().filter(l=>l.recordId===recordId&&l.work).map(l=>l.work!);
    const workSources:DcrSource[]=work.map(w=>({id:`work:${w.kind}:${w.id}`,title:`Linked ${w.kind==='human'?'HI delegation':'agent task'} report · ${w.title}`,text:`Reported work: ${w.title}\nReported status: ${w.status}\nReported owner: ${w.owner||'Unassigned'}\nReported result: ${w.summary||'No result reported.'}\nThis is execution progress, not confirmation that the business promise is fulfilled.`,hash:w.version,active:true,fixture:true,createdAt:request.createdAt}));
    const context={record,linked:visibleLinked,sources,history,candidates,work,workSources};
    this.db.prepare('INSERT INTO dcr_requests VALUES(?,?,?)').run(request.id,JSON.stringify(request),JSON.stringify(context));return request;
  });}
  context(id:string){const row=this.db.prepare('SELECT context FROM dcr_requests WHERE id=?').get(id);insist(row,'Request not found.',404);return JSON.parse(String(row.context)) as {record:DcrRecord|null;linked:DcrRecord[];sources:DcrSource[];workSources?:DcrSource[];work?:DcrWork[];history:unknown[];candidates:{id:string;kind:string;title:string;what:string}[]};}
  current(id:string){const ctx=this.context(id);return this.workCurrent(ctx.work)&&(!ctx.record||this.record(ctx.record.id).revision===ctx.record.revision)&&ctx.linked.every(r=>this.record(r.id).revision===r.revision&&r.sourceIds.every(id=>this.availableSources().some(s=>s.id===id)))&&ctx.sources.every(s=>this.availableSources().some(x=>x.id===s.id&&x.hash===s.hash));}
  private workCurrent(work:DcrWork[]=[]){return work.every(w=>this.connections?.work(w.kind,w.id)?.version===w.version);}
  visibleRequests(){return this.requests().filter(r=>this.workCurrent(this.context(r.id).work)&&this.context(r.id).sources.every(s=>this.availableSources().some(x=>x.id===s.id&&x.hash===s.hash))&&this.context(r.id).linked.every(l=>l.sourceIds.every(id=>this.availableSources().some(s=>s.id===id)))).map(r=>r.state==='complete'&&!this.current(r.id)?{...r,state:'stale' as const}:r);}
  setRequest(r:DcrRequest){this.db.prepare('UPDATE dcr_requests SET body=? WHERE id=?').run(JSON.stringify(r),r.id);}
  validateAnswer(id:string,input:unknown):DcrAnswer {
    insist(input&&typeof input==='object','The provider returned an invalid answer.');const a=input as DcrAnswer;
    insist(typeof a.reply==='string'&&a.reply.trim()&&a.reply.length<=16000,'The provider returned an invalid response.');
    const ctx=this.context(id);const sources=[...ctx.sources,...(ctx.workSources??[])];
    const citations=(v:unknown):DcrCitation[]=>{insist(Array.isArray(v)&&v.length<=12,'Invalid citations.');return v.map(c=>{insist(c&&typeof c.sourceId==='string'&&typeof c.quote==='string'&&c.quote.length>=4&&c.quote.length<=1200&&sources.some(s=>s.id===c.sourceId&&s.text.includes(c.quote)),'An evidence quote could not be verified. No changes were made.');return {sourceId:c.sourceId,quote:c.quote};});};
    insist(Array.isArray(a.suggestions)&&a.suggestions.length<=5,'Invalid suggested changes.');
    if(this.request(id).intent==='discuss')a.suggestions=[]; // The executive chose discussion, so no proposal can escape this boundary.
    if(this.request(id).recordId)insist(a.suggestions.length<=1,'The assistant proposed more than one change. Nothing was saved; ask for one revision.');
    const answer:DcrAnswer={reply:a.reply,citations:citations(a.citations),suggestions:a.suggestions.map(s=>{insist(['source','executive_statement','inference'].includes(s.basis),'A suggestion must explain its basis.');const cites=citations(s.citations);insist(s.basis!=='source'||cites.length,'Source-based suggestions need evidence.');insist(s.fields&&typeof s.fields==='object'&&!Array.isArray(s.fields),'Invalid proposed record fields.');const previous=this.context(id).record;const previousFields=previous?Object.fromEntries(Object.keys(blankDcr()).map(k=>[k,previous[k as keyof DcrFields]])):{};const f=fields({...previousFields,...s.fields});if(!previous)insist(!f.decisionOutcome&&!f.decidedOn&&f.status!=='completed','Extraction may propose a brief or promise, not record a decision or fulfillment.');insist(!this.context(id).record||f.kind===this.context(id).record!.kind,'Changing the record type requires a separate record.');return {fields:f,citations:cites,basis:this.request(id).intent==='propose'?'executive_statement':s.basis};})};
    if(!this.request(id).recordId){const selected=this.request(id).sourceIds;const normalize=(title:string)=>title.toLowerCase().replace(/[^\p{L}\p{N}]/gu,'');const before=answer.suggestions.length;answer.suggestions=answer.suggestions.filter(s=>!this.records().some(r=>r.kind===s.fields.kind&&normalize(r.title)===normalize(s.fields.title)&&r.sourceIds.some(id=>selected.includes(id))));const skipped=before-answer.suggestions.length;if(skipped)answer.reply=answer.suggestions.length?`${skipped} proposed records already exist for this evidence and were excluded. Remaining suggestions still need your review.\n\n${answer.reply}`:'The proposed records already exist for this evidence. No duplicate suggestions were added. Open the existing records to discuss changes or clarify missing information.';}
    return answer;
  }
  finish(id:string,answer:unknown){const r=this.request(id);insist(r.state==='running','This request is no longer active.',409);const a=this.validateAnswer(id,answer);this.setRequest({...r,state:this.current(id)?'complete':'stale',answer:a});}
  fail(id:string,message:string){const r=this.request(id);this.setRequest({...r,state:'failed',error:message});}
  accept(id:string,edits:unknown[],link:boolean){return this.transaction(()=>{
    const r=this.request(id);insist(r.state==='complete'&&!r.accepted&&this.current(id),'This proposal changed or was already handled. Ask for a fresh proposal.',409);
    insist(r.answer&&edits.length===r.answer.suggestions.length&&edits.length>0,'Review the proposed records before saving.');
    const prior=r.recordId?this.record(r.recordId):null;
    const records=edits.map(v=>{if(prior)insist(fields(v).kind===prior.kind,'Record type cannot change.');return this.save(v,prior?.id,prior?.revision,r.sourceIds,prior?.linkedIds??[]);});
    if(link&&records.length>1)for(const record of records){record.linkedIds=records.filter(x=>x.id!==record.id).map(x=>x.id);this.db.prepare('UPDATE dcr_records SET body=? WHERE id=?').run(JSON.stringify(record),record.id);this.audit(record.id,'linked','Linked the records you accepted together.');}
    this.setRequest({...r,accepted:true});return records;
  });}
  seed(){if(this.records().length||this.sources().length)return;
    const yesterday=new Date(Date.now()-86400000).toISOString().slice(0,10);
    const s=this.addSource('Sample · Northstar pilot meeting',`Fictional staging example. Maya Chen, operations lead at Northstar, asked for a revised pilot scope. The executive promised to send the scope by ${yesterday}. A decision is still needed on whether to include two additional locations. Maya offered to send the location roster, but did not give a date. The pilot matters because Northstar wants evidence of value before a wider rollout.`,true);
    this.transaction(()=>{const p=this.save({...blankDcr('relationship'),title:'Maya Chen · Northstar',what:'Operations lead and pilot contact.',why:'She coordinates the pilot and its internal stakeholders.',owner:'Executive',organization:'Northstar',personName:'Maya Chen',role:'Operations lead',importance:'important'},undefined,undefined,[s.id]);
    const d=this.save({...blankDcr('decision'),title:'Expand the Northstar pilot?',what:'Decide whether to include two additional locations.',why:'The scope affects the evidence Northstar needs before a wider rollout.',owner:'Executive',decisionOptions:'Keep the current pilot scope — focus on the original locations.\nAdd two locations — broader evidence, with added coordination.',recommendation:'No recommendation established. Discuss the trade-offs before deciding.'},undefined,undefined,[s.id],[p.id]);
    this.save({...blankDcr(),title:'Send the revised pilot scope',what:'Send Maya the revised Northstar pilot scope.',why:'Keep the promise made at the pilot meeting.',owner:'Executive',promisor:'Executive',promisee:'Maya Chen',dueDate:yesterday},undefined,undefined,[s.id],[p.id,d.id]);});
  }
}
