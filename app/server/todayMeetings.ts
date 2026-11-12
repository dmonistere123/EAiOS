import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { mailboxChoices, mailComposioRequest } from './mailRouting.ts';
import type { ApiContext } from './httpApi.ts';
import type { TodayMeetings, TodayCalendar, OutlookMeeting } from '../src/domain/today.ts';
import type { MailboxIdentity } from '../src/domain/mailRouting.ts';
// Only verified connections are used; configured email addresses are private per-box data.
const accountsCache=new Map<string,{until:number;accounts:MailboxIdentity[]}>();
const cache=new Map<string,{until:number;value:Promise<TodayMeetings>}>();
class CalendarReadError extends Error {}
function calendarError(error: unknown): string {
  if (error instanceof CalendarReadError) return error.message;
  if (error instanceof Error && ['TimeoutError', 'AbortError'].includes(error.name)) {
    return 'The calendar service timed out. Try again shortly; calendar permissions have not been verified.';
  }
  return 'Calendar data could not be loaded. Try again shortly. This does not necessarily mean calendar permissions are missing.';
}
export function validateDay(start:string,end:string) {
  const a=Date.parse(start),b=Date.parse(end);
  if(!Number.isFinite(a)||!Number.isFinite(b)||b-a<23*3600000||b-a>25*3600000)throw new Error('Choose a local calendar day.');
  return {start:new Date(a).toISOString(),end:new Date(b).toISOString()};
}
function utc(value:unknown):string {
  if(typeof value!=='string')throw new Error('Invalid calendar time');
  const at=Date.parse(value+(/[zZ]$|[+-]\d\d:\d\d$/.test(value)?'':'Z'));
  if(!Number.isFinite(at))throw new Error('Invalid calendar time');return new Date(at).toISOString();
}
export async function readCalendar(ctx:ApiContext,identity:MailboxIdentity,start:string,end:string):Promise<OutlookMeeting[]> {
  const base='https://graph.microsoft.com/v1.0/me/calendarView';
  let endpoint=base+'?'+new URLSearchParams({startDateTime:start,endDateTime:end,'$top':'250','$select':'id,subject,start,end,isAllDay,isCancelled,location,webLink,responseStatus'});
  const events=new Map<string,OutlookMeeting>();const seen=new Set<string>();
  for(let page=0;page<40;page++){
    const url=new URL(endpoint);
    if(url.origin!=='https://graph.microsoft.com'||url.pathname!=='/v1.0/me/calendarView'||url.username||url.password||seen.has(endpoint))throw new Error('Incomplete calendar response');
    seen.add(endpoint);
    const data=await mailComposioRequest(ctx,'/api/v3.1/tools/execute/proxy',{connected_account_id:identity.connectionId,endpoint,method:'GET',parameters:[{name:'Prefer',value:'outlook.timezone="UTC"',type:'header'}]});
    if(data.status===401)throw new CalendarReadError('This Outlook connection needs to be reconnected in Connections.');
    if(data.status===403)throw new CalendarReadError('Outlook denied calendar access. Check this account’s calendar permissions in Connections.');
    if(data.status===429)throw new CalendarReadError('The calendar service is temporarily rate-limited. Try again shortly.');
    if(data.status>=500)throw new CalendarReadError('The calendar service is temporarily unavailable. Try again shortly; no permissions change is indicated by this error.');
    if(data.status!==200||!Array.isArray(data.data?.value))throw new Error('Unexpected calendar response');
    for(const e of data.data.value) {
      if(e.isCancelled || e.responseStatus?.response==='declined')continue;
      if(typeof e.id!=='string')throw new Error('Invalid calendar event');
      const startsAt=utc(e.start?.dateTime),endsAt=utc(e.end?.dateTime);
      if(Date.parse(endsAt)<=Date.parse(start)||Date.parse(startsAt)>=Date.parse(end))continue;
      let safeUrl:string|undefined;
      try{const u=new URL(e.webLink);if(u.protocol==='https:'&&['outlook.office.com','outlook.office365.com','outlook.live.com'].includes(u.hostname))safeUrl=u.href;}catch{/* No source link */}
      events.set(e.id,{id:e.id,title:typeof e.subject==='string'?e.subject:'Untitled meeting',startsAt,endsAt,allDay:e.isAllDay===true,location:typeof e.location?.displayName==='string'?e.location.displayName:undefined,url:safeUrl});
    }
    if(!data.data['@odata.nextLink'])return [...events.values()].sort((a,b)=>a.startsAt.localeCompare(b.startsAt));
    endpoint=data.data['@odata.nextLink'];if(typeof endpoint!=='string')throw new Error('Incomplete calendar response');
  }
  throw new Error('Calendar exceeds the supported daily range.');
}
export async function todayMeetings(ctx:ApiContext,from:string,to:string):Promise<TodayMeetings> {
  const {start,end}=validateDay(from,to);
  const file=join(ctx.hermesHome,'eaios','today-calendars.json');
  let wanted:string[]|undefined;
  if(existsSync(file)){
    const data=JSON.parse(readFileSync(file,'utf8'));
    if(!Array.isArray(data.emails)||data.emails.some((e:unknown)=>typeof e!=='string'))throw new Error('Calendar selection is unavailable.');
    wanted=[...new Set<string>(data.emails.map((e:string)=>e.toLowerCase()))];
  }
  const key=JSON.stringify([ctx.hermesHome,start,end,wanted]);const saved=cache.get(key);
  if(saved && saved.until>Date.now())return saved.value;
  const value=(async()=>{
    let accounts=accountsCache.get(ctx.hermesHome);
    if(!accounts || accounts.until<Date.now()){
      const choices=await mailboxChoices(ctx);
      accounts={until:Date.now()+300000,accounts:choices.flatMap(c=>c.mailbox?.provider==='outlook'?[c.mailbox]:[])};
      accountsCache.set(ctx.hermesHome,accounts);
    }
    const emails=wanted??[...new Set(accounts.accounts.map(a=>a.email.toLowerCase()))];
    const calendars=await Promise.all(emails.map(async(email):Promise<TodayCalendar>=>{
      const account=accounts!.accounts.find(a=>a.email.toLowerCase()===email);
      if(!account)return {email,events:[],error:'Connect and verify this Outlook account in Connections.'};
      try{return {email,events:await readCalendar(ctx,account,start,end)};}
      catch(error){return {email,events:[],error:calendarError(error)};}
    }));
    return {calendars,fetchedAt:new Date().toISOString()};
  })();
  // Coalesce concurrent requests and limit provider traffic. Failures never become empty calendars.
  for(const [k,v] of cache)if(v.until<Date.now())cache.delete(k);
  cache.set(key,{until:Date.now()+60000,value});
  try{return await value;}catch(e){cache.delete(key);throw e;}
}
