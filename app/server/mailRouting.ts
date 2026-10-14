import { appKey, type KeyContext } from './apiKeys.ts';
import { humanStore, HumanDelegationError } from './humanDelegation.ts';
import type { MailboxIdentity, MailRoutingSettings } from '../src/domain/mailRouting.ts';
// Provider payloads are parsed defensively and never returned verbatim.
type Wire = Record<string, any>;
async function api(ctx:KeyContext,path:string,body?:unknown):Promise<Wire> {
  const key=appKey('COMPOSIO_API_KEY',ctx);
  if(!key)throw new HumanDelegationError(503,'Add a Composio key in Settings and connect your mailbox.');
  const r=await fetch('https://backend.composio.dev'+path,{method:body===undefined?'GET':'POST',redirect:'error',signal:AbortSignal.timeout(20000),headers:{'content-type':'application/json','x-api-key':key},...(body===undefined?{}:{body:JSON.stringify(body)})});
  if(!r.ok){await r.body?.cancel();throw new HumanDelegationError(502,'The mail connection could not be verified. Reconnect in Connections.');}
  const data=await r.json();
  if(!data||typeof data!=='object'||Array.isArray(data))throw new HumanDelegationError(502,'Unexpected connection response.');
  return data as Wire;
}
export async function verifyMailbox(ctx:KeyContext,id:string):Promise<MailboxIdentity> {
  if(!/^ca_[\w-]+$/.test(id))throw new HumanDelegationError(400,'Choose a mailbox connection.');
  const c=await api(ctx,'/api/v3/connected_accounts/'+encodeURIComponent(id));
  const provider=typeof c.toolkit==='string'?c.toolkit:c.toolkit?.slug;
  if(c.status!=='ACTIVE'||!['outlook','gmail'].includes(provider)||c.id!==id)throw new HumanDelegationError(409,'Choose an active Gmail or Outlook connection.');
  const endpoint=provider==='outlook'?'https://graph.microsoft.com/v1.0/me?$select=id,mail':'https://gmail.googleapis.com/gmail/v1/users/me/profile';
  const profile=await api(ctx,'/api/v3.1/tools/execute/proxy',{connected_account_id:id,endpoint,method:'GET',parameters:[]});
  if(profile.status!==200)throw new HumanDelegationError(409,'Mailbox identity could not be verified. Check its permissions.');
  const email=provider==='outlook'?profile.data?.mail:profile.data?.emailAddress;
  const providerUserId=provider==='outlook'?profile.data?.id:email;
  if(typeof email!=='string'||! /^[^\s<>@,;]+@[^\s<>@,;]+\.[^\s<>@,;]+$/.test(email)||typeof providerUserId!=='string'||!providerUserId)throw new HumanDelegationError(409,'Provider did not return a mailbox address. Shared mailboxes and aliases require separate verification.');
  return {connectionId:id,provider,email,providerUserId,verifiedAt:new Date().toISOString()};
}
export async function mailboxChoices(ctx:KeyContext) {
  const choices:{connectionId:string;mailbox?:MailboxIdentity;error?:string}[]=[];
  const seen=new Set<string>();let cursor='';
  for(let page=0;page<64;page++){
    const data=await api(ctx,'/api/v3/connected_accounts?limit=100'+(cursor?'&cursor='+encodeURIComponent(cursor):''));
    for(const c of data.items??[]){const slug=typeof c.toolkit==='string'?c.toolkit:c.toolkit?.slug;
      if(c.status!=='ACTIVE'||!['gmail','outlook'].includes(slug)||typeof c.id!=='string')continue;
      try{choices.push({connectionId:c.id,mailbox:await verifyMailbox(ctx,c.id)});}catch{choices.push({connectionId:c.id,error:'Unable to verify this mailbox. Check Connections.'});}
    }
    if(!data.next_cursor)return choices;
    if(typeof data.next_cursor!=='string'||seen.has(data.next_cursor))break;
    cursor=data.next_cursor;seen.add(cursor);
  }
  throw new HumanDelegationError(502,'The complete mailbox list could not be loaded.');
}
export function mailSettings(home:string):MailRoutingSettings {
  return humanStore(home,db=>{
    db.exec('CREATE TABLE IF NOT EXISTS mail_routing_settings (id INTEGER PRIMARY KEY CHECK(id=1), body TEXT NOT NULL)');
    const row=db.prepare('SELECT body FROM mail_routing_settings WHERE id=1').get() as {body:string}|undefined;
    return row?JSON.parse(row.body):{revision:0};
  });
}
export async function saveMailSettings(ctx:KeyContext,input:Record<string,unknown>):Promise<MailRoutingSettings> {
  if(typeof input.connectionId!=='string'||typeof input.expectedEmail!=='string')throw new HumanDelegationError(400,'Choose and review the sender address.');
  const sender=await verifyMailbox(ctx,input.connectionId);
  if(sender.email.toLowerCase()!==input.expectedEmail.toLowerCase())throw new HumanDelegationError(409,'The mailbox identity changed. Reload and review it.');
  mailSettings(ctx.hermesHome);
  return humanStore(ctx.hermesHome,db=>{
    const row=db.prepare('SELECT body FROM mail_routing_settings WHERE id=1').get() as {body:string}|undefined;
    const previous:MailRoutingSettings=row?JSON.parse(row.body):{revision:0};
    if(previous.revision!==input.revision)throw new HumanDelegationError(409,'Sender settings changed. Reload before saving.');
    const next={...previous,[input.purpose==='default'?'defaultSender':'delegationSender']:sender,revision:previous.revision+1};
    db.prepare('INSERT INTO mail_routing_settings VALUES(1,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body').run(JSON.stringify(next));return next;
  });
}
export { api as mailComposioRequest };
