// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { generateSocial, generateSocialImage, manualSocial, editSocial, validateSocialBrief } from '../../server/social.ts';
import { socialBoard, socialStore, putSocialPost } from '../../server/socialStore.ts';
import { handleApiRequest } from '../../server/httpApi.ts';
import { plannedDates, socialDates, socialCopyLength, socialArchive, socialHistory } from '../domain/social.ts';
import type { SocialBrief, SocialPost } from '../domain/social.ts';
const roots:string[]=[];
function setup(){const root=mkdtempSync(join(tmpdir(),'social-test-'));roots.push(root);const home=join(root,'home'), data=join(root,'data'),code=join(root,'release');for(const p of [home,join(data,'app'),code])mkdirSync(p,{recursive:true});writeFileSync(join(home,'.env'),'OPENROUTER_API_KEY=test-token\nOPENAI_API_KEY=test-image-token\n');return{hermesHome:home,dataRoot:data,eaiosRoot:code};}
const brief:SocialBrief={subject:'Give your team ownership',voice:'Practical',identity:'Test executive',networks:['linkedin','x','instagram'],days:[1,3,5],startDate:'2026-10-12',time:'12:00',timeZone:'America/Chicago',count:1,imageStyle:'none',kind:'post'};
const rid=()=>crypto.randomUUID();
afterEach(()=>{roots.splice(0).forEach(p=>rmSync(p,{recursive:true,force:true}));vi.unstubAllGlobals();vi.restoreAllMocks();});
it('plans calendar days without shifting through DST; rejects invalid dates and cadence',()=>{expect(plannedDates('2026-10-30',[1,3,5],3)).toEqual(['2026-10-30','2026-11-02','2026-11-04']);for(const start of ['2026-02-30','no'])expect(()=>plannedDates(start,[1],1)).toThrow();expect(()=>plannedDates('2026-10-12',[],3)).toThrow();expect(()=>validateSocialBrief({...brief,kind:'blog',days:[1],sourceUrl:'https://linkedin.com/pulse/a',sourceText:'body'})).toThrow();});
it('persists drafts across release roots without modifying credentials or agents',()=>{const c=setup(), original=readFileSync(join(c.hermesHome,'.env'),'utf8');writeFileSync(join(c.hermesHome,'SOUL.md'),'custom-agent');manualSocial(c,{brief,requestId:rid()});expect(socialBoard(c.dataRoot).posts).toHaveLength(3);const changed={...c,eaiosRoot:join(c.eaiosRoot,'next-release')};expect(socialBoard(changed.dataRoot).posts[2].network).toBe('instagram');expect(readFileSync(join(c.hermesHome,'SOUL.md'),'utf8')).toBe('custom-agent');expect(readFileSync(join(c.hermesHome,'.env'),'utf8')).toBe(original);});
it('does not call a provider when manually drafting; rejects duplicate submissions',()=>{const c=setup(),fetcher=vi.fn();vi.stubGlobal('fetch',fetcher);const requestId=rid();manualSocial(c,{brief,requestId});expect(()=>manualSocial(c,{brief,requestId})).toThrow('already submitted');expect(fetcher).not.toHaveBeenCalled();});
it('enforces revisions, invalidates review and refuses client-authored publication',()=>{const c=setup();let p=manualSocial(c,{brief,requestId:rid()})[0];expect(()=>editSocial(c.dataRoot,p.id,{...p,action:'review'})).toThrow('Complete');p=editSocial(c.dataRoot,p.id,{...p,action:'edit',copy:'A real draft'});p=editSocial(c.dataRoot,p.id,{...p,action:'review'});expect(p.status).toBe('reviewed');const old=p;p=editSocial(c.dataRoot,p.id,{...p,action:'edit',copy:'Changed copy',status:'published'});expect(p.status).toBe('draft');expect(()=>editSocial(c.dataRoot,p.id,{...old,action:'archive'})).toThrow('changed');expect(()=>editSocial(c.dataRoot,p.id,{...p,action:'publish'})).toThrow('not enabled');expect(()=>editSocial(c.dataRoot,p.id,{...p,action:'edit',time:'30:00'})).toThrow('time');});
it('separates history from archive at 30 days, based on published time',()=>{const now=Date.parse('2026-10-10T12:00:00Z');const base={status:'published',publishedAt:new Date(now-29*86400000).toISOString()} as SocialPost;const older={...base,publishedAt:new Date(now-30*86400000).toISOString()};expect(socialHistory([base,older],now)).toEqual([base]);expect(socialArchive([base,older],now)).toEqual([older]);});
it('stores genuine model output and never gives the writing model execution tools',async()=>{const c=setup();const f=vi.fn(async()=>Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify({posts:[{title:'Ownership',copy:'Give your team one decision to own.',imagePrompt:''}]})}}]}));vi.stubGlobal('fetch',f);const p=await generateSocial(c,{brief,requestId:rid()});expect(p).toHaveLength(3);expect(p[0].copy).toContain('one decision');expect(p.every(x=>x.status==='draft')).toBe(true);const payload=JSON.parse((f.mock.calls[0] as unknown as [string,RequestInit])[1].body as string);expect(payload.tools).toBeUndefined();expect(JSON.stringify(payload)).not.toContain('test-token');});
it('refuses incomplete or failed generation without demo content or retry',async()=>{const c=setup();const f=vi.fn(async()=>new Response('upstream error',{status:403}));vi.stubGlobal('fetch',f);const requestId=rid();await expect(generateSocial(c,{brief,requestId})).rejects.toThrow('403');expect(socialBoard(c.dataRoot).posts).toHaveLength(0);await expect(generateSocial(c,{brief,requestId})).rejects.toThrow('already submitted');expect(f).toHaveBeenCalledTimes(1);});
it('preserves all drafts when one exceeds its platform limit, but gates review',async()=>{
 const c=setup();vi.stubGlobal('fetch',vi.fn(async()=>Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify({posts:[{title:'Draft',copy:'x'.repeat(300),imagePrompt:''}]})}}]})));
 const posts=await generateSocial(c,{brief,requestId:rid()});expect(socialBoard(c.dataRoot).posts).toHaveLength(3);const x=posts.find(p=>p.network==='x')!;expect(x.copy).toHaveLength(300);
 expect(()=>editSocial(c.dataRoot,x.id,{...x,action:'review'})).toThrow('Shorten');
 const saved=editSocial(c.dataRoot,x.id,{...x,action:'edit',copy:'x'.repeat(290)});expect(saved.copy).toHaveLength(290);
 const shortened=editSocial(c.dataRoot,x.id,{...saved,action:'edit',copy:'Concise copy'});expect(editSocial(c.dataRoot,x.id,{...shortened,action:'review'}).status).toBe('reviewed');
});
it('rejects a changed draft after image provider completes',async()=>{const c=setup();let p=manualSocial(c,{brief:{...brief,imageStyle:'photo'},requestId:rid()})[0];p=editSocial(c.dataRoot,p.id,{...p,action:'edit',copy:'Copy to illustrate'});vi.stubGlobal('fetch',vi.fn(async()=>{editSocial(c.dataRoot,p.id,{...p,action:'edit',copy:'Changed while waiting'});return Response.json({data:[{b64_json:Buffer.from([137,80,78,71,13,10,26,10,0]).toString('base64')}]});}));await expect(generateSocialImage(c,p.id,{revision:p.revision,requestId:rid()})).rejects.toThrow('changed during');expect(socialBoard(c.dataRoot).posts[0].imageVersion).toBeUndefined();});
it('attaches provider PNG and invalidates its review when its prompt changes',async()=>{const c=setup();let p=manualSocial(c,{brief:{...brief,imageStyle:'photo'},requestId:rid()})[0];p=editSocial(c.dataRoot,p.id,{...p,action:'edit',copy:'Copy'});vi.stubGlobal('fetch',vi.fn(async()=>Response.json({data:[{b64_json:Buffer.from([137,80,78,71,13,10,26,10,0]).toString('base64')}] })));p=await generateSocialImage(c,p.id,{revision:p.revision,requestId:rid()});expect(p.imageVersion).toBeTruthy();p=editSocial(c.dataRoot,p.id,{...p,action:'review'});expect(p.status).toBe('reviewed');p=editSocial(c.dataRoot,p.id,{...p,action:'edit',imagePrompt:'New prompt'});expect(p.imageVersion).toBeUndefined();expect(p.status).toBe('draft');});
it('serves persistent data through the actual router and blocks cross-origin writes',async()=>{const c=setup();const server=createServer((req,res)=>{void handleApiRequest(req,res,c).then(done=>{if(!done){res.statusCode=404;res.end();}});});await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));const url=`http://127.0.0.1:${(server.address() as {port:number}).port}`;try{const denied=await fetch(url+'/api/social/manual',{method:'POST',headers:{'content-type':'application/json',origin:'https://elsewhere.test'},body:JSON.stringify({brief,requestId:rid()})});expect(denied.status).toBe(403);const ok=await fetch(url+'/api/social/manual',{method:'POST',headers:{'content-type':'application/json',origin:url},body:JSON.stringify({brief,requestId:rid()})});expect(ok.status).toBe(200);expect((await(await fetch(url+'/api/social')).json()).posts).toHaveLength(3);}finally{await new Promise<void>(r=>server.close(()=>r()));}});
it('history cannot be rewritten through draft updates',()=>{const c=setup();const p=manualSocial(c,{brief,requestId:rid()})[0];socialStore(c.dataRoot,db=>putSocialPost(db,{...p,status:'published',publishedAt:new Date().toISOString()}));expect(()=>editSocial(c.dataRoot,p.id,{...p,action:'edit',copy:'replacement'})).toThrow('read-only');});
it('keeps valid generated copy when model titles are missing, empty or too long',async()=>{
 const c=setup();const copies=['LinkedIn copy stays intact','X copy stays intact','Instagram copy stays intact'];
 let index=0; const responses=[{title:'Growth 🚀 '.repeat(60),copy:copies[0],imagePrompt:''},{copy:copies[1],imagePrompt:''},{title:'  ',copy:copies[2],imagePrompt:''}];
 vi.stubGlobal('fetch',vi.fn(async()=>Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify({posts:[responses[index++]]})}}]})));
 const posts=await generateSocial(c,{brief,requestId:rid()});expect(posts).toHaveLength(3);expect(posts[0].title.length).toBeLessThanOrEqual(200);expect(posts[0].title.endsWith('…')).toBe(true);expect(posts[1].title).toBe(brief.subject);expect(posts[2].title).toBe(brief.subject);expect(posts.map(p=>p.copy)).toEqual(copies);expect(socialBoard(c.dataRoot).posts).toHaveLength(3);
});

