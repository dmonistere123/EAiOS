// @vitest-environment node
import {afterEach,expect,it,vi} from 'vitest';
import {travelPlaces} from '../../server/travelGuide.ts';
import {shortlist} from '../domain/travelGuide';
afterEach(()=>{vi.unstubAllGlobals();vi.unstubAllEnvs();});
it('resolves city names into named airports and deduplicates city/airport matches',async()=>{
 vi.stubEnv('DUFFEL_API_KEY','duffel_test_fixture');
 const airport={id:'arp_btr',name:'Baton Rouge Metropolitan',city_name:'Baton Rouge',iata_code:'BTR',iata_country_code:'US',type:'airport',latitude:30.5,longitude:-91.1};
 const fetcher=vi.fn(async()=>new Response(JSON.stringify({data:[{type:'city',airports:[airport]},airport]})));vi.stubGlobal('fetch',fetcher);
 const result=await travelPlaces(' Baton Rouge ');
 expect(result).toHaveLength(1);expect(result[0]).toMatchObject({name:airport.name,code:'BTR',latitude:30.5});
 expect(fetcher.mock.calls[0]).toBeDefined();
});
it('shortlists at most three distinct actual offers and flags over-budget preferences',()=>{
 const rows=['Other','Southwest','Other 2','Other 3'].map((title,i)=>({id:String(i),title,subtitle:'Route',kind:'flight' as const,provider:'duffel',amount:String(100+i*100),currency:'USD',meta:{}}));
 const selected=shortlist([...rows,rows[0]],'Southwest',150);
 expect(selected).toHaveLength(3);expect(selected[0].id).toBe('1');expect(selected[0].reason).toContain('exceeds');
 expect(selected.every(s=>rows.some(r=>r.id===s.id))).toBe(true);
});

it('offers distinct hotels instead of filling all three cards with rooms at one property',()=>{
 const rows=[['A','Room 1','200.00'],['A','Room 2','100.00'],['B','Room 1','180.00'],['C','Room 1','190.00']].map(([title,subtitle,amount],i)=>({id:String(i),title,subtitle,amount,currency:'USD',provider:'duffel',kind:'hotel' as const,meta:{accommodationId:title}}));
 const result=shortlist(rows);
 expect(result.map(r=>r.title)).toEqual(['A','B','C']);expect(result[0].amount).toBe('100.00');
});
