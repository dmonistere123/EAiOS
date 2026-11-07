// @vitest-environment node
import {afterEach,beforeEach,expect,it} from 'vitest';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {telegramDays,readTelegramDay,searchConversationSessions,conversationFilter} from '../../server/conversationIndex';
let home:string;
const epoch=(day:number,hour=12)=>new Date(2026,10,day,hour).getTime()/1000;
beforeEach(()=>{
 home=mkdtempSync(join(tmpdir(),'conversation-index-'));
 const db=new DatabaseSync(join(home,'state.db'));
 db.exec(`CREATE TABLE sessions(id TEXT PRIMARY KEY,title TEXT,source TEXT,hidden INTEGER DEFAULT 0,archived INTEGER DEFAULT 0);
 CREATE TABLE messages(id INTEGER PRIMARY KEY,session_id TEXT,role TEXT,content TEXT,timestamp REAL,display_kind TEXT);
 INSERT INTO sessions(id,title,source) VALUES('tg1','Phone chat','telegram'),('tg2','Second thread','telegram'),('web','Board preparation','web'),('hidden','Private','telegram'),('archive','Archived','telegram');
 UPDATE sessions SET hidden=1 WHERE id='hidden';UPDATE sessions SET archived=1 WHERE id='archive';`);
 const add=db.prepare('INSERT INTO messages(session_id,role,content,timestamp,display_kind) VALUES(?,?,?,?,?)');
 add.run('tg1','user','Hotel request',epoch(5,23),null);
 add.run('tg1','assistant','Hotel answer',epoch(6,0),null);
 add.run('tg2','user','x'.repeat(18000)+' boardmeetingkeyword',epoch(6,12),null);
 add.run('tg2','assistant','Most recent response',epoch(6,13),null);
 add.run('tg2','assistant','hiddenkeyword',epoch(6,14),'interim');
 add.run('hidden','user','hiddenkeyword',epoch(7),null);add.run('archive','user','hiddenkeyword',epoch(7),null);
 add.run('web','user','boardmeetingkeyword',epoch(5),null);add.run('web','assistant','Follow-up',epoch(6),null);
 db.close();
});
afterEach(()=>rmSync(home,{recursive:true,force:true}));
it('groups across Telegram threads by message day, newest first, excluding hidden records',()=>{
 const before=readFileSync(join(home,'state.db'));
 const days=telegramDays(home);
 expect(days.map(d=>d.day)).toEqual(['2026-11-06','2026-11-05']);
 expect(days.map(d=>d.messageCount)).toEqual([3,1]);
 expect(days[0].title).toBe('November 6, 2026');
 const messages=readTelegramDay(home,'2026-11-06').messages;
 expect(messages).toHaveLength(3);expect(messages[0].text).toBe('Hotel answer');
 expect(messages.at(-1)?.text).toBe('Most recent response');
 expect(readFileSync(join(home,'state.db'))).toEqual(before);
});
it('searches full saved text beyond previews and combines date with keyword',()=>{
 expect(telegramDays(home,undefined,{query:'boardmeetingkeyword'}).map(d=>d.day)).toEqual(['2026-11-06']);
 expect(telegramDays(home,undefined,{query:'boardmeetingkeyword',day:'2026-11-05'})).toEqual([]);
 expect(telegramDays(home,undefined,{query:'hiddenkeyword'})).toEqual([]);
 expect(telegramDays(home,undefined,{query:'11/5/2026'}).map(d=>d.day)).toEqual(['2026-11-05']);
 expect(telegramDays(home,undefined,{query:'2026-11-06'})).toHaveLength(1);
});
it('keeps EAiOS sessions intact even when matching an earlier day',()=>{
 const rows=searchConversationSessions(home,undefined,{query:'boardmeetingkeyword',day:'2026-11-05'});
 expect(rows).toHaveLength(1);expect(rows[0]).toMatchObject({id:'web',messageCount:2,source:'web'});
 expect(searchConversationSessions(home,undefined,{query:'Hotel'})).toEqual([]);
});
it('rejects invalid dates and profile paths and treats query syntax as text',()=>{
 expect(()=>conversationFilter({day:'2026-02-30'})).toThrow('Invalid date');
 expect(()=>readTelegramDay(home,'bad')).toThrow('Invalid date');
 expect(()=>telegramDays(home,'../outside')).toThrow('Invalid profile');
 expect(telegramDays(home,undefined,{query:"%' OR 1=1 --"})).toEqual([]);
});
