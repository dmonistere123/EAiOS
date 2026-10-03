import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AssistantRequestClient } from '../adapters/live/AssistantRequestClient';
import type { RequestView } from '../domain/assistantRequest';
const row = (id: string, state: RequestView['state']='running'): RequestView => ({id,text:'one',state,revision:1,response:'',progress:'Working',createdAt:'2026-10-03T00:00:00Z',updatedAt:'2026-10-03T00:00:00Z'});
beforeEach(()=>{localStorage.clear();vi.useFakeTimers();});
afterEach(()=>{vi.useRealTimers();vi.unstubAllGlobals();});
describe('request receipts in the browser',()=>{
  it('recovers an accepted request after lost acknowledgement and page refresh, with only one POST',async()=>{
    let accepted: RequestView; const calls: string[]=[];
    vi.stubGlobal('fetch',vi.fn(async(_url:string,init?:RequestInit)=>{
      calls.push(init?.method??'GET');
      if(init?.method==='POST'){accepted=row(JSON.parse(String(init.body)).id);throw new Error('lost acknowledgement');}
      return Response.json({requests:[accepted]});
    }));
    const a=new AssistantRequestClient();const receipt=await a.create('one');expect(receipt.state).toBe('reconnecting');
    const refreshed=new AssistantRequestClient();expect((await refreshed.list())[0].id).toBe(receipt.id);expect(calls).toEqual(['POST','GET']);
  });
  it('never abandons a running request at 150 seconds and recovers completion by GET',async()=>{
    let accepted:RequestView;vi.stubGlobal('fetch',vi.fn(async(_url:string,init?:RequestInit)=>{
      if(init?.method==='POST'){accepted=row(JSON.parse(String(init.body)).id);return Response.json(accepted);}
      return Response.json({requests:[accepted]});
    }));
    const client=new AssistantRequestClient();await client.create('one');await vi.advanceTimersByTimeAsync(180000);
    expect((await client.list())[0].state).toBe('running');accepted={...accepted!,state:'completed',response:'late answer'};
    expect((await client.list())[0].response).toBe('late answer');expect(vi.mocked(fetch).mock.calls.filter(c=>c[1]?.method==='POST')).toHaveLength(1);
  });
  it('uses fresh IDs and does not include previous prompt text except an explicit handoff',async()=>{
    const bodies:Record<string,unknown>[]=[];vi.stubGlobal('fetch',vi.fn(async(_url:string,init:RequestInit)=>{const body=JSON.parse(String(init.body));bodies.push(body);return Response.json(row(body.id));}));
    const client=new AssistantRequestClient();await client.create('private first context');await client.create('fresh second',[{name:'handoff.md',mimeType:'text/markdown',encoding:'text',content:'chosen'}]);
    expect(bodies[0].id).not.toBe(bodies[1].id);expect(JSON.stringify(bodies[1])).not.toContain('private first');expect(JSON.stringify(bodies[1])).toContain('chosen');
  });
  it('retains uncertainty when no accepted receipt can be found, without replay',async()=>{
    let posts=0;vi.stubGlobal('fetch',vi.fn(async(url:string,init?:RequestInit)=>{
      if(init?.method==='POST'){posts++;throw new Error('offline');}
      if(url==='/api/assistant/requests')return Response.json({requests:[]});
      return Response.json({error:'not found'},{status:404});
    }));
    const client=new AssistantRequestClient();await client.create('one');expect((await client.list())[0].stale).toBe(true);await client.list();expect(posts).toBe(1);
  });
  it('keeps the transport deadline active while an acknowledgement body stalls',async()=>{
    vi.stubGlobal('fetch',vi.fn(async(_url:string,init?:RequestInit)=>new Response(new ReadableStream({start(controller){init?.signal?.addEventListener('abort',()=>controller.error(new DOMException('aborted','AbortError')));}}))));
    const pending=new AssistantRequestClient().create('one');await vi.advanceTimersByTimeAsync(10001);expect((await pending).state).toBe('reconnecting');expect(fetch).toHaveBeenCalledOnce();
  });
  it('does not transmit if browser recovery storage is unavailable',async()=>{
    const fetcher=vi.fn();vi.stubGlobal('fetch',fetcher);const spy=vi.spyOn(Storage.prototype,'setItem').mockImplementation(()=>{throw new Error('full');});
    await expect(new AssistantRequestClient().create('one')).rejects.toThrow('full');expect(fetcher).not.toHaveBeenCalled();spy.mockRestore();
  });
  it('hydrates accepted prompt and partial output offline, then merges revisions without regression',async()=>{
    let current:RequestView={...row('cached'),revision:5,text:'original question',response:'partial answer'};
    vi.stubGlobal('fetch',vi.fn(async()=>Response.json({requests:[current]})));
    await new AssistantRequestClient().list();
    const refreshed=new AssistantRequestClient();expect(refreshed.cached()[0]).toMatchObject({text:'original question',response:'partial answer',stale:true,revision:5});
    vi.mocked(fetch).mockRejectedValueOnce(new Error('offline'));await expect(refreshed.list()).rejects.toThrow('offline');
    expect(refreshed.cached()[0].response).toBe('partial answer');
    current={...current,revision:4,response:'older'};expect((await refreshed.list())[0]).toMatchObject({revision:5,response:'partial answer',stale:true});
    current={...current,revision:6,response:'complete',state:'completed'};expect((await refreshed.list())[0]).toMatchObject({revision:6,response:'complete',stale:false});
  });
  it('bounds cached previews and lookup fanout while preserving active request IDs',async()=>{
    const active=Array.from({length:16},(_,i)=>({...row(`active-${i}`),text:'q'.repeat(6000),response:'r'.repeat(20000)}));
    vi.stubGlobal('fetch',vi.fn(async()=>Response.json({requests:active})));
    const client=new AssistantRequestClient();await client.list();const cached=client.cached();
    expect(cached).toHaveLength(16);expect(cached.every(r=>r.text.length===4096&&r.response.length===8192&&r.cacheLimited)).toBe(true);
    vi.mocked(fetch).mockClear().mockImplementation(async(url)=>String(url)==='/api/assistant/requests'?Response.json({requests:[]}):Response.json({error:'missing'},{status:404}));
    expect(await client.list()).toHaveLength(16);expect(fetch).toHaveBeenCalledTimes(5);
    expect(client.cached().map(r=>r.id)).toEqual(cached.map(r=>r.id));
  });

});
