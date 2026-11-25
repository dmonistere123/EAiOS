// @vitest-environment node
import {expect,it} from 'vitest';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';import {join} from 'node:path';import {DatabaseSync} from 'node:sqlite';
import {requestArtifactShare,shareSnapshot} from '../../server/artifactSharing';
it('prepares an unassigned approval and immutable snapshot without publishing',()=>{
 const root=mkdtempSync(join(tmpdir(),'share-approval-'));
 try{
 mkdirSync(join(root,'eaios'));mkdirSync(join(root,'kanban','attachments'),{recursive:true});
 const sshConfig=join(root,'ssh-config');writeFileSync(sshConfig,'# fixture only');
 writeFileSync(join(root,'eaios','artifact-sharing.json'),JSON.stringify({sshConfig,sshHost:'test-host',remoteRoot:'/srv/test/eaios-shares',publicBaseUrl:'https://example.test/eaios-shares'}));
 const file=join(root,'kanban','attachments','report.txt');writeFileSync(file,'Reviewed bytes');
 const db=new DatabaseSync(join(root,'kanban.db'));
 try{
 db.exec('CREATE TABLE tasks(id TEXT PRIMARY KEY,title TEXT,body TEXT,status TEXT,assignee TEXT,block_kind TEXT,created_by TEXT,created_at INTEGER); CREATE TABLE task_events(task_id TEXT,kind TEXT,payload TEXT,created_at INTEGER); CREATE TABLE task_attachments(id INTEGER,task_id TEXT,stored_path TEXT,filename TEXT,content_type TEXT);');
 db.prepare('INSERT INTO task_attachments VALUES(1,NULL,?,?,?)').run(file,'report.txt','text/plain');
 const ctx={hermesHome:root,eaiosRoot:root};const result=requestArtifactShare(ctx,'att-1');
 const row=db.prepare('SELECT * FROM tasks WHERE id=?').get(result.auditEventId)!;
 expect(row.assignee).toBe(null);expect(row.status).toBe('blocked');
 const env=JSON.parse(String(row.body));expect(env.actionType).toBe('publish');expect(env.decision).toBeUndefined();
 expect(requestArtifactShare(ctx,'att-1').auditEventId).toBe(result.auditEventId);
 writeFileSync(file,'Changed after review');expect(Buffer.from(shareSnapshot(root,env.artifactShare.id)!.content).toString()).toBe('Reviewed bytes');
 expect(db.prepare('SELECT status FROM eaios_artifact_shares').get()!.status).toBe('pending');
 }finally{db.close();}
 }finally{rmSync(root,{recursive:true,force:true});}
});
