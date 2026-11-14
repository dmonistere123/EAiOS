import {describe,it,expect} from 'vitest';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {PromoStore,validatePromoPlan} from '../../server/podcastPromo';

const alignment=Array.from({length:50},(_,i)=>({start:i*5,end:i*5+4.5,text:'Source speech',words:[]}));
const plan=()=>({title:'Good systems',excerptStart:10,accent:'teal',showHand:false,reply:'Follow the original speech.',scenes:[0,20,40].map((at,i)=>({at,title:`Scene ${i}`,subtitle:'From the source',visual:'checklist',labels:['Accountable owner','Clear handoff']}))});
describe('podcast promo planning boundaries',()=>{
 it('keeps original audio, limits length, and defaults to no hand',()=>{const p=validatePromoPlan(plan(),250,alignment);expect(p.excerptStart).toBe(10);expect(p.audioDuration).toBeLessThanOrEqual(86);expect(p.duration).toBe(90);expect(p.showHand).toBe(false);});
 it('rejects out-of-range excerpts and unsupported executable layouts',()=>{expect(()=>validatePromoPlan({...plan(),excerptStart:500},250,alignment)).toThrow();const p=plan();p.scenes[0].visual='execute';expect(()=>validatePromoPlan(p,250,alignment)).toThrow();});
 it('rejects unbounded text and scene timing',()=>{const p=plan();p.scenes[1].at=100;expect(()=>validatePromoPlan(p,250,alignment)).toThrow();p.scenes[1].at=20;p.scenes[1].title='x'.repeat(80);expect(()=>validatePromoPlan(p,250,alignment)).toThrow();});
 it('fits overlong generated subtitles without discarding the storyboard',()=>{
  const raw=plan();raw.scenes[0].subtitle='A clear owner keeps the work moving and helps the whole team deliver a consistent experience for every customer.';
  const result=validatePromoPlan(raw,250,alignment);
  expect(result.scenes[0].subtitle.length).toBeLessThanOrEqual(90);
  expect(result.scenes[0].subtitle.endsWith('…')).toBe(true);
  expect(raw.scenes[0].subtitle.startsWith(result.scenes[0].subtitle.slice(0,-1))).toBe(true);
  expect(result.scenes[1]).toEqual(raw.scenes[1]);
 });
 it('allows absent subtitles and normalizes whitespace while rejecting malformed values',()=>{
  const raw=plan() as any;delete raw.scenes[0].subtitle;raw.scenes[1].subtitle=null;raw.scenes[2].subtitle=' Clear\n  ownership ';
  expect(validatePromoPlan(raw,250,alignment).scenes.map(s=>s.subtitle)).toEqual(['','','Clear ownership']);
  raw.scenes[0].subtitle={text:'Not a string'};expect(()=>validatePromoPlan(raw,250,alignment)).toThrow('Invalid scene subtitle');
  raw.scenes[0].subtitle='x'.repeat(4001);expect(()=>validatePromoPlan(raw,250,alignment)).toThrow('Invalid scene subtitle');
 });
 it('preserves every unselected scene and the entire audio excerpt on a scoped revision',()=>{const base=validatePromoPlan(plan(),250,alignment);const raw=plan();raw.scenes.forEach(s=>{s.title='Changed';s.at+=1;});raw.scenes[0].at=0;raw.excerptStart=0;const revised=validatePromoPlan(raw,250,alignment,base,'scene:1');expect(revised.scenes[0]).toEqual(base.scenes[0]);expect(revised.scenes[2]).toEqual(base.scenes[2]);expect(revised.scenes[1].title).toBe('Changed');expect(revised.scenes[1].at).toBe(base.scenes[1].at);expect(revised.excerptStart).toBe(base.excerptStart);expect(revised.audioDuration).toBe(base.audioDuration);});
});
describe('durable video jobs',()=>{
 function use(fn:(store:PromoStore,other:PromoStore)=>void){const root=mkdtempSync(join(tmpdir(),'promo-test-'));const a=new PromoStore(root),b=new PromoStore(root);try{fn(a,b);}finally{a.db.close();b.db.close();rmSync(root,{recursive:true,force:true});}}
 it('deduplicates a retried request and blocks duplicate episode renders',()=>use(s=>{const token=randomUUID();const a=s.create('p-one',token,'','Entire video');expect(s.create('p-one',token,'','Entire video').id).toBe(a.id);expect(()=>s.create('p-one',randomUUID(),'','Entire video')).toThrow(/already/);}));
 it('allows only one running renderer across server processes',()=>use((a,b)=>{a.create('p-one',randomUUID(),'','Entire video');b.create('p-two',randomUUID(),'','Entire video');expect(a.claim()).toBeTruthy();expect(b.claim()).toBeUndefined();}));
 it('cancellation wins against late worker completion',()=>use(s=>{const j=s.create('p-one',randomUUID(),'','Entire video');s.claim();s.patch(j.id,{status:'cancelled'},'running');expect(s.patch(j.id,{status:'ready'},'running')).toBeUndefined();expect(s.read(j.id)?.status).toBe('cancelled');}));
 it('keeps the old completed version while a new revision fails',()=>use(s=>{const j=s.create('p-one',randomUUID(),'','Entire video');s.claim();s.patch(j.id,{status:'ready',plan:validatePromoPlan(plan(),250,alignment)},'running');const r=s.create('p-one',randomUUID(),'Use less text','scene:1',j.id);s.claim();s.patch(r.id,{status:'failed'},'running');expect(s.read(j.id)?.status).toBe('ready');expect(s.list('p-one')).toHaveLength(2);}));
 it('rejects cross-episode bases and invalid paths',()=>use(s=>{const j=s.create('p-one',randomUUID(),'','Entire video');s.claim();s.patch(j.id,{status:'ready'},'running');expect(()=>s.create('p-other',randomUUID(),'Revise','Entire video',j.id)).toThrow();expect(()=>s.dir('../../keys')).toThrow();}));
});
