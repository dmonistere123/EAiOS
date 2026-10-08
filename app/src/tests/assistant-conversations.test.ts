// @vitest-environment node
import {afterEach, beforeEach, expect, it} from 'vitest';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync, readFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {readConversation} from '../../server/assistantConversations';
import {conversationCheckpoint, savedEvidence} from '../../server/assistantEvidence';
let home:string;
beforeEach(()=>{
 home=mkdtempSync(join(tmpdir(),'eaios-conversations-'));
 const db=new DatabaseSync(join(home,'state.db'));
 db.exec(`CREATE TABLE sessions(id TEXT,parent_session_id TEXT,end_reason TEXT,model_config TEXT,source TEXT,started_at REAL,ended_at REAL,last_activity_at REAL);
 CREATE TABLE messages(id INTEGER PRIMARY KEY,session_id TEXT,role TEXT,content TEXT,display_kind TEXT);
 INSERT INTO sessions VALUES('root',NULL,'compression','{}','tui',0,1,1),('tip','root',NULL,'{}','tui',1,NULL,2),('branch','root',NULL,'{"_branched_from":"root"}','tui',3,NULL,3),('worker',NULL,NULL,'{}','kanban',4,NULL,4);
 INSERT INTO messages VALUES(1,'root','user','Remember blue',NULL),(2,'root','assistant','Remembered',NULL),(3,'tip','user','Which color?',NULL),(4,'tip','assistant','Blue',NULL),(5,'branch','assistant','Unrelated',NULL),(6,'tip','assistant','Private intermediate','interim'); ALTER TABLE messages ADD COLUMN timestamp REAL NOT NULL DEFAULT 0;`);db.close();
});
afterEach(()=>rmSync(home,{recursive:true,force:true}));
it('reads full compression history without changing storage or including another branch',()=>{
 const before=readFileSync(join(home,'state.db'));
 expect(readConversation(home,'root').messages.map(m=>m.text)).toEqual(['Remember blue','Remembered','Which color?','Blue']);
 expect(readConversation(home,'tip')).toEqual(readConversation(home,'root'));
 expect(readConversation(home,'branch').messages.map(m=>m.text)).toEqual(['Unrelated']);
 expect(readFileSync(join(home,'state.db'))).toEqual(before);
});
it('captures a new-turn boundary so an old answer cannot become the new reply',()=>{
 const checkpoint=conversationCheckpoint(home,'root'); expect(checkpoint).toEqual({afterMessageId:6,sessionId:'tip'});
 expect(savedEvidence(home,'root',undefined,checkpoint.afterMessageId).response).toBeUndefined();
 const db=new DatabaseSync(join(home,'state.db'));db.exec("INSERT INTO messages(id,session_id,role,content,display_kind) VALUES(7,'tip','user','Again?',NULL),(8,'tip','assistant','Still blue',NULL)");db.close();
 expect(savedEvidence(home,'root',undefined,checkpoint.afterMessageId).response).toBe('Still blue');
 expect(()=>conversationCheckpoint(home,'worker')).toThrow('cannot be continued');
});
it('bounds visible history but keeps the original context intact',()=>{
 const db=new DatabaseSync(join(home,'state.db'));
 const add=db.prepare('INSERT INTO messages(session_id,role,content) VALUES(?,?,?)');
 for(let i=0;i<510;i++)add.run('tip','assistant','message '+i);
 add.run('tip','assistant','x'.repeat(20000));db.close();
 const result=readConversation(home,'root');expect(result.limited).toBe(true);expect(result.messages).toHaveLength(500);
 expect(result.messages.at(-1)!.text).toContain('Display shortened');
 const read=new DatabaseSync(join(home,'state.db'),{readOnly:true});expect(read.prepare('SELECT length(content) AS n FROM messages ORDER BY id DESC LIMIT 1').get()!.n).toBe(20000);read.close();
});
it('rejects invalid profile paths and unknown sessions',()=>{
 expect(()=>readConversation(home,'root','../../')).toThrow('Invalid profile');
 expect(()=>readConversation(home,'missing')).toThrow('not found');
});
