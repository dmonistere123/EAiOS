import type { IncomingMessage, ServerResponse } from 'node:http';
import { existsSync, lstatSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { ERM_OWNER } from './ermStore.ts';
import { validPlannerDate } from '../src/domain/planner.ts';
import { PlannerError, PlannerStore } from './plannerStore.ts';

import { moduleConfig } from './modules.ts';
import type { ApiContext } from './httpApi.ts';
const api='/api/daily-planner';
const ownerId='local-executive';
const readOnly = new Set(['GET','HEAD']);
const uuid=/^[0-9a-f-]{36}$/i;
const taskIdPattern=/^(?:[0-9a-f-]{36}|[0-9a-f]{64})$/i;
function json(res:ServerResponse,status:number,value:unknown) {
 res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
 res.end(JSON.stringify(value));
}
async function bytes(req:IncomingMessage,limit:number) {
 if(Number(req.headers['content-length'])>limit)throw new PlannerError(413,'Request is too large.');
 let length=0; const chunks:Buffer[]=[];
 for await(const chunk of req){
  const b=Buffer.from(chunk);length+=b.length;
  if(length>limit)throw new PlannerError(413,'Request is too large.');
  chunks.push(b);
 }
 return Buffer.concat(chunks);
}
function readCrmFollowUp(root:string|undefined,contactId:unknown,noteId:unknown){
 if(!root||typeof contactId!=='string'||typeof noteId!=='string'||!uuid.test(contactId)||!uuid.test(noteId))return null;
 const dir=join(root,'erm-data'),path=join(dir,'erm.db');
 for(const f of [dir,path,path+'-wal',path+'-shm'])if(existsSync(f)&&lstatSync(f).isSymbolicLink())throw new PlannerError(503,'E-CRM storage is unavailable.');
 if(!existsSync(path)||!lstatSync(path).isFile())return null;
 const db=new DatabaseSync(path,{readOnly:true});
 try{
  const record=db.prepare("SELECT json_extract(n.body,'$.title') AS title, json_extract(n.body,'$.followUpOn') AS due FROM erm_notes n JOIN erm_contacts c ON c.owner=n.owner AND c.id=n.contact_id WHERE n.owner=? AND n.contact_id=? AND n.id=? AND c.archived=0")
   .get(ERM_OWNER,contactId,noteId) as {title:unknown;due:unknown}|undefined;
  if(!record||typeof record.title!=='string'||!record.title.trim()||!validPlannerDate(record.due))return null;
  return {contactId,noteId,title:record.title.trim().slice(0,180),followUpOn:record.due};
 }finally{db.close();}
}
export async function handlePlannerApi(req:IncomingMessage,res:ServerResponse,ctx:ApiContext) {
 const url=new URL(req.url??'/', 'http://localhost'),path=url.pathname;
 if(path!==api&&!path.startsWith(api+'/'))return false;
 const root=ctx.dataRoot??ctx.eaiosRoot;
 const baseModules=()=>moduleConfig(root);
 if(!baseModules().enabled.includes('daily-planner')){json(res,403,{error:'Daily Planner is not enabled.'});return true;}
 const store=new PlannerStore(root),method=req.method??'GET',route=path.slice(api.length);
  try{
   const origin=req.headers.origin;
   if(req.headers['sec-fetch-site']==='cross-site'||(origin&&new URL(origin).host!==req.headers.host)||(!readOnly.has(method)&&!origin))throw new PlannerError(403,'Use the same 2EP origin.');
   const on=url.searchParams.get('on')??'';
   if(route==='/session'&&method==='GET')json(res,200,{owner:ownerId});
   else if(route==='/summary'&&method==='GET')json(res,200,store.summary(ownerId,on));
   else if(route==='/day'&&method==='GET')json(res,200,store.day(ownerId,on));
   else if(route==='/agenda'&&method==='GET')json(res,200,store.ranges(ownerId,on,url.searchParams.get('view')??''));
   else if(route==='/history'&&method==='GET')json(res,200,store.history(ownerId,url.searchParams.get('id')??''));
   else if(route==='/crm'&&method==='GET'){
    const source=readCrmFollowUp(baseModules().enabled.includes('erm')?root:undefined,url.searchParams.get('contact'),url.searchParams.get('note'));
    if(!source)throw new PlannerError(404,'This E-CRM follow-up is unavailable.');
    json(res,200,source);
   }
   else if(route==='/actions'&&method==='POST'){
    if(!/^application\/json(?:;|$)/i.test(req.headers['content-type']??''))throw new PlannerError(415,'Expected JSON.');
    const raw=await bytes(req,60000);
    let action:Record<string,unknown>;
    try{action=JSON.parse(raw.toString('utf8'));if(!action||Array.isArray(action)||typeof action!=='object')throw Error();}
    catch{throw new PlannerError(400,'Invalid Planner command.');}
    if(['delegate','mock-deliver','delegate-decide'].includes(String(action.op)))throw new PlannerError(403,'The simulated preview actions are not enabled in production.');
    if(action.op==='crm'){
     const source=readCrmFollowUp(baseModules().enabled.includes('erm')?root:undefined,action.contactId,action.noteId);
     if(!source)throw new PlannerError(404,'This E-CRM follow-up is unavailable.');
     json(res,200,store.act(ownerId,{...action,title:source.title,due:source.followUpOn,detail:''},{kind:'crm-follow-up',contactId:source.contactId,noteId:source.noteId}));
    }else json(res,200,store.act(ownerId,action));
   }else if(route==='/attachments'&&method==='POST'){
    const fileId=url.searchParams.get('upload')??'',taskId=url.searchParams.get('task')??'';
    if(!uuid.test(fileId)||!taskIdPattern.test(taskId))throw new PlannerError(400,'Invalid attachment request.');
    json(res,200,store.upload(ownerId,taskId,fileId,url.searchParams.get('name')??'',await bytes(req,20*1024*1024)));
   }else if(route.startsWith('/attachments/')&&method==='GET'){
    const id=route.slice('/attachments/'.length);
    if(!uuid.test(id))throw new PlannerError(404,'File not found.');
    const file=store.file(ownerId,id);
    res.writeHead(200,{'Content-Type':'application/octet-stream','Content-Disposition':"attachment; filename*=UTF-8''"+encodeURIComponent(file.name).replace(/['()]/g,c=>'%'+c.charCodeAt(0).toString(16)),'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
    res.end(file.bytes);
   }else throw new PlannerError(404,'Planner endpoint not found.');
  }catch(e){
   if(!res.headersSent&&!res.destroyed)json(res,e instanceof PlannerError?e.status:503,{error:e instanceof PlannerError?e.message:'Planner storage is temporarily unavailable.'});
  }
  return true;
}

