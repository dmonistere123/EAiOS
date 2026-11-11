// @vitest-environment node
import {it,expect,vi} from 'vitest';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import type {AddressInfo} from 'node:net';
import {createEaiosServer,loadConfig} from '../../server/prod';
const probe=vi.hoisted(()=>({requests:0}));
vi.mock('../../server/ticker.ts',()=>({handleTickerRequest:async(req:{url:string},res:{end:(body:string)=>void})=>{
 if(req.url!=='/ticker-api/sports')return false;
 probe.requests++;res.end(JSON.stringify({version:1,sports:{},state:'live'}));return true;
}}));
it.each(['core','full'])('%s edition gates ticker UI and data before fetching the provider',async edition=>{
 const root=mkdtempSync(join(tmpdir(),'eaios-ticker-edition-'));
 mkdirSync(join(root,'dist'));mkdirSync(join(root,'hermes'));
 writeFileSync(join(root,'dist/index.html'),'<title>EAiOS</title>');
 writeFileSync(join(root,'modules.local.json'),JSON.stringify({edition,addons:[]}));
 const server=createEaiosServer(loadConfig({EAIOS_ROOT:root,EAIOS_DATA_ROOT:root,HERMES_HOME:join(root,'hermes'),EAIOS_DIST:join(root,'dist')}));
 try{
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base=`http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const before=probe.requests;
  for(const path of ['/ticker','/ticker-api/sports'])expect((await fetch(base+path)).status).toBe(edition==='core'?403:200);
  expect(probe.requests-before).toBe(edition==='core'?0:1);
  const modules=await (await fetch(base+'/api/modules')).json();
  expect(modules.enabled.includes('ticker')).toBe(edition==='full');
 }finally{await new Promise<void>(resolve=>server.close(()=>resolve()));rmSync(root,{recursive:true,force:true});}
});
