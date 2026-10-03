// @vitest-environment node
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {requestArtifacts} from '../../server/assistantArtifacts';
import {savedEvidence} from '../../server/assistantEvidence';
let root:string;
beforeEach(()=>{vi.useFakeTimers();root=mkdtempSync(join(tmpdir(),'eaios-lineage-'));});
afterEach(()=>{vi.useRealTimers();rmSync(root,{recursive:true,force:true});});
it('excludes independent branches/resets/tool/delegate descendants and follows only proved compression',()=>{
 const state=new DatabaseSync(join(root,'state.db'));state.exec(`CREATE TABLE sessions(id TEXT,parent_session_id TEXT,end_reason TEXT,model_config TEXT,source TEXT,started_at REAL,ended_at REAL,last_activity_at REAL);
 CREATE TABLE messages(id INTEGER,session_id TEXT,role TEXT,content TEXT,display_kind TEXT);
 INSERT INTO sessions VALUES('root',NULL,'compression','{}','tui',0,1,1),('tip','root',NULL,'{}','tui',1,NULL,2),
 ('branch','root',NULL,'{"_branched_from":"root"}','tui',3,NULL,100),('reset','root',NULL,'{"_reset_from":"root"}','tui',4,NULL,101),
 ('delegate','root',NULL,'{"_delegate_from":"root"}','tui',5,NULL,102),('tool','root',NULL,'{}','tool',6,NULL,103),
 ('independent','tip',NULL,'{}','tui',7,NULL,104);
 INSERT INTO messages VALUES(1,'tip','assistant','own saved answer',NULL),(2,'branch','assistant','wrong answer',NULL);`);state.close();
 const db=new DatabaseSync(join(root,'kanban.db'));db.exec('CREATE TABLE tasks(id TEXT,session_id TEXT);CREATE TABLE task_attachments(id INTEGER,task_id TEXT,filename TEXT,created_at INTEGER)');
 ['root','tip','branch','reset','delegate','tool','independent'].forEach((id,n)=>{db.prepare('INSERT INTO tasks VALUES(?,?)').run('task-'+id,id);db.prepare('INSERT INTO task_attachments VALUES(?,?,?,?)').run(n,'task-'+id,id+'.txt',n);});db.close();
 expect(requestArtifacts(root,['root']).taskIds).toEqual(['task-root','task-tip']);expect(savedEvidence(root,'root').response).toBe('own saved answer');
});
it('bounds artifact output and caches repeated polling while retaining late-output visibility',()=>{
 const state=new DatabaseSync(join(root,'state.db'));state.exec("CREATE TABLE sessions(id TEXT,parent_session_id TEXT,end_reason TEXT,model_config TEXT,source TEXT,started_at REAL,ended_at REAL,last_activity_at REAL);INSERT INTO sessions VALUES('root',NULL,NULL,'{}','tui',0,NULL,0)");state.close();
 const db=new DatabaseSync(join(root,'kanban.db'));db.exec('CREATE TABLE tasks(id TEXT,session_id TEXT);CREATE TABLE task_attachments(id INTEGER,task_id TEXT,filename TEXT,created_at INTEGER)');
 for(let n=0;n<205;n++){db.prepare('INSERT INTO tasks VALUES(?,?)').run('task-'+n,'root');db.prepare('INSERT INTO task_attachments VALUES(?,?,?,?)').run(n,'task-'+n,'output.txt',n);}
 const first=requestArtifacts(root,['root']);expect(first.taskIds).toHaveLength(200);expect(first.artifacts.length).toBeLessThanOrEqual(200);expect(first.linkageLimited).toBe(true);
 db.prepare('INSERT INTO task_attachments VALUES(?,?,?,?)').run(999,'task-0','late.txt',999);db.close();expect(requestArtifacts(root,['root'])).toBe(first);
 vi.advanceTimersByTime(10001);expect(requestArtifacts(root,['root']).artifacts.some(a=>a.name==='late.txt')).toBe(true);
});
