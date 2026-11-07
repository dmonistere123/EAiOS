import {readFileSync} from 'node:fs';
import {join} from 'node:path';
export const coreModules=['today','assistant','staff','connections','approvals','schedule','travel','knowledge','skills','artifacts','usage','insights','backup','settings'];
export const optionalModules=['podcasts','social'];
export function moduleConfig(dataRoot:string){
 try{
  const value=JSON.parse(readFileSync(join(dataRoot,'modules.local.json'),'utf8'));
  if(!['core','full'].includes(value.edition)||!Array.isArray(value.addons)||value.addons.some((x:unknown)=>typeof x!=='string'||!optionalModules.includes(x)))throw new Error('Invalid module configuration');
  return {edition:value.edition,enabled:[...coreModules,...(value.edition==='full'?optionalModules:value.addons)]};
 }catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return {edition:'full',enabled:[...coreModules,...optionalModules]};throw e;}
}
export function optionalModuleForPath(path:string){
 if(/^\/(?:api\/social(?:[-/]|$)|social(?:\/|$))/.test(path))return 'social';
 if(/^\/(?:podcasts-api(?:\/|$)|api\/podcasts?(?:[-/]|$)|podcasts(?:\/|$))/.test(path))return 'podcasts';
 return null;
}
