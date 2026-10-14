/** H1 persistence. This module cannot send mail or assign a Hermes worker. */
import { DatabaseSync } from 'node:sqlite';
import { chmodSync, mkdirSync, lstatSync, openSync, closeSync, constants } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { HumanContact, HumanContactInput, HumanDelegation, HumanDelegationEvent } from '../src/domain/humanDelegation.ts';
export class HumanDelegationError extends Error {
  status: number;
  constructor(status: number, message: string) {super(message);this.status=status;}
}
export function humanDatabasePath(hermesHome: string) {return join(hermesHome,'eaios','human-delegation.db');}
function privateFile(file: string) {
  const fd=openSync(file,constants.O_CREAT|constants.O_RDWR|constants.O_NOFOLLOW,0o600);
  closeSync(fd);
  if(!lstatSync(file).isFile())throw new HumanDelegationError(503,'Human delegation storage is unavailable.');
  chmodSync(file,0o600);
}
export function humanStore<T>(hermesHome: string, run: (db: DatabaseSync)=>T): T {
  const dir=join(hermesHome,'eaios');mkdirSync(dir,{recursive:true,mode:0o700});
  if(lstatSync(dir).isSymbolicLink())throw new HumanDelegationError(503,'Human delegation storage must be a private directory.');
  const file=humanDatabasePath(hermesHome);privateFile(file);
  const db=new DatabaseSync(file);
  try {
    db.exec(`PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON; PRAGMA journal_mode=DELETE; BEGIN IMMEDIATE;
      CREATE TABLE IF NOT EXISTS human_schema (version INTEGER PRIMARY KEY);
      CREATE TABLE IF NOT EXISTS human_contacts (id TEXT PRIMARY KEY, email_key TEXT NOT NULL UNIQUE, body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS human_delegations (id TEXT PRIMARY KEY, work_item_id TEXT NOT NULL, contact_id TEXT NOT NULL REFERENCES human_contacts(id), status TEXT NOT NULL, body TEXT NOT NULL);
      CREATE UNIQUE INDEX IF NOT EXISTS one_active_human_delegation ON human_delegations(work_item_id)
        WHERE status NOT IN ('rejected','completed','declined','cancelled','send_failed');
      CREATE TABLE IF NOT EXISTS human_delegation_artifacts (delegation_id TEXT NOT NULL REFERENCES human_delegations(id), artifact_id TEXT NOT NULL, filename TEXT NOT NULL, mime_type TEXT NOT NULL, size_bytes INTEGER NOT NULL, content_hash TEXT NOT NULL, PRIMARY KEY(delegation_id,artifact_id));
      CREATE TABLE IF NOT EXISTS human_delegation_deliveries (delegation_id TEXT NOT NULL REFERENCES human_delegations(id), attempt INTEGER NOT NULL, provider TEXT NOT NULL, account TEXT NOT NULL, status TEXT NOT NULL, provider_message_id TEXT, sent_at TEXT, PRIMARY KEY(delegation_id,attempt));
      CREATE TABLE IF NOT EXISTS human_delegation_events (id INTEGER PRIMARY KEY, delegation_id TEXT NOT NULL REFERENCES human_delegations(id), event_type TEXT NOT NULL, actor_type TEXT NOT NULL, note TEXT NOT NULL, occurred_at TEXT NOT NULL);
      INSERT OR IGNORE INTO human_schema VALUES(1);`);
    try {const result=run(db);db.exec('COMMIT');return result;}catch(e){db.exec('ROLLBACK');throw e;}
  } finally {db.close();}
}
function text(value: unknown, max: number, label: string, required=false): string {
  if(value===undefined&&!required)return '';
  if(typeof value!=='string'||value.length>max||[...value].some(c=>{const n=c.charCodeAt(0);return n===127||(n<32&&![9,10,13].includes(n));}))throw new HumanDelegationError(400,`Invalid ${label}.`);
  const clean=value.trim();if(required&&!clean)throw new HumanDelegationError(400,`${label} is required.`);return clean;
}
export function validateHumanContact(input: Record<string,unknown>): HumanContactInput {
  const displayName=text(input.displayName,160,'display name',true);
  const email=text(input.email,254,'email',true);
  if(/[\r\n]/.test(displayName)||! /^[^\s<>@,;]+@[^\s<>@,;]+\.[^\s<>@,;]+$/.test(email))throw new HumanDelegationError(400,'Enter a single valid email address and name.');
  const phone=text(input.phone,64,'phone');if(phone&&!/^[+\d(). xext-]+$/i.test(phone))throw new HumanDelegationError(400,'Enter a valid phone number.');
  const timeZone=text(input.timeZone,100,'time zone');if(timeZone){try{new Intl.DateTimeFormat('en',{timeZone});}catch{throw new HumanDelegationError(400,'Choose a valid time zone.');}}
  return {displayName,email,phone,title:text(input.title,160,'title'),organization:text(input.organization,200,'organization'),timeZone,notes:text(input.notes,4000,'notes')};
}
function contact(db: DatabaseSync,id: string): HumanContact {
  const row=db.prepare('SELECT body FROM human_contacts WHERE id=?').get(id) as {body:string}|undefined;
  if(!row)throw new HumanDelegationError(404,'Human assistant not found.');return JSON.parse(row.body);
}
function putContact(db: DatabaseSync,c: HumanContact) {
  const duplicate=db.prepare('SELECT id FROM human_contacts WHERE email_key=? AND id<>?').get(c.email.toLowerCase(),c.id);
  if(duplicate)throw new HumanDelegationError(409,'A contact with this email already exists, including retired contacts.');
  db.prepare('INSERT INTO human_contacts VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET email_key=excluded.email_key,body=excluded.body').run(c.id,c.email.toLowerCase(),JSON.stringify(c));
}
export function listHumanContacts(home: string): HumanContact[] {return humanStore(home,db=>(db.prepare('SELECT body FROM human_contacts ORDER BY email_key').all() as {body:string}[]).map(r=>JSON.parse(r.body)));}
export function createHumanContact(home: string,input: Record<string,unknown>): HumanContact {
  const fields=validateHumanContact(input),now=new Date().toISOString();
  return humanStore(home,db=>{const c:HumanContact={...fields,id:'hc_'+randomUUID(),active:true,revision:1,createdAt:now,updatedAt:now};putContact(db,c);return c;});
}
export function updateHumanContact(home: string,id: string,input: Record<string,unknown>,retire=false): HumanContact {
  return humanStore(home,db=>{const c=contact(db,id);if(input.revision!==c.revision)throw new HumanDelegationError(409,'This contact changed. Reload before saving.');
    const next={...c,...(retire?{active:false}:validateHumanContact(input)),revision:c.revision+1,updatedAt:new Date().toISOString()};putContact(db,next);return next;});
}
export function listHumanDelegations(home: string): HumanDelegation[] {return humanStore(home,db=>(db.prepare('SELECT body FROM human_delegations ORDER BY rowid DESC').all() as {body:string}[]).map(r=>{
 const d:HumanDelegation=JSON.parse(r.body);
 if(d.status==='sending'&&Date.now()-Date.parse(d.updatedAt)>15*60*1000){d.status='delivery_uncertain';d.revision++;d.deliveryError='Sending was interrupted. Check Sent mail; this message will not be automatically retried.';db.prepare('UPDATE human_delegations SET status=?,body=? WHERE id=?').run(d.status,JSON.stringify(d),d.id);db.prepare('INSERT INTO human_delegation_events(delegation_id,event_type,actor_type,note,occurred_at) VALUES(?,?,?,?,?)').run(d.id,'interrupted_send','system',d.deliveryError,new Date().toISOString());}
 return d;
}));}
export function getHumanDelegation(home: string,id: string): {delegation:HumanDelegation;events:HumanDelegationEvent[]} {
  return humanStore(home,db=>{const row=db.prepare('SELECT body FROM human_delegations WHERE id=?').get(id) as {body:string}|undefined;
    if(!row)throw new HumanDelegationError(404,'Human delegation not found.');
    const events=db.prepare('SELECT id,delegation_id AS delegationId,event_type AS eventType,actor_type AS actorType,note,occurred_at AS occurredAt FROM human_delegation_events WHERE delegation_id=? ORDER BY id').all(id) as unknown as HumanDelegationEvent[];
    return {delegation:JSON.parse(row.body),events};});
}
/** Internal repository entry point: caller must resolve the real task before calling.
 * Not exposed via HTTP until package/approval validation is implemented. */
