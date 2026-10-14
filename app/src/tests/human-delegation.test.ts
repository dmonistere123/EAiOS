// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync, statSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createHumanContact, updateHumanContact, listHumanContacts, createHumanDelegationDraft, getHumanDelegation, humanDatabasePath } from '../../server/humanDelegation.ts';
const roots:string[]=[];
const setup=()=>{const root=mkdtempSync(join(tmpdir(),'hea-test-'));roots.push(root);return root;};
afterEach(()=>{vi.unstubAllGlobals();roots.splice(0).forEach(p=>rmSync(p,{recursive:true,force:true}));});
it('persists private contacts across reopening and rejects duplicates including retired contacts',()=>{
 const home=setup();const c=createHumanContact(home,{displayName:' Jane Example ',email:'Jane@example.com',timeZone:'America/Chicago'});
 expect(c.displayName).toBe('Jane Example');expect(listHumanContacts(home)).toEqual([c]);expect(statSync(humanDatabasePath(home)).mode&0o777).toBe(0o600);
 expect(()=>createHumanContact(home,{displayName:'Other',email:'jane@example.com'})).toThrow('already exists');
 const retired=updateHumanContact(home,c.id,{revision:c.revision},true);expect(retired.active).toBe(false);
 expect(()=>createHumanDelegationDraft(home,'t_example',c.id)).toThrow('retired');
 expect(()=>createHumanContact(home,{displayName:'Other',email:'jane@example.com'})).toThrow('already exists');
});
it('validates email injection, malformed contacts and stale edits',()=>{
 const home=setup();for(const fields of [{displayName:'Jane\r\nBcc: x',email:'j@example.com'},{displayName:'Jane',email:'a@example.com,b@example.com'},{displayName:'Jane',email:'j@example.com',timeZone:'Mars'},{displayName:'Jane',email:'j@example.com',phone:'<script>'}])expect(()=>createHumanContact(home,fields)).toThrow();
 const c=createHumanContact(home,{displayName:'Jane',email:'j@example.com'});const updated=updateHumanContact(home,c.id,{...c,notes:'Updated'});
 expect(updated.revision).toBe(2);expect(()=>updateHumanContact(home,c.id,{...c,notes:'Lost update'})).toThrow('changed');
});
it('creates one durable draft without sending or touching Hermes assignments and preserves history on retirement',()=>{
 const home=setup(),fetcher=vi.fn();vi.stubGlobal('fetch',fetcher);writeFileSync(join(home,'kanban.db'),'untouched-kanban');writeFileSync(join(home,'SOUL.md'),'custom-agent');
 const c=createHumanContact(home,{displayName:'Jane',email:'j@example.com'}),d=createHumanDelegationDraft(home,'t_example',c.id,'Prepare a briefing');
 expect(getHumanDelegation(home,d.id).delegation.status).toBe('draft');expect(getHumanDelegation(home,d.id).events[0].note).toBe('No email sent.');
 expect(()=>createHumanDelegationDraft(home,'t_example',c.id)).toThrow('active human delegation');
 updateHumanContact(home,c.id,{revision:c.revision},true);expect(getHumanDelegation(home,d.id).delegation.contactId).toBe(c.id);
 expect(readFileSync(join(home,'kanban.db'),'utf8')).toBe('untouched-kanban');expect(readFileSync(join(home,'SOUL.md'),'utf8')).toBe('custom-agent');expect(fetcher).not.toHaveBeenCalled();
});
it('release backup preserves the private directory and delegation history',async()=>{
 const home=setup(),backupDir=join(home,'backup');const c=createHumanContact(home,{displayName:'Jane',email:'j@example.com'});const d=createHumanDelegationDraft(home,'t_backup',c.id);
 // Real installer backup function and real SQLite backup; all paths are disposable fixtures.
 // @ts-expect-error Installer is a JavaScript CLI module without declarations.
 const {backupPersistentData}=await import('../../../scripts/install-release.mjs');
 await backupPersistentData({hermesHome:home,dataRoot:home,stateDir:join(home,'eaios'),repoRoot:home},backupDir);
 const db=new DatabaseSync(join(backupDir,'human-delegation.db'),{readOnly:true});try{expect(db.prepare('SELECT id FROM human_delegations').get()).toEqual({id:d.id});expect(db.prepare('SELECT count(*) AS n FROM human_delegation_events').get()).toEqual({n:1});}finally{db.close();}
 expect(statSync(join(backupDir,'human-delegation.db')).mode&0o777).toBe(0o600);
});
it('HTTP directory requires same-origin JSON, keeps responses private, and refuses sending',async()=>{
 const {createServer}=await import('node:http');const {handleApiRequest}=await import('../../server/httpApi.ts');
 const home=setup();const server=createServer((req,res)=>{void handleApiRequest(req,res,{hermesHome:home,eaiosRoot:home,dataRoot:home});});
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
 const address=server.address();if(!address||typeof address==='string')throw new Error('No test address');const base='http://127.0.0.1:'+address.port;
 try {
  const denied=await fetch(base+'/api/human-contacts',{method:'POST',headers:{'content-type':'application/json',origin:'https://untrusted.example'},body:JSON.stringify({displayName:'Jane',email:'j@example.com'})});expect(denied.status).toBe(403);
  const created=await fetch(base+'/api/human-contacts',{method:'POST',headers:{'content-type':'application/json',origin:base},body:JSON.stringify({displayName:'Jane',email:'j@example.com'})});expect(created.status).toBe(201);expect(created.headers.get('cache-control')).toBe('no-store');
  const listing=await fetch(base+'/api/human-contacts');expect(await listing.json()).toHaveLength(1);
  const send=await fetch(base+'/api/human-delegations',{method:'POST',headers:{'content-type':'application/json',origin:base},body:'{}'});expect(send.status).toBe(405);expect((await send.json()).error).toContain('No email was sent');
 }finally{await new Promise<void>(resolve=>server.close(()=>resolve()));}
});
it('rejects symlinked database storage without touching its target',async()=>{
 const {mkdirSync,symlinkSync}=await import('node:fs');const home=setup(),target=join(home,'target');writeFileSync(target,'private existing file');mkdirSync(join(home,'eaios'));symlinkSync(target,humanDatabasePath(home));
 expect(()=>listHumanContacts(home)).toThrow();expect(readFileSync(target,'utf8')).toBe('private existing file');
});
it('database constraint prevents two independent writers from reserving the same task',()=>{
 const home=setup(),c=createHumanContact(home,{displayName:'Jane',email:'j@example.com'});createHumanDelegationDraft(home,'t_same',c.id);
 const db=new DatabaseSync(humanDatabasePath(home));try{expect(()=>db.prepare('INSERT INTO human_delegations VALUES(?,?,?,?,?)').run('hd_other','t_same',c.id,'draft','{}')).toThrow();}finally{db.close();}
});
it('prepares a real task draft with the configured business sender without assigning or sending',async()=>{
 const {prepareHumanDraft}=await import('../../server/humanDelegation.ts');
 const home=setup(),c=createHumanContact(home,{displayName:'Jane',email:'j@example.com'});
 const db=new DatabaseSync(join(home,'kanban.db'));db.exec('CREATE TABLE tasks(id TEXT,title TEXT,body TEXT,status TEXT,assignee TEXT)');db.prepare('INSERT INTO tasks VALUES(?,?,?,?,?)').run('t_ready','Briefing','Prepare context','todo',null);
 const fetcher=vi.fn();vi.stubGlobal('fetch',fetcher);
 try{
 const sender={connectionId:'ca_business',provider:'outlook' as const,email:'business@example.com',providerUserId:'business-id',verifiedAt:new Date().toISOString()};
 const d=prepareHumanDraft(home,{workItemId:'t_ready',contactId:c.id,instructions:'Deliver a one-page summary'},sender);
 expect(d.package?.sender.email).toBe(sender.email);expect(d.package?.recipient.email).toBe(c.email);
 expect(getHumanDelegation(home,d.id).delegation.package?.body).toContain('Deliver a one-page summary');
 expect(db.prepare('SELECT assignee,status FROM tasks').get()).toEqual({assignee:null,status:'todo'});expect(fetcher).not.toHaveBeenCalled();
 db.prepare('INSERT INTO tasks VALUES(?,?,?,?,?)').run('t_assigned','Busy','Context','ready','ally');
 expect(()=>prepareHumanDraft(home,{workItemId:'t_assigned',contactId:c.id},sender)).toThrow('unassigned');
 }finally{db.close();}
});
