// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { selectMailSender,requireReviewedSender,type MailboxIdentity } from '../domain/mailRouting';
import { mailSettings,saveMailSettings,verifyMailbox } from '../../server/mailRouting.ts';
import { humanDatabasePath } from '../../server/humanDelegation.ts';
const work:MailboxIdentity={connectionId:'ca_work',provider:'outlook',email:'work@example.com',providerUserId:'work-user',verifiedAt:'2026-10-14'};
const business:MailboxIdentity={...work,connectionId:'ca_business',email:'business@example.com',providerUserId:'business-user'};
const roots:string[]=[];
afterEach(()=>{vi.unstubAllGlobals();roots.splice(0).forEach(p=>rmSync(p,{recursive:true,force:true}));});
it('replies retain their originating mailbox even when the delegation default differs',()=>{
 const settings={delegationSender:business,revision:1};
 expect(selectMailSender({kind:'reply',sourceMailbox:work,sourceMessageId:'source'},settings,[business,work])).toEqual(work);
 expect(selectMailSender({kind:'reply',sourceMailbox:business,sourceMessageId:'source'},settings,[work,business])).toEqual(business);
 expect(selectMailSender({kind:'human_delegation'},settings,[work,business])).toEqual(business);
});
it('never falls back to another mailbox or a new identity on the same connection',()=>{
 const settings={delegationSender:business,revision:1};
 expect(()=>selectMailSender({kind:'reply',sourceMailbox:work,sourceMessageId:'source'},settings,[business])).toThrow('blocked');
 expect(()=>selectMailSender({kind:'human_delegation'},settings,[work])).toThrow('blocked');
 expect(()=>requireReviewedSender(work,{...work,email:business.email})).toThrow('changed');
 expect(()=>requireReviewedSender(work,{...work,providerUserId:'new-user'})).toThrow('changed');
 expect(()=>selectMailSender({kind:'reply',sourceMailbox:work,sourceMessageId:''},settings,[work])).toThrow('original message');
});
function fixture(){
 const root=mkdtempSync(join(tmpdir(),'mail-routing-'));roots.push(root);
 const ctx={hermesHome:root,eaiosRoot:root,requestKeys:new Map([['COMPOSIO_API_KEY','fixture-key']])};
 const fetcher=vi.fn(async(url:string,init?:RequestInit)=>{
  if(url.includes('/connected_accounts/'))return Response.json({id:'ca_business',status:'ACTIVE',toolkit:{slug:'outlook'}});
  const body=JSON.parse(String(init?.body));expect(body.method).toBe('GET');expect(body.connected_account_id).toBe('ca_business');
  return Response.json({status:200,data:{mail:business.email,id:business.providerUserId}});
 });vi.stubGlobal('fetch',fetcher);return {ctx,fetcher};
}
it('stores only provider-verified identity, persists it privately, and rejects stale settings saves',async()=>{
 const {ctx}=fixture();expect(mailSettings(ctx.hermesHome)).toEqual({revision:0});
 const saved=await saveMailSettings(ctx,{connectionId:business.connectionId,expectedEmail:business.email,revision:0});
 expect(saved.delegationSender).toMatchObject({email:business.email,connectionId:business.connectionId});
 expect(mailSettings(ctx.hermesHome)).toEqual(saved);expect(statSync(humanDatabasePath(ctx.hermesHome)).mode&0o777).toBe(0o600);
 await expect(saveMailSettings(ctx,{connectionId:business.connectionId,expectedEmail:business.email,revision:0})).rejects.toThrow('changed');
 await expect(saveMailSettings(ctx,{connectionId:business.connectionId,expectedEmail:work.email,revision:1})).rejects.toThrow('identity changed');
});
it('rejects inactive accounts and never treats an account label as mailbox verification',async()=>{
 const {ctx,fetcher}=fixture();fetcher.mockImplementation(async()=>Response.json({id:'ca_business',status:'EXPIRED',toolkit:{slug:'outlook'},state:{val:{displayName:business.email}}}));
 await expect(verifyMailbox(ctx,'ca_business')).rejects.toThrow('active');expect(mailSettings(ctx.hermesHome).delegationSender).toBeUndefined();
});
it('keeps ordinary and human-delegation defaults independent of reply routing',()=>{
 const settings={defaultSender:work,delegationSender:business,revision:1};
 expect(selectMailSender({kind:'new_message'},settings,[work,business])).toEqual(work);
 expect(selectMailSender({kind:'human_delegation'},settings,[work,business])).toEqual(business);
 expect(selectMailSender({kind:'reply',sourceMailbox:business,sourceMessageId:'m'},settings,[work,business])).toEqual(business);
});
it('saving the default sender preserves the delegation setting',async()=>{
 const {ctx}=fixture();const first=await saveMailSettings(ctx,{connectionId:business.connectionId,expectedEmail:business.email,revision:0});
 const next=await saveMailSettings(ctx,{connectionId:business.connectionId,expectedEmail:business.email,revision:1,purpose:'default'});
 expect(next.delegationSender).toEqual(first.delegationSender);expect(next.defaultSender?.email).toBe(business.email);
});
