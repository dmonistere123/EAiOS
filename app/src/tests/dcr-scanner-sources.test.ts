// @vitest-environment node
import {it,expect,vi,afterEach} from 'vitest';
import {outlookScannerReader} from '../../server/dcrScannerSources.ts';
import {mailComposioRequest,verifyMailbox} from '../../server/mailRouting.ts';
vi.mock('../../server/mailRouting.ts',()=>({mailComposioRequest:vi.fn(),verifyMailbox:vi.fn()}));
afterEach(()=>vi.resetAllMocks());
const ctx={hermesHome:'/unused',eaiosRoot:'/unused'},account={connectionId:'ca_test',email:'exec@example.test',providerUserId:'uid'};
const cursor={from:'2026-11-01T00:00:00Z',to:'2026-11-14T00:00:00Z'};
it('reads all mail folders with immutable identity, excludes junk/deleted mail, and preserves sent and received evidence',async()=>{
 vi.mocked(verifyMailbox).mockResolvedValue({...account,provider:'outlook',verifiedAt:''});
 vi.mocked(mailComposioRequest).mockImplementation(async(_ctx,_path,input:any)=>{expect(input.method).toBe('GET');if(input.endpoint.includes('/mailFolders/'))return {status:200,data:{id:input.endpoint.includes('deleteditems')?'deleted':'junk'}};expect(input.endpoint).toContain('/me/messages?');return {status:200,data:{value:[{id:'sent',from:{emailAddress:{address:account.email}},body:{content:'I promised the scope.'}},{id:'received',from:{emailAddress:{address:'other@example.test'}},body:{content:'I will send that.'}},{id:'junk',parentFolderId:'junk',body:{content:'Buy now'}}]}};});
 const reader=outlookScannerReader(ctx);await reader.verify(account);const page=await reader.page(account,'mail',cursor);expect(page.items.map(i=>i.origin.kind)).toEqual(['sent','received','received']);expect(page.items[2].removed).toBe(true);
 expect(vi.mocked(mailComposioRequest).mock.calls.every(c=>(c[2] as any).parameters.some((p:any)=>p.name==='Prefer'&&p.value.includes('ImmutableId')))).toBe(true);
});
it('rejects an identity mismatch and cross-origin, credential-bearing or unexpected-path pagination',async()=>{
 vi.mocked(verifyMailbox).mockResolvedValue({...account,email:'other@example.test',provider:'outlook',verifiedAt:''});const reader=outlookScannerReader(ctx);await expect(reader.verify(account)).rejects.toThrow('identity');
 for(const next of ['https://evil.test/v1.0/me/messages','https://user:pass@graph.microsoft.com/v1.0/me/messages','https://graph.microsoft.com/v1.0/users/other/messages'])await expect(reader.page(account,'mail',{...cursor,next})).rejects.toThrow('pagination');expect(mailComposioRequest).not.toHaveBeenCalled();
});
it('fails on permission errors and never calls a mutation endpoint',async()=>{
 vi.mocked(mailComposioRequest).mockResolvedValue({status:403,data:{}});await expect(outlookScannerReader(ctx).page(account,'calendar',cursor)).rejects.toThrow('denied');expect((vi.mocked(mailComposioRequest).mock.calls[0][2] as any).method).toBe('GET');
});
it('rechecks the original message with the same unique-body fields used for ingestion',async()=>{
 vi.mocked(verifyMailbox).mockResolvedValue({...account,provider:'outlook',verifiedAt:''});vi.mocked(mailComposioRequest).mockResolvedValue({status:200,data:{id:'m',body:{content:'Full thread'},uniqueBody:{content:'Latest promise'}}});
 const result=await outlookScannerReader(ctx).current({key:'',version:'',title:'',text:'',origin:{kind:'received',accountId:account.connectionId,email:account.email,externalId:'m',observedAt:''}});expect(result.text).toContain('Latest promise');expect((vi.mocked(mailComposioRequest).mock.calls[0][2] as any).endpoint).toContain('uniqueBody');
});
it('ignores historical mail that was recently modified and retains genuinely recent messages',async()=>{
 vi.mocked(mailComposioRequest).mockImplementation(async(_ctx,_path,input:any)=>input.endpoint.includes('/mailFolders/')?{status:200,data:{id:'excluded'}}:{status:200,data:{value:[{id:'old',receivedDateTime:'2025-01-01T00:00:00Z',body:{content:'Old decision'}},{id:'new',receivedDateTime:'2026-11-13T00:00:00Z',body:{content:'New promise'}}]}});
 const result=await outlookScannerReader(ctx).page(account,'mail',{...cursor,mailSince:'2026-11-07T00:00:00Z'});expect(result.items.map(i=>i.origin.externalId)).toEqual(['new']);
});