it('plans a full MWF month and validates range boundaries',()=>{
 expect(socialDates({...brief,startDate:'2026-11-01',endDate:'2026-11-30'})).toHaveLength(13);
 expect(socialDates({...brief,startDate:'2026-11-01',endDate:'2026-11-30'}).at(-1)).toBe('2026-11-30');
 expect(()=>socialDates({...brief,endDate:'2027-01-01'})).toThrow('31 days');
 expect(()=>socialDates({...brief,endDate:'2026-10-01'})).toThrow();
});
it('writes slots individually with earlier copy and repairs overlong LinkedIn once',async()=>{
 const c=setup();const f=vi.fn().mockResolvedValueOnce(Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify({posts:[{title:'First',copy:'a'.repeat(900)}]})}}]})).mockResolvedValueOnce(Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify({posts:[{title:'First',copy:'Concise first insight'}]})}}]})).mockResolvedValueOnce(Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify({posts:[{title:'Second',copy:'A different lesson'}]})}}]}));vi.stubGlobal('fetch',f);
 const b={...brief,networks:['linkedin'],count:2};const first=await generateSocial(c,{brief:b,requestId:rid(),slotIndex:0});expect(first[0].copy).toBe('Concise first insight');
 await generateSocial(c,{brief:b,requestId:rid(),slotIndex:1});const context=JSON.parse(JSON.parse(f.mock.calls[2][1].body).messages[1].content);expect(context.previous[0].copy).toBe('Concise first insight');expect(context.slot.angle).not.toBe(context.plan[0].angle);expect(socialBoard(c.dataRoot).posts).toHaveLength(2);
});
it('keeps the original if shortening fails and enforces 850 on existing LinkedIn drafts',async()=>{
 const c=setup();vi.stubGlobal('fetch',vi.fn().mockResolvedValueOnce(Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify({posts:[{title:'Long',copy:'a'.repeat(851)}]})}}]})).mockRejectedValueOnce(new Error('offline')));
 const [p]=await generateSocial(c,{brief:{...brief,networks:['linkedin']},requestId:rid()});expect(p.copy).toHaveLength(851);expect(()=>editSocial(c.dataRoot,p.id,{...p,action:'review'})).toThrow('850');expect(socialBoard(c.dataRoot).posts).toHaveLength(1);
});
it('counts X wide characters and reserves link space conservatively',()=>{expect(socialCopyLength('界'.repeat(141),'x')).toBe(282);expect(socialCopyLength('https://a.co','x')).toBe(23);});
it('keeps two LinkedIn destinations separate and refuses unknown account IDs',()=>{
 const c=setup();const accounts=[{id:'personal',network:'linkedin',label:'Personal',url:'https://www.linkedin.com/in/example/'},{id:'company',network:'linkedin',label:'Company',url:'https://www.linkedin.com/company/123/'}];
 mkdirSync(join(c.dataRoot,'social-data'));writeFileSync(join(c.dataRoot,'social-data/accounts.json'),JSON.stringify(accounts));
 const posts=manualSocial(c,{brief:{...brief,networks:['linkedin'],accountIds:['personal','company']},requestId:rid()});expect(posts).toHaveLength(2);expect(posts.map(p=>p.account?.id)).toEqual(['personal','company']);expect(posts.map(p=>p.identity)).toEqual(['Personal','Company']);
 expect(()=>manualSocial(c,{brief:{...brief,accountIds:['unknown']},requestId:rid()})).toThrow('unavailable');
 const updated=editSocial(c.dataRoot,posts[0].id,{...posts[0],copy:'Copy',identity:'Company',account:accounts[1],action:'edit'});expect(updated.account?.id).toBe('personal');expect(updated.identity).toBe('Personal');
 expect(socialBoard(c.dataRoot).accounts).toEqual(accounts);
});
it('preserves legacy Snapchat drafts without converting them to Instagram',()=>{
 const c=setup();const p=manualSocial(c,{brief,requestId:rid()})[0];socialStore(c.dataRoot,db=>putSocialPost(db,{...p,network:'snapchat'}));expect(socialBoard(c.dataRoot).posts.find(x=>x.id===p.id)?.network).toBe('snapchat');
});
