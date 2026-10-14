// @vitest-environment node
import {afterEach,expect,it} from 'vitest';
import {mkdtempSync,mkdirSync,writeFileSync,existsSync,rmSync,symlinkSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {deleteArtifact} from '../../server/artifactDelete.ts';
const roots:string[]=[];
afterEach(()=>{for(const root of roots.splice(0))rmSync(root,{recursive:true,force:true});});
function setup(){const home=mkdtempSync(join(tmpdir(),'artifact-delete-'));roots.push(home);const folder=join(home,'kanban','attachments');mkdirSync(folder,{recursive:true});const file=join(folder,'report.md');writeFileSync(file,'report');const db=new DatabaseSync(join(home,'kanban.db'));db.exec("CREATE TABLE task_attachments(id INTEGER PRIMARY KEY,stored_path TEXT);CREATE TABLE tasks(id TEXT);INSERT INTO tasks VALUES ('keep');");db.prepare('INSERT INTO task_attachments VALUES(1,?)').run(file);db.close();return {home,file};}
function sql(home:string,query:string,...args:string[]){const db=new DatabaseSync(join(home,'kanban.db'));try{return db.prepare(query).all(...args);}finally{db.close();}}
it('deletes the selected file and attachment but preserves the task',()=>{const {home,file}=setup();expect(deleteArtifact(home,'att-1').ok).toBe(true);expect(existsSync(file)).toBe(false);expect(sql(home,'SELECT * FROM task_attachments')).toHaveLength(0);expect(sql(home,'SELECT * FROM tasks')).toHaveLength(1);});
it('retains a shared file until its last attachment is deleted',()=>{const {home,file}=setup();sql(home,'INSERT INTO task_attachments VALUES(2,?)',file);expect(deleteArtifact(home,'att-1').sharedFileRetained).toBe(true);expect(existsSync(file)).toBe(true);deleteArtifact(home,'att-2');expect(existsSync(file)).toBe(false);});
it('rejects paths outside artifact storage and symbolic links',()=>{const {home,file}=setup();const outside=join(home,'private.txt');writeFileSync(outside,'private');sql(home,'UPDATE task_attachments SET stored_path=?',outside);expect(()=>deleteArtifact(home,'att-1')).toThrow();const link=join(home,'kanban','attachments','link');symlinkSync(outside,link);sql(home,'UPDATE task_attachments SET stored_path=?',link);expect(()=>deleteArtifact(home,'att-1')).toThrow();expect(readFileSync(outside,'utf8')).toBe('private');expect(existsSync(file)).toBe(true);});
it('restores the file if the database rejects deletion',()=>{const {home,file}=setup();const db=new DatabaseSync(join(home,'kanban.db'));db.exec("CREATE TRIGGER prevent_delete BEFORE DELETE ON task_attachments BEGIN SELECT RAISE(ABORT,'blocked'); END;");db.close();expect(()=>deleteArtifact(home,'att-1')).toThrow();expect(readFileSync(file,'utf8')).toBe('report');expect(sql(home,'SELECT * FROM task_attachments')).toHaveLength(1);});
it('rejects release reports, malformed IDs and duplicate deletion',()=>{const {home}=setup();for(const id of ['release-0.1.10','att-1/../../private','att-0'])expect(()=>deleteArtifact(home,id)).toThrow();deleteArtifact(home,'att-1');expect(()=>deleteArtifact(home,'att-1')).toThrow();});
it('HTTP deletion rejects cross-origin requests and accepts an explicit same-origin request',async()=>{
 const {createServer}=await import('node:http');const {handleApiRequest}=await import('../../server/httpApi.ts');const {home,file}=setup();
 const server=createServer((req,res)=>{void handleApiRequest(req,res,{hermesHome:home,eaiosRoot:home}).then(handled=>{if(!handled){res.statusCode=404;res.end();}});});
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
 try{const base=`http://127.0.0.1:${(server.address() as {port:number}).port}`;
 const denied=await fetch(base+'/api/artifacts/att-1',{method:'DELETE',headers:{Origin:'https://unrelated.example','Content-Type':'application/json'},body:'{}'});expect(denied.status).toBe(403);expect(existsSync(file)).toBe(true);
 const allowed=await fetch(base+'/api/artifacts/att-1',{method:'DELETE',headers:{Origin:base,'Content-Type':'application/json'},body:'{}'});expect(allowed.status).toBe(200);expect(existsSync(file)).toBe(false);
 }finally{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}
});
