// @vitest-environment node
import {it,expect} from 'vitest';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {moduleConfig,optionalModuleForPath,coreModules} from '../../server/modules';
it('keeps existing boxes full and loads persisted core addons',()=>{
 const root=mkdtempSync(join(tmpdir(),'eaios-modules-'));try{
  expect(moduleConfig(root).enabled).toContain('social');
  writeFileSync(join(root,'modules.local.json'),JSON.stringify({edition:'core',addons:['social']}));
  expect(moduleConfig(root).enabled).toEqual([...coreModules,'social']);
  expect(moduleConfig(root).enabled).not.toContain('podcasts');expect(moduleConfig(root).enabled).toContain('insights');
  writeFileSync(join(root,'modules.local.json'),'bad json');expect(()=>moduleConfig(root)).toThrow();
 }finally{rmSync(root,{recursive:true,force:true});}
});
it('identifies optional UI and API routes without blocking core skills or knowledge',()=>{
 for(const p of ['/social','/api/social-posts','/api/social/accounts'])expect(optionalModuleForPath(p)).toBe('social');
 for(const p of ['/podcasts','/podcasts-api/generate','/api/podcasts/1'])expect(optionalModuleForPath(p)).toBe('podcasts');
 for(const p of ['/api/executive-insights','/api/skills','/knowledge-api/query'])expect(optionalModuleForPath(p)).toBeNull();
});