export function createHumanDelegationDraft(home: string,workItemId: string,contactId: string,instructions=''): HumanDelegation {
  if(!/^t_[a-zA-Z0-9_-]{1,100}$/.test(workItemId))throw new HumanDelegationError(400,'Invalid task reference.');
  const note=text(instructions,8000,'instructions');
  return humanStore(home,db=>insertHumanDraft(db,workItemId,contactId,note));
}
function insertHumanDraft(db:DatabaseSync,workItemId:string,contactId:string,note:string):HumanDelegation {
  const c=contact(db,contactId);if(!c.active)throw new HumanDelegationError(409,'This human assistant is retired.');
    if(db.prepare("SELECT id FROM human_delegations WHERE work_item_id=? AND status NOT IN ('rejected','completed','declined','cancelled','send_failed')").get(workItemId))throw new HumanDelegationError(409,'This task already has an active human delegation.');
    const now=new Date().toISOString(),d:HumanDelegation={id:'hd_'+randomUUID(),workItemId,contactId,status:'draft',instructions:note,revision:1,createdAt:now,updatedAt:now};
    db.prepare('INSERT INTO human_delegations VALUES(?,?,?,?,?)').run(d.id,workItemId,contactId,d.status,JSON.stringify(d));
    db.prepare('INSERT INTO human_delegation_events(delegation_id,event_type,actor_type,note,occurred_at) VALUES(?,?,?,?,?)').run(d.id,'draft_created','executive','No email sent.',now);return d;
}

