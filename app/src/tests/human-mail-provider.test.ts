// @vitest-environment node
import {afterEach,it,expect,vi} from 'vitest';
import {sendHumanMail} from '../../server/humanMailProvider.ts';
afterEach(()=>{vi.unstubAllGlobals();vi.useRealTimers();});
it('rechecks delayed Outlook confirmation without repeating draft creation or send',async()=>{
 vi.useFakeTimers();let reads=0;const methods:string[]=[];
 vi.stubGlobal('fetch',vi.fn(async(_url:string,init?:RequestInit)=>{
  const req=JSON.parse(String(init?.body));methods.push(req.method+':'+req.endpoint.split('?')[0]);
  const data=req.method==='GET'?(++reads===1?{id:'receipt',isDraft:true}:{id:'receipt',isDraft:false,sentDateTime:'2026-10-14T13:33:31Z',from:{emailAddress:{address:'sender@example.com'}}}):{id:'receipt',isDraft:true};
  return Response.json({status:req.endpoint.endsWith('/send')?202:200,data});
 }));
 const identity={connectionId:'ca_example',provider:'outlook' as const,email:'sender@example.com',providerUserId:'user',verifiedAt:'now'};
 const pending=sendHumanMail({hermesHome:'/unused',eaiosRoot:'/unused',requestKeys:new Map([['COMPOSIO_API_KEY','fixture']])},{sender:{provider:'outlook',accountId:'ca_example',email:identity.email},recipient:{displayName:'Recipient',email:'recipient@example.com'},subject:'Test',body:'Test',artifacts:[],packageHash:''},identity,[]);
 await vi.runAllTimersAsync();expect(await pending).toEqual({id:'receipt',provider:'outlook'});
 expect(methods.filter(m=>m.startsWith('POST:'))).toHaveLength(2);expect(reads).toBe(2);
});
