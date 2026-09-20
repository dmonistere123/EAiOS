import {afterEach,expect,it,vi} from 'vitest';
import {LiveTravelAdapter} from '../adapters/live/LiveTravelAdapter';
afterEach(()=>vi.unstubAllGlobals());
it('never substitutes demo trips after failure and recovers on the next read',async()=>{
 const fetcher=vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({error:'Provider unavailable'}),{status:503})).mockResolvedValueOnce(new Response(JSON.stringify({trips:[]})));
 vi.stubGlobal('fetch',fetcher);const adapter=new LiveTravelAdapter();
 await expect(adapter.listTrips()).rejects.toThrow('Provider unavailable');expect(await adapter.listTrips()).toEqual([]);
});
it('returns a failed mutation after a lost response without retry or fake confirmation',async()=>{
 const fetcher=vi.fn().mockRejectedValue(new Error('connection lost'));vi.stubGlobal('fetch',fetcher);
 const result=await new LiveTravelAdapter().decideTravelApproval('a',{decision:'approved'});
 expect(result.ok).toBe(false);expect(result.data).toBeUndefined();expect(fetcher).toHaveBeenCalledTimes(1);
});
