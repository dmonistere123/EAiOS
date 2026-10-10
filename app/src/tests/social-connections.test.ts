import { afterEach, expect, it, vi } from 'vitest';
import { liveComposio } from '../adapters/live/LiveComposioAdapter';
afterEach(()=>{vi.unstubAllGlobals();liveComposio.resetCredentials();});
it('finds Snapchat beyond the first catalog page and labels X unambiguously',async()=>{
 const calls:string[]=[];vi.stubGlobal('fetch',vi.fn(async(url: string)=>{calls.push(url);return Response.json(url.includes('connected_accounts')?{items:[]}:url.includes('cursor=')?{items:[{slug:'snapchat',name:'Snapchat',auth_schemes:['OAUTH2'] }]}:{items:[{slug:'twitter',name:'Twitter'}],next_cursor:'page two'});}));
 liveComposio.resetCredentials();const apps=await liveComposio.listAvailableApps();expect(apps.map(a=>a.name)).toEqual(['X (Twitter)','Snapchat Ads']);expect(calls.some(s=>s.includes('cursor=page%20two'))).toBe(true);
});
it('uses a matching custom X configuration instead of permanently blocking setup',async()=>{
 const calls:{url:string;body?:string}[]=[];vi.stubGlobal('fetch',vi.fn(async(url:string,init?:RequestInit)=>{calls.push({url,body:init?.body as string});if(url.includes('/connected_accounts/link'))return Response.json({redirect_url:'https://connect.composio.dev/link/test'});if(url.includes('connected_accounts?'))return Response.json({items:[]});if(url.includes('toolkits'))return Response.json({items:[{slug:'twitter',name:'Twitter',composio_managed_auth_schemes:[]}]});return Response.json({items:[{id:'wrong',toolkit:{slug:'gmail'},is_composio_managed:false},{id:'custom-x',toolkit:{slug:'twitter'},is_composio_managed:false}]});}));
 liveComposio.resetCredentials();expect((await liveComposio.connectApp('twitter')).authUrl).toContain('/link/test');expect(calls.find(c=>c.url.includes('/connected_accounts/link'))?.body).toContain('custom-x');
});
it('does not create managed credentials for a toolkit requiring custom setup',async()=>{
 const post=vi.fn();vi.stubGlobal('fetch',vi.fn(async(url:string,init?:RequestInit)=>{if(init?.method==='POST')post();return Response.json(url.includes('toolkits')?{items:[{slug:'twitter',name:'Twitter',composio_managed_auth_schemes:[]}]}:{items:[]});}));liveComposio.resetCredentials();const result=await liveComposio.connectApp('twitter');expect(result.authUrl).toBeUndefined();expect(result.note).toContain('developer credentials');expect(post).not.toHaveBeenCalled();
});
it('rejects repeated catalog cursors instead of silently hiding connectors',async()=>{
 vi.stubGlobal('fetch',vi.fn(async(url:string)=>Response.json(url.includes('connected_accounts')?{items:[]}:{items:[],next_cursor:'same'})));liveComposio.resetCredentials();await expect(liveComposio.listAvailableApps()).rejects.toThrow('invalid page');
});
