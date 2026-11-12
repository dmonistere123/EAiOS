// @vitest-environment node
import {beforeEach,afterEach,expect,it,vi} from 'vitest';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {todayActivity,readReviews,reviewActivity} from '../../server/todayActivity';
import {readCalendar,todayMeetings,validateDay} from '../../server/todayMeetings';
import {mailboxChoices,mailComposioRequest} from '../../server/mailRouting';
vi.mock('../../server/mailRouting',()=>({mailboxChoices:vi.fn(),mailComposioRequest:vi.fn()}));
let home:string;const now=Date.parse('2026-11-12T18:00:00Z'),start='2026-11-12T06:00:00.000Z',end='2026-11-13T06:00:00.000Z';
const identity={connectionId:'ca_test',email:'one@example.com',provider:'outlook' as const,providerUserId:'u',verifiedAt:start};
const event=(id='e')=>({id,subject:'Meeting',start:{dateTime:'2026-11-12T19:00:00.0000000'},end:{dateTime:'2026-11-12T20:00:00.0000000'},webLink:'https://outlook.office.com/calendar/item/e'});
beforeEach(()=>{vi.resetAllMocks();home=mkdtempSync(join(tmpdir(),'today-source-'));mkdirSync(join(home,'cron'));mkdirSync(join(home,'eaios'));});
afterEach(()=>{rmSync(home,{recursive:true,force:true});});
it('reads real run ledger and excludes old/future runs without modifying the ledger',()=>{
 const path=join(home,'cron/executions.db'),db=new DatabaseSync(path);db.exec('CREATE TABLE executions(id TEXT,job_id TEXT,status TEXT,started_at TEXT,claimed_at TEXT,finished_at TEXT)');
 for(const [id,when] of [['current',now-1000],['old',now-86400001],['future',now+1]] as const)db.prepare('INSERT INTO executions VALUES(?,?,?,?,?,?)').run(id,'j','completed',new Date(when).toISOString(),null,new Date(when).toISOString());db.close();
 writeFileSync(join(home,'cron/jobs.json'),JSON.stringify({jobs:[{id:'j',name:'Morning brief',prompt:'PRIVATE PROMPT',provider_snapshot:{apiKey:'SECRET'}}]}));
 const before=readFileSync(path),a=todayActivity({hermesHome:home,eaiosRoot:home},now);
 expect(a.runs).toHaveLength(1);expect(a.runs[0]).toMatchObject({id:'Ally:current',title:'Morning brief'});expect(readFileSync(path)).toEqual(before);expect(JSON.stringify(a)).not.toContain('SECRET');expect(JSON.stringify(a)).not.toContain('PRIVATE PROMPT');
});
it('never treats schedule inventory as evidence of a run',()=>{writeFileSync(join(home,'cron/jobs.json'),'[]');const a=todayActivity({hermesHome:home,eaiosRoot:home},now);expect(a.runs).toEqual([]);expect(a.warnings.join()).toContain('schedule run history unavailable');});
it('persists review identities across readers, retaining other writes and pruning old entries',()=>{expect(readReviews(home)).toEqual({});reviewActivity(home,'work:old:1',now-8*86400000);reviewActivity(home,'work:a:1',now);reviewActivity(home,'run:b:2',now);expect(Object.keys(readReviews(home))).toEqual(['work:a:1','run:b:2']);expect(()=>reviewActivity(home,'approval:a',now)).toThrow();});
it('loads saved insights without calling a model or creating a report',()=>{mkdirSync(join(home,'eaios/executive-insights'));const path=join(home,'eaios/executive-insights/recommendations.json');writeFileSync(path,JSON.stringify([{id:'old',generatedAt:'2026-11-01',recommendations:[]},{id:'new',generatedAt:'2026-11-10',recommendations:[]}]));const before=readFileSync(path);expect(todayActivity({hermesHome:home,eaiosRoot:home},now).report?.id).toBe('new');expect(readFileSync(path)).toEqual(before);expect(mailComposioRequest).not.toHaveBeenCalled();});
it('reads all Graph pages, skips canceled/declined events, and normalizes UTC',async()=>{
 vi.mocked(mailComposioRequest).mockResolvedValueOnce({status:200,data:{value:[event(),{...event('cancelled'),isCancelled:true},{...event('declined'),responseStatus:{response:'declined'}}],'@odata.nextLink':'https://graph.microsoft.com/v1.0/me/calendarView?$skiptoken=2'}}).mockResolvedValueOnce({status:200,data:{value:[event('second')]}});
 const rows=await readCalendar({hermesHome:home,eaiosRoot:home},identity,start,end);expect(rows).toHaveLength(2);expect(rows[0].startsAt).toBe('2026-11-12T19:00:00.000Z');expect(mailComposioRequest).toHaveBeenCalledTimes(2);for(const call of vi.mocked(mailComposioRequest).mock.calls)expect(call[2]).toMatchObject({method:'GET',connected_account_id:'ca_test'});
});
it('rejects malicious pagination and never presents a failed page as a complete day',async()=>{
 vi.mocked(mailComposioRequest).mockResolvedValue({status:200,data:{value:[event()],'@odata.nextLink':'https://evil.example/calendar'}});
 await expect(readCalendar({hermesHome:home,eaiosRoot:home},identity,start,end)).rejects.toThrow();expect(mailComposioRequest).toHaveBeenCalledTimes(1);
});
it('reports each account separately, including failures, and coalesces refreshes',async()=>{
 writeFileSync(join(home,'eaios/today-calendars.json'),JSON.stringify({emails:['one@example.com','two@example.com','missing@example.com']}));
 vi.mocked(mailboxChoices).mockResolvedValue([{connectionId:'ca_test',mailbox:identity},{connectionId:'ca_two',mailbox:{...identity,email:'two@example.com',connectionId:'ca_two'}}]);
 vi.mocked(mailComposioRequest).mockImplementation(async(_ctx,_url,body)=> (body as {connected_account_id:string}).connected_account_id==='ca_two'?{status:403,data:{}}:{status:200,data:{value:[event()]}});
 const ctx={hermesHome:home,eaiosRoot:home};const [a,b]=await Promise.all([todayMeetings(ctx,start,end),todayMeetings(ctx,start,end)]);
 expect(a).toEqual(b);expect(a.calendars[0].events).toHaveLength(1);expect(a.calendars[1].error).toContain('permissions');expect(a.calendars[2].error).toContain('Connect');expect(mailboxChoices).toHaveBeenCalledTimes(1);
});
it('accepts DST-length days and rejects unbounded ranges',()=>{expect(()=>validateDay(start,'2026-11-13T05:00:00.000Z')).not.toThrow();expect(()=>validateDay(start,'2026-11-13T07:00:00.000Z')).not.toThrow();expect(()=>validateDay(start,'2026-12-01')).toThrow();});
it.each([
 [401,'reconnected'],[403,'denied calendar access'],[429,'rate-limited'],[502,'temporarily unavailable'],
])('gives the correct recovery message for calendar status %s',async(status,message)=>{
 vi.mocked(mailboxChoices).mockResolvedValue([{connectionId:identity.connectionId,mailbox:identity}]);
 vi.mocked(mailComposioRequest).mockResolvedValue({status,data:{}});
 const result=await todayMeetings({hermesHome:home,eaiosRoot:home},start,end);
 expect(result.calendars[0].error).toContain(message);
 expect(result.calendars[0].events).toEqual([]);
});
it('does not mislabel calendar timeouts as permission denials',async()=>{
 vi.mocked(mailboxChoices).mockResolvedValue([{connectionId:identity.connectionId,mailbox:identity}]);
 vi.mocked(mailComposioRequest).mockRejectedValue(new DOMException('Request timed out','TimeoutError'));
 const result=await todayMeetings({hermesHome:home,eaiosRoot:home},start,end);
 expect(result.calendars[0].error).toContain('timed out');
 expect(result.calendars[0].error).not.toContain('Check this account');
});