/** Draft-only preparation. No dispatcher assignment and no provider write. */
export function prepareHumanDraft(home:string,input:Record<string,unknown>,sender: import('../src/domain/mailRouting.ts').MailboxIdentity):HumanDelegation {
  if(typeof input.workItemId!=='string'||typeof input.contactId!=='string')throw new HumanDelegationError(400,'Choose a task and human assistant.');
  const tasks=new DatabaseSync(join(home,'kanban.db'),{readOnly:true});
  let task:{title:string;body:string;assignee:string|null;status:string;claim_lock?:string|null;current_run_id?:number|null}|undefined;
  try {task=tasks.prepare('SELECT * FROM tasks WHERE id=?').get(input.workItemId) as typeof task;}finally{tasks.close();}
  if(!task)throw new HumanDelegationError(404,'Task not found.');
  if(task.assignee||task.claim_lock||task.current_run_id||!['todo','triage','ready','blocked'].includes(task.status))throw new HumanDelegationError(409,'Only idle, unassigned work can be prepared for a human assistant.');
  try{if(JSON.parse(task.body)?.eaios==='approval')throw new HumanDelegationError(409,'An approval cannot be delegated as a human task.');}catch(e){if(e instanceof HumanDelegationError)throw e;}
  const instructions=text(input.instructions,8000,'instructions');
  const dueAt=text(input.dueAt,50,'due date');if(dueAt&&!Number.isFinite(Date.parse(dueAt)))throw new HumanDelegationError(400,'Choose a valid due date.');
  const workItemId=input.workItemId,contactId=input.contactId;
  if(!/^t_[a-zA-Z0-9_-]{1,100}$/.test(workItemId))throw new HumanDelegationError(400,'Invalid task reference.');
  return humanStore(home,db=>{
    const d=insertHumanDraft(db,workItemId,contactId,instructions);
    const c=contact(db,d.contactId);
    const subject='Delegation: '+task!.title.replace(/[\r\n]/g,' ').slice(0,180);
    const body=`Hello ${c.displayName},\n\nTask: ${task!.title}\n\nContext:\n${task!.body??''}\n\nRequested outcome / instructions:\n${instructions||'Please complete the task described above.'}${dueAt?'\n\nDue: '+dueAt:''}\n\nPlease reply with your progress or any questions.`;
    const pkg={recipient:{displayName:c.displayName,email:c.email},sender:{provider:sender.provider,accountId:sender.connectionId,email:sender.email},subject,body,artifacts:[],packageHash:''};
    // Hash and attachment selection are finalized only at the future approval boundary.
    const next:HumanDelegation={...d,...(dueAt?{dueAt}:{}),package:pkg};
    db.prepare('UPDATE human_delegations SET body=? WHERE id=?').run(JSON.stringify(next),d.id);return next;
  });
}
