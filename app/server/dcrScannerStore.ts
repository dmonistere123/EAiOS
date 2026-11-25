import {relationshipGroup} from './dcrRelationshipIdentity.ts';
import {createHash,randomUUID} from 'node:crypto';
import {DcrStore,fields,insist} from './dcrStore.ts';
import type {DcrFinding,ScanInput,ScanRun,ScannerConfig,ScannerStatus} from '../src/domain/dcrScanner.ts';
import {blankDcr,type DcrCitation,type DcrFields} from '../src/domain/dcr.ts';
export const scanHash=(v:unknown)=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const normalize=(s:string)=>s.toLowerCase().replace(/[^\p{L}\p{N}]/gu,'');
const identity=(v:DcrFields)=>[v.email,v.organization,v.personName,v.promisor,v.promisee].map(normalize).join('|');
export const findingFingerprint=(f:DcrFields,targetId='',targetRevision=0)=>scanHash([f.kind,normalize(f.title),identity(f),targetId,targetRevision]);
export function classifyScannedFields(f:DcrFields):DcrFields{
 // An unresolved choice belongs in Decisions, even if the detector calls deciding a promise.
 if(f.kind==='commitment'&&['open','blocked'].includes(f.status)&&/^(?:decide|determine|choose)\s+(?:whether|if|which|who|when|how|between)\b/i.test(f.title))
  return {...f,kind:'decision',direction:'none',promisor:'',promisee:''};
 return f;
}
export function hasRelationshipEvidence(citations:DcrCitation[]){
 return citations.some(c=>{
  const quote=c.quote.trim();
  if(/^(?:Mailbox|Direction|From|To|Sent|Received|Subject|Calendar owner|Start|End|Organizer|Attendees|Location):/i.test(quote)||/^https?:\/\/\S+$/i.test(quote))return false;
  // Brief replies and calendar metadata do not establish a substantive reason
  // to tend a relationship. Short, explicit concerns/role changes can still qualify.
  return quote.length>=60&&quote.split(/\s+/).length>=10||/\b(?:disappointed|frustrated|concerned|resigning|promoted|not renewing|leaving the company|new role)\b/i.test(quote);
 });
}
export function hasRelationshipPerson(f:DcrFields){
 return !!f.personName&&!/[,;&]|\s+and\s+/i.test(f.personName)&&!(f.organization&&normalize(f.personName)===normalize(f.organization));
}
export class DcrScannerStore {
 readonly store:DcrStore;
 constructor(store:DcrStore){this.store=store;store.db.exec(`CREATE TABLE IF NOT EXISTS dcr_scan_state(key TEXT PRIMARY KEY,body TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS dcr_scan_items(key TEXT PRIMARY KEY,version TEXT NOT NULL,sourceId TEXT NOT NULL,status TEXT NOT NULL,body TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS dcr_findings(id TEXT PRIMARY KEY,fingerprint TEXT NOT NULL UNIQUE,body TEXT NOT NULL);`);}
 get<T>(key:string):T|undefined {const r=this.store.db.prepare('SELECT body FROM dcr_scan_state WHERE key=?').get(key);return r?JSON.parse(String(r.body)):undefined;}
 set(key:string,value:unknown){this.store.db.prepare('INSERT INTO dcr_scan_state VALUES(?,?) ON CONFLICT(key) DO UPDATE SET body=excluded.body').run(key,JSON.stringify(value));}
 findings():DcrFinding[]{return this.store.db.prepare('SELECT body FROM dcr_findings').all().map(r=>JSON.parse(String(r.body)));}
 update(f:DcrFinding){this.store.db.prepare('UPDATE dcr_findings SET body=? WHERE id=?').run(JSON.stringify(f),f.id);}
 ingest(input:ScanInput){return this.store.transaction(()=>{
  const previous=this.store.db.prepare('SELECT * FROM dcr_scan_items WHERE key=?').get(input.key);
  if(previous?.version===input.version)return false;
  if(previous){const old=this.store.sources().find(s=>s.id===previous.sourceId);if(old?.active)this.store.revokeSource(old.id);}
  if(input.removed){if(previous)this.store.db.prepare("UPDATE dcr_scan_items SET version=?,status='removed' WHERE key=?").run(input.version,input.key);return false;}
  const sourceId=randomUUID(),source={id:sourceId,title:input.title.slice(0,300),text:input.text,hash:scanHash(input.text),active:true,fixture:false,createdAt:new Date().toISOString(),origin:input.origin,...(input.artifact?{artifact:input.artifact}:{})};
  insist(input.text.length>0&&input.text.length<=20000,'Scanner evidence exceeds the supported size.');
  this.store.db.prepare('INSERT INTO dcr_sources VALUES(?,?)').run(sourceId,JSON.stringify(source));
  this.store.db.prepare('INSERT INTO dcr_scan_items VALUES(?,?,?,?,?) ON CONFLICT(key) DO UPDATE SET version=excluded.version,sourceId=excluded.sourceId,status=excluded.status,body=excluded.body').run(input.key,input.version,sourceId,'pending',JSON.stringify(input));return true;
 });}
 pending(includeRetries=true){
  const rows=this.store.db.prepare("SELECT key,sourceId,body,status FROM dcr_scan_items WHERE status IN ('pending','relationship_pending') OR (status IN ('retry','relationship_retry') AND ?) ORDER BY rowid DESC").all(includeRetries?1:0).map(r=>({key:String(r.key),sourceId:String(r.sourceId),input:JSON.parse(String(r.body)) as ScanInput,relationshipsOnly:String(r.status).startsWith('relationship_')}));
  const groups=new Map<string,typeof rows>();for(const r of rows){const key=r.input.origin.kind+':'+(r.input.origin.accountId??'local');const group=groups.get(key)??[];group.push(r);groups.set(key,group);}
  // A busy inbox must not starve sent mail, another account, calendars or Artifacts.
  const result:typeof rows=[];for(let i=0;result.length<rows.length;i++)for(const group of groups.values())if(group[i])result.push(group[i]);return result;
 }
 claim(slot:string,force=false,now=Date.now()){return this.store.transaction(()=>{
  const lease=this.get<{token:string;until:number}>('lease');if(lease&&lease.until>now)return null;
  if(!force&&this.get<string>('lastSlot')===slot&&this.get<ScanRun>('run')?.state!=='running')return null;
  const token=randomUUID();this.set('lease',{token,until:now+180000});this.set('lastSlot',slot);return token;
 });}
 owns(token:string){return this.get<{token:string;until:number}>('lease')?.token===token;}
 renew(token:string){if(this.owns(token))this.set('lease',{token,until:Date.now()+180000});}
 release(token:string){if(this.owns(token))this.set('lease',{token:'',until:0});}
 status(config:ScannerConfig|null):ScannerStatus{
  const available=new Set(this.store.availableSources().map(s=>s.id)),all=this.findings().filter(f=>!f.mergedInto);
  const current=(f:DcrFinding)=>({...f,sourceIds:f.sourceIds.filter(id=>available.has(id)),citations:f.citations.filter(c=>available.has(c.sourceId))});
  const relationshipEvidence=all.filter(f=>f.fields.kind==='relationship'&&f.state==='confirmed'&&f.recordId&&this.store.records().some(r=>r.id===f.recordId)).map(f=>({recordId:f.recordId!,sourceIds:current(f).sourceIds,citations:current(f).citations}));
  return {configured:!!config?.enabled,paused:this.get<boolean>('paused')===true,timezone:config?.timezone??'America/Chicago',hours:config?.hours??[6,10,12,15,17],accounts:config?.accounts.map(a=>a.email)??[],artifacts:config?.artifacts??false,lookbackDays:config?.lookbackDays??7,lastRun:this.get<ScanRun>('run'),pending:this.pending().length,relationshipEvidence,findings:all.filter(f=>f.state==='detected').flatMap(f=>f.fields.kind==='relationship'?(current(f).sourceIds.length?[current(f)]:[]):f.sourceIds.every(id=>available.has(id))?[f]:[])};
 }
 private mergeRelationship(primary:DcrFinding,incoming:Pick<DcrFinding,'citations'|'sourceIds'> & {fields?:DcrFields},now:string){
  const citations=[...primary.citations];for(const c of incoming.citations)if(!citations.some(p=>p.sourceId===c.sourceId&&p.quote===c.quote))citations.push(c);
  const sourceIds=[...new Set([...primary.sourceIds,...incoming.sourceIds])];
  const fields={...primary.fields,...(!primary.fields.email&&incoming.fields?.email?{email:incoming.fields.email}:{}),...(!primary.fields.organization&&incoming.fields?.organization?{organization:incoming.fields.organization}:{})};
  if(citations.length===primary.citations.length&&sourceIds.length===primary.sourceIds.length&&JSON.stringify(fields)===JSON.stringify(primary.fields))return primary;
  const next={...primary,fields,citations,sourceIds,revision:primary.revision+1,updatedAt:now};this.update(next);
  this.store.audit(primary.recordId??primary.id,'relationship_evidence_added',JSON.stringify({findingId:primary.id,sourceIds:incoming.sourceIds}));return next;
 }
 private relationshipFields(f:DcrFinding):DcrFields{
  const record=f.recordId?this.store.records().find(r=>r.id===f.recordId):undefined;
  return record?{...record,email:record.email||f.fields.email}:f.fields;
 }
 private relationshipRecords(f:DcrFields){
  const all=this.findings().filter(p=>!p.mergedInto&&p.state==='confirmed');
  return relationshipGroup(f,this.store.records(),r=>{
   const bindings=[...new Set(all.filter(p=>p.recordId===r.id).map(p=>p.fields.email.trim().toLowerCase()).filter(Boolean))];
   return !r.email&&bindings.length===1?{...r,email:bindings[0]}:r;
  });
 }
 /** Collapse scanner suggestions only; executive-authored fields and records stay intact. */
 consolidateRelationships(now=new Date().toISOString()){
  return this.store.transaction(()=>{
   const rank=(f:DcrFinding)=>f.state==='confirmed'?0:f.state==='detected'?1:2;
   const all=this.findings().filter(f=>f.fields.kind==='relationship'&&!f.mergedInto).sort((a,b)=>rank(a)-rank(b)||a.createdAt.localeCompare(b.createdAt)||a.id.localeCompare(b.id));
   let merged=0;const groups:DcrFinding[]=[];
   for(let f of all){
    const records=this.relationshipRecords(f.fields);
    if(records.length===1&&f.state!=='confirmed') {f={...f,state:'confirmed',recordId:records[0].id,revision:f.revision+1,updatedAt:now};this.update(f);}
    const candidates=relationshipGroup(this.relationshipFields(f),groups,p=>this.relationshipFields(p)).filter(p=>!p.recordId||!f.recordId||p.recordId===f.recordId);
    if(candidates.length===1){const primary=candidates[0],next=this.mergeRelationship(primary,f,now);groups[groups.indexOf(primary)]=next;this.update({...f,state:'dismissed',mergedInto:primary.id,revision:f.revision+1,updatedAt:now});this.store.audit(f.id,'relationship_grouped',primary.id);merged++;}
    else groups.push(f);
   }
   return merged;
  });
 }
 private collectRelationship(f:DcrFields,citations:DcrCitation[],now:string){
  const existing=relationshipGroup(f,this.findings().filter(p=>p.fields.kind==='relationship'&&!p.mergedInto),p=>this.relationshipFields(p));
  if(existing.length===1){let primary=existing[0];if(primary.state==='revalidating'){primary={...primary,state:'detected',revision:primary.revision+1,updatedAt:now};this.update(primary);}this.mergeRelationship(primary,{fields:f,citations,sourceIds:[...new Set(citations.map(c=>c.sourceId))]},now);return true;}
  const records=this.relationshipRecords(f);
  if(records.length===1){
   const record=records[0],finding:DcrFinding={id:randomUUID(),revision:1,fields:f,citations,explanation:'Additional supporting evidence for this saved relationship.',state:'confirmed',recordId:record.id,sourceIds:[...new Set(citations.map(c=>c.sourceId))],createdAt:now,updatedAt:now};
   this.store.db.prepare('INSERT INTO dcr_findings VALUES(?,?,?)').run(finding.id,scanHash(['relationship-evidence',record.id,finding.id]),JSON.stringify(finding));
   this.store.audit(record.id,'relationship_evidence_added',JSON.stringify({findingId:finding.id,sourceIds:finding.sourceIds}));return true;
  }
  return false;
 }
 saveFindings(raw:unknown,sourceIds:string[],now=new Date().toISOString()){
  insist(Array.isArray(raw)&&raw.length<=12,'Scanner returned invalid findings.');
  const sources=sourceIds.map(id=>this.store.source(id));
  const parsed=raw.map(value=>{
   insist(value&&typeof value==='object'&&typeof value.explanation==='string'&&value.explanation.length<=3000,'Scanner finding needs an explanation.');
   const target=value.targetRecordId?this.store.record(value.targetRecordId):undefined;
   const base=target?Object.fromEntries(Object.entries(target).filter(([k])=>Object.hasOwn(blankDcr(),k))):{};
   const proposed=target?Object.fromEntries(Object.entries(value.fields??{}).filter(([k,v])=>typeof v==='string'&&v.trim()&&!['priority','snoozedUntil','importance','preferences'].includes(k))):value.fields;
   const original=fields({...base,...proposed});insist(original.status!=='archived'&&(original.status!=='completed'||original.kind==='decision'),'Scanning cannot fulfill promises or close relationships.');
   const f=classifyScannedFields(original);
   insist(f.kind!=='relationship'||!!(f.personName&&f.recommendation),'Relationship findings need a named person and a suggested next interaction.');
   insist(Array.isArray(value.citations)&&value.citations.length>0&&value.citations.length<=8,'Detected items require source evidence.');
   const citations:DcrCitation[]=value.citations.map((c:DcrCitation)=>{insist(c&&typeof c.quote==='string'&&c.quote.length>=4&&c.quote.length<=1200&&sources.some(s=>s.id===c.sourceId&&s.text.includes(c.quote)),'Scanner evidence could not be verified.');return {sourceId:c.sourceId,quote:c.quote};});
   if(f.kind==='relationship'&&(!hasRelationshipEvidence(citations)||!hasRelationshipPerson(f)))return null;
   insist(!target||target.kind===f.kind,'Scanner cannot change record type.');insist(!target||target.revision===value.targetRevision,'The existing record changed during scanning. Retry with current context.',409);
   return {f,citations,target,explanation:f.kind!==original.kind?`A choice is still open: ${f.what} This is a decision to make, not an accepted promise.`:value.explanation};
  }).filter((value):value is NonNullable<typeof value>=>value!==null);
  this.consolidateRelationships(now);
  let added=0;
  const surfacedBeforeBatch=this.findings(),sourceHistory=this.store.sources();
  for(const {f,citations,target,explanation} of parsed){
   if(f.kind==='relationship'&&this.collectRelationship(f,citations,now))continue;
   const fingerprint=findingFingerprint(f,target?.id,target?.revision);
   const oldRow=this.store.db.prepare('SELECT body FROM dcr_findings WHERE fingerprint=?').get(fingerprint);
   const old=oldRow?JSON.parse(String(oldRow.body)) as DcrFinding:undefined;
   if(old&&old.state!=='revalidating')continue;
   // Retain the entire surfaced history, including dismissed findings. Provider edits
   // can generate a new source version and the model can paraphrase the same item.
   const sameEvidence=(a:DcrCitation,b:DcrCitation)=>{
    if(normalize(a.quote)!==normalize(b.quote))return false;
    const left=sourceHistory.find(s=>s.id===a.sourceId)?.origin,right=sourceHistory.find(s=>s.id===b.sourceId)?.origin;
    return a.sourceId===b.sourceId||!!(left&&right&&left.kind===right.kind&&left.accountId===right.accountId&&left.externalId===right.externalId);
   };
   const organization=(s:string)=>normalize(s.replace(/\b(?:llc|incorporated|inc|ltd|limited)\.?\s*$/i,''));
   if(f.kind!=='relationship'&&surfacedBeforeBatch.some(prior=>prior.state!=='revalidating'&&(
    // A forwarded message and its original notice can describe the same question.
    !!f.email&&normalize(prior.fields.email)===normalize(f.email)&&normalize(prior.fields.title)===normalize(f.title)&&prior.fields.dueDate===f.dueDate&&organization(prior.fields.organization)===organization(f.organization)||
    prior.fields.kind===f.kind&&(identity(prior.fields)===identity(f)&&normalize(prior.fields.what)===normalize(f.what)||
     citations.every(c=>prior.citations.some(p=>sameEvidence(c,p)))))))continue;
   if(!target&&this.store.records().some(r=>r.kind===f.kind&&normalize(r.title)===normalize(f.title)&&identity(r)===identity(f)))continue;
   const item:DcrFinding={id:old?.id??randomUUID(),revision:(old?.revision??0)+1,fields:f,citations,explanation,state:'detected',sourceIds:[...new Set(citations.map(c=>c.sourceId))],createdAt:old?.createdAt??now,updatedAt:now,...(target?{targetRecordId:target.id,targetRevision:target.revision}:{})};
   this.store.db.prepare('INSERT INTO dcr_findings VALUES(?,?,?) ON CONFLICT(fingerprint) DO UPDATE SET body=excluded.body').run(item.id,fingerprint,JSON.stringify(item));added++;
  }
  return added;
 }
 editRelationship(id:string,revision:number,input:unknown){return this.store.transaction(()=>{
  const f=this.findings().find(x=>x.id===id);insist(f&&f.revision===revision&&f.state==='detected'&&!f.mergedInto,'This detected item changed. Refresh and review it again.',409);
  const value=fields(input);insist(f.fields.kind==='relationship'&&value.kind==='relationship','Choose a detected relationship.');
  const next={...f,fields:value,revision:f.revision+1,updatedAt:new Date().toISOString()};this.update(next);this.store.audit(f.id,'relationship_edited','Executive updated detected relationship');return next;
 });}
 decide(id:string,revision:number,decision:'confirm'|'dismiss',input?:unknown){return this.store.transaction(()=>{
  const f=this.findings().find(x=>x.id===id);insist(f&&f.revision===revision&&f.state==='detected'&&!f.mergedInto,'This detected item changed. Refresh and review it again.',409);
  if(decision==='dismiss'){this.update({...f,state:'dismissed',revision:f.revision+1});return {ok:true};}
  const available=new Set(this.store.availableSources().map(s=>s.id));
  const sourceIds=f.fields.kind==='relationship'?f.sourceIds.filter(id=>available.has(id)).slice(0,8):f.sourceIds;
  insist(sourceIds.length>0,'Source evidence is no longer available.');sourceIds.forEach(id=>this.store.source(id));const value=fields(input??f.fields);insist(value.kind===f.fields.kind,'Keep the detected category or create a separate record.');
  const r=this.store.save(value,f.targetRecordId,f.targetRevision,sourceIds,f.targetRecordId?this.store.record(f.targetRecordId).linkedIds:[]);
  this.update({...f,...(value.kind==='relationship'?{fields:value}:{}),state:'confirmed',recordId:r.id,revision:f.revision+1});this.store.audit(r.id,'scanner_confirmed','Executive confirmed detected finding '+f.id);return r;
 });}
}
