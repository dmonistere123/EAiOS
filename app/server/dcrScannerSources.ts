/** Read-only Outlook ingestion. Connection identity and pagination are checked at every boundary. */
import type {KeyContext} from './apiKeys.ts';
import {mailComposioRequest,verifyMailbox} from './mailRouting.ts';
import type {ScanAccount,ScanInput} from '../src/domain/dcrScanner.ts';
import {scanHash} from './dcrScannerStore.ts';
export type ScanChannel='mail'|'calendar';
export interface ScanCursor {from:string;to:string;next?:string;mailSince?:string;}
export interface ScanPage {items:ScanInput[];next?:string;}
export const cleanScanText=(value:unknown)=>String(value??'').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi,'').replace(/<[^>]+>/g,' ').replace(/&nbsp;/g,' ').replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&#39;/g,"'").replace(/&quot;/g,'"').trim();
const bounded=(v:unknown,n=1000)=>String(v??'').slice(0,n);
function sourceUrl(raw:unknown){try{const u=new URL(String(raw));if(u.protocol==='https:'&&['outlook.office.com','outlook.office365.com','outlook.live.com'].includes(u.hostname)&&!u.username&&!u.password)return u.href;}catch{/* Missing source URL */}return undefined;}
function textBody(body:any){const text=body?.contentType?.toLowerCase()==='html'?cleanScanText(body.content):String(body?.content??'');return text.length>12000?text.slice(0,12000)+'\n[Source excerpt truncated at 12,000 characters. Do not infer omitted content.]':text;}
export function normalizeScanItem(account:ScanAccount,channel:ScanChannel,row:any):ScanInput {
 if(!row||typeof row.id!=='string')throw Error('Outlook returned an item without its source identity.');
 const removed=!!row.isDraft||!!row.isCancelled||row.responseStatus?.response==='declined';
 const kind=channel==='calendar'?'calendar':String(row.from?.emailAddress?.address).toLowerCase()===account.email.toLowerCase()?'sent':'received';
 const title=bounded(row.subject||'(No subject)',220);
 const people=(rows:any[])=>rows.slice(0,30).map(x=>bounded(x.emailAddress?.name,100)+' <'+bounded(x.emailAddress?.address,200)+'>').join('; ');
 const body=channel==='mail'?`Mailbox: ${account.email}\nDirection: ${kind}\nFrom: ${people([row.from??{}])}\nTo: ${people(row.toRecipients??[])}\nSent: ${bounded(row.sentDateTime)}\nReceived: ${bounded(row.receivedDateTime)}\nSubject: ${title}\n${textBody(row.uniqueBody??row.body)}`:`Calendar owner: ${account.email}\nSubject: ${title}\nStart: ${bounded(row.start?.dateTime)} ${bounded(row.start?.timeZone)}\nEnd: ${bounded(row.end?.dateTime)} ${bounded(row.end?.timeZone)}\nOrganizer: ${people([row.organizer??{}])}\nAttendees: ${people(row.attendees??[])}\nLocation: ${bounded(row.location?.displayName)}\nCalendar invitation only; it does not prove attendance, a decision, or fulfillment.\n${textBody(row.body)}`;
 const origin={kind,accountId:account.connectionId,email:account.email,externalId:row.id,url:sourceUrl(row.webLink),observedAt:new Date().toISOString(),sourceAt:channel==='mail'?String(row.receivedDateTime??row.sentDateTime??''):String(row.start?.dateTime??'')} as ScanInput['origin'];
 return {key:scanHash([account.connectionId,account.providerUserId,channel,row.id]),version:scanHash([body,removed]),title:`${kind==='calendar'?'Calendar':kind==='sent'?'Sent email':'Received email'} · ${title}`,text:body.slice(0,19000),origin,removed};
}
export interface ScannerReader {verify:(account:ScanAccount)=>Promise<void>;page:(account:ScanAccount,channel:ScanChannel,cursor:ScanCursor)=>Promise<ScanPage>;current:(input:ScanInput)=>Promise<ScanInput>;}
export function outlookScannerReader(ctx:KeyContext):ScannerReader{
 const excluded=new Map<string,Set<string>>();
 const graph=async(account:ScanAccount,url:string)=>{
  const u=new URL(url);if(u.origin!=='https://graph.microsoft.com'||u.username||u.password||u.hash||!u.pathname.startsWith('/v1.0/me/'))throw Error('Unexpected Outlook source address.');
  const r=await mailComposioRequest(ctx,'/api/v3.1/tools/execute/proxy',{connected_account_id:account.connectionId,endpoint:url,method:'GET',parameters:[{name:'Prefer',value:'IdType="ImmutableId", outlook.body-content-type="text", outlook.timezone="UTC"',type:'header'}]});
  if(r.status!==200)throw Error(r.status===403?'Outlook denied access. Check mail/calendar permissions in Connections.':r.status===401?'Reconnect this Outlook account in Connections.':r.status===429?'Outlook rate limit reached. Scanning will retry.':'Outlook source is unavailable. Scanning will retry.');
  return r.data;
 };
 const verify=async(account:ScanAccount)=>{const identity=await verifyMailbox(ctx,account.connectionId);if(identity.provider!=='outlook'||identity.email.toLowerCase()!==account.email.toLowerCase()||identity.providerUserId!==account.providerUserId)throw Error('Mailbox identity changed. Review the configured scanner account.');};
 return {verify,
  page:async(account,channel,cursor)=>{
   const path=channel==='mail'?'/v1.0/me/messages':'/v1.0/me/calendarView';
   const params:Record<string,string>=channel==='mail'?{'$top':'50','$select':'id,subject,from,toRecipients,sentDateTime,receivedDateTime,lastModifiedDateTime,body,uniqueBody,webLink,isDraft,parentFolderId','$filter':`lastModifiedDateTime ge ${cursor.from} and lastModifiedDateTime le ${cursor.to}${cursor.mailSince?` and (receivedDateTime ge ${cursor.mailSince} or sentDateTime ge ${cursor.mailSince})`:''}`,'$orderby':'lastModifiedDateTime asc'}:{'$top':'50',startDateTime:cursor.from,endDateTime:cursor.to,'$select':'id,subject,start,end,organizer,attendees,body,isCancelled,responseStatus,location,webLink'};
   const url=cursor.next??'https://graph.microsoft.com'+path+'?'+new URLSearchParams(params);
   const u=new URL(url);if(u.origin!=='https://graph.microsoft.com'||u.pathname!==path||u.username||u.password||u.hash)throw Error('Unexpected Outlook pagination.');
   if(channel==='mail'&&!excluded.has(account.connectionId)){
    const ids=new Set<string>();for(const folder of ['deleteditems','junkemail']){const r=await graph(account,'https://graph.microsoft.com/v1.0/me/mailFolders/'+folder+'?$select=id');if(typeof r.id!=='string')throw Error('Outlook folder exclusions could not be verified.');ids.add(r.id);}excluded.set(account.connectionId,ids);
   }
   const data=await graph(account,url);if(!Array.isArray(data?.value))throw Error('Outlook returned an incomplete page.');
   const next=data['@odata.nextLink'];if(next!==undefined){const n=new URL(next);if(n.origin!=='https://graph.microsoft.com'||n.pathname!==path||n.username||n.password||n.hash||next===url)throw Error('Unexpected Outlook pagination.');}
   const rows=channel==='mail'&&cursor.mailSince?data.value.filter((row:any)=>Date.parse(row.receivedDateTime??row.sentDateTime??'')>=Date.parse(cursor.mailSince!)):data.value;
   return {items:rows.map((row:any)=>normalizeScanItem(account,channel,channel==='mail'&&excluded.get(account.connectionId)?.has(row.parentFolderId)?{...row,isDraft:true}:row)),next};
  },
  current:async(input)=>{
   const identity=await verifyMailbox(ctx,input.origin.accountId!);if(identity.provider!=='outlook'||identity.email.toLowerCase()!==input.origin.email?.toLowerCase())throw Error('Source mailbox is no longer available.');
   const account={connectionId:identity.connectionId,email:identity.email,providerUserId:identity.providerUserId};
   const channel=input.origin.kind==='calendar'?'calendar':'mail';
   const row=await graph(account,'https://graph.microsoft.com/v1.0/me/'+(channel==='mail'?'messages/':'events/')+encodeURIComponent(input.origin.externalId)+(channel==='mail'?'?$select=id,subject,from,toRecipients,sentDateTime,receivedDateTime,body,uniqueBody,webLink,isDraft,parentFolderId':''));
   if(channel==='mail'){for(const folder of ['deleteditems','junkemail']){const f=await graph(account,'https://graph.microsoft.com/v1.0/me/mailFolders/'+folder+'?$select=id');if(typeof f.id!=='string')throw Error('Source folder could not be verified.');if(row.parentFolderId===f.id)row.isDraft=true;}}
   return normalizeScanItem(account,channel,row);
  }
 };
}
