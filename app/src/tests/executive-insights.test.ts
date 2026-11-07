// @vitest-environment node
import {beforeEach,afterEach,expect,it,vi} from 'vitest';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {insightsSnapshot,recommendationInput,validateRecommendations,generateInsights,insightDays} from '../../server/executiveInsights';
let home:string;const now=Date.now();
beforeEach(()=>{home=mkdtempSync(join(tmpdir(),'insights-test-'));mkdirSync(join(home,'cron'));mkdirSync(join(home,'app'));
 const db=new DatabaseSync(join(home,'state.db'));db.exec(`CREATE TABLE sessions(id TEXT,source TEXT,hidden INTEGER,archived INTEGER,title TEXT);CREATE TABLE messages(session_id TEXT,role TEXT,content TEXT,timestamp REAL,display_kind TEXT,_compressed_summary INTEGER,tool_name TEXT);INSERT INTO sessions VALUES('a','tui',0,0,'Email'),('b','telegram',0,0,'Travel'),('private','tui',1,0,'Hidden'),('cron','cron',0,0,'Email review');`);
 const insert=db.prepare('INSERT INTO messages VALUES(?,?,?,?,?,?,?)');
 for(const [id,content] of [['a','Review my email PRIVATE_EMAIL_TEXT'],['b','Plan my flight PRIVATE_TRAVEL_TEXT'],['private','hidden secret'],['cron','daily email check']])insert.run(id,'user',content,now/1000-60,null,0,null);
 insert.run('a','user','old email',now/1000-100*86400,null,0,null);insert.run('a','user','hidden email',now/1000-60,'hidden',0,null);insert.run('a','tool','private tool result',now/1000-60,null,0,'skill_manage');db.close();
 writeFileSync(join(home,'cron/jobs.json'),JSON.stringify({jobs:[{id:'j1',name:'Email review PRIVATE_SCHEDULE',enabled:true,prompt:'DO NOT EXPOSE PROMPT',provider_snapshot:{key:'SECRET'},last_status:'completed'}]}));
 const c=new DatabaseSync(join(home,'cron/executions.db'));c.exec('CREATE TABLE executions(job_id TEXT,status TEXT,started_at TEXT,claimed_at TEXT)');c.prepare('INSERT INTO executions VALUES(?,?,?,?)').run('j1','completed',new Date(now-1000).toISOString(),null);c.prepare('INSERT INTO executions VALUES(?,?,?,?)').run('j1','failed',new Date(now-2000).toISOString(),null);c.close();
 const k=new DatabaseSync(join(home,'kanban.db'));k.exec('CREATE TABLE tasks(created_at REAL)');k.prepare('INSERT INTO tasks VALUES(?)').run(now/1000-60);k.close();
 mkdirSync(join(home,'skills/test'),{recursive:true});writeFileSync(join(home,'skills/test/SKILL.md'),'PRIVATE_SKILL_CONTENT');
});
afterEach(()=>{vi.unstubAllGlobals();rmSync(home,{recursive:true,force:true});});
it('counts visible requests and actual schedule attempts without counting cron chat prompts twice',()=>{
 const before=readFileSync(join(home,'state.db'));const s=insightsSnapshot({hermesHome:home,eaiosRoot:home},30,now+1000);
 expect(s.totals).toEqual({chatRequests:2,telegramRequests:1,appRequests:1,scheduleRuns:2,failedRuns:1,tasksCreated:1,skillToolCalls:1,maintenanceRuns:0,unclassifiedRuns:0});expect(s.topUses[0]).toMatchObject({id:'email',count:3,chats:1,runs:2});expect(s.skills).toHaveLength(1);expect(readFileSync(join(home,'state.db'))).toEqual(before);
 const json=JSON.stringify(s);expect(json).not.toContain('PRIVATE_EMAIL_TEXT');expect(json).not.toContain('DO NOT EXPOSE PROMPT');expect(json).not.toContain('SECRET');expect(json).not.toContain('PRIVATE_SKILL_CONTENT');
});
it('sends only aggregate categories and counts to recommendation generation',()=>{const s=insightsSnapshot({hermesHome:home,eaiosRoot:home},30,now+1000);const json=JSON.stringify(recommendationInput(s));expect(json).not.toContain('PRIVATE_');expect(json).not.toContain('skills/test');expect(json).not.toContain(home);});
it('rejects unsupported time windows and fabricated evidence categories',()=>{expect(()=>insightDays(1000)).toThrow();expect(()=>validateRecommendations([{title:'Idea',module:'Proposed module',kind:'new',effort:'small',evidenceIds:['made-up'],why:'Why',proposal:'Proposal',firstStep:'Step'}],new Set(['email']))).toThrow();});
it('returns honest coverage warnings if a data source is missing',()=>{rmSync(join(home,'state.db'));const s=insightsSnapshot({hermesHome:home,eaiosRoot:home},7,now);expect(s.totals.chatRequests).toBe(0);expect(s.warnings).toContain('No conversation database found.');expect(s.totals.scheduleRuns).toBe(2);});
it('generates and persists validated suggestions without exposing source content or executing actions',async()=>{
 writeFileSync(join(home,'app/.env.local'),'OPENROUTER_API_KEY=test-key\n');
 const suggestion={title:'Inbox review workflow',module:'Approvals',kind:'existing',effort:'small',evidenceIds:['email'],why:'Recurring email requests',proposal:'Use a review queue',firstStep:'Review approval handling',executiveHabit:'Set an outcome and deadline',successMeasure:'Review clarification rounds after two weeks'};
 const fetch=vi.fn().mockResolvedValue(new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:JSON.stringify({recommendations:[suggestion]})}}]})));vi.stubGlobal('fetch',fetch);
 const ctx={hermesHome:home,eaiosRoot:home};const report=await generateInsights(ctx,30);expect(report.recommendations[0].title).toBe(suggestion.title);expect(insightsSnapshot(ctx,30).reports[0].id).toBe(report.id);expect(fetch).toHaveBeenCalledTimes(1);expect(fetch.mock.calls[0][1].body).not.toContain('PRIVATE_');expect(fetch.mock.calls[0][1].body).not.toContain('SECRET');await expect(generateInsights(ctx,30)).rejects.toThrow('30 seconds');
});
