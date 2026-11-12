// @vitest-environment node
import {expect,it} from 'vitest';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import type {AddressInfo} from 'node:net';
import {createEaiosServer,loadConfig} from '../../server/prod';
it('serves private activity and requires same-origin JSON to persist reviews',async()=>{
 const root=mkdtempSync(join(tmpdir(),'eaios-today-http-'));mkdirSync(join(root,'dist'));mkdirSync(join(root,'hermes'));writeFileSync(join(root,'dist/index.html'),'<title>EAiOS</title>');
 const server=createEaiosServer(loadConfig({EAIOS_ROOT:root,EAIOS_DATA_ROOT:root,HERMES_HOME:join(root,'hermes'),EAIOS_DIST:join(root,'dist')}));
 try{
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const activity=await fetch(base+'/api/today/activity');expect(activity.status).toBe(200);expect(activity.headers.get('cache-control')).toBe('no-store');expect((await activity.json()).reviewed).toEqual([]);
  const bad=await fetch(base+'/api/today/review',{method:'POST',headers:{origin:'https://evil.example','content-type':'application/json'},body:JSON.stringify({key:'work:w:1'})});expect(bad.status).toBe(403);
  const good=await fetch(base+'/api/today/review',{method:'POST',headers:{origin:base,'content-type':'application/json'},body:JSON.stringify({key:'work:w:1'})});expect(good.status).toBe(200);expect((await good.json()).reviewed).toEqual(['work:w:1']);
  expect((await (await fetch(base+'/api/today/activity')).json()).reviewed).toEqual(['work:w:1']);
 }finally{await new Promise<void>(resolve=>server.close(()=>resolve()));rmSync(root,{recursive:true,force:true});}
});
