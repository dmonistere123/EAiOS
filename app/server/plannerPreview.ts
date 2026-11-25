import type { IncomingMessage, ServerResponse } from 'node:http';
import { readFileSync, writeFileSync, lstatSync, mkdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { PlannerError, PlannerStore } from './plannerStore.ts';
import { emptyErmContact } from '../src/domain/erm.ts';
import { localDay } from '../src/domain/planner.ts';

const base='/api/daily-planner';
const cookie='eaios_planner_preview_v1';
const cookiePath='/api';
const lifetime=8*60*60*1000;
const digest=(s:string)=>createHash('sha256').update(s).digest();
const roles=['executive','second-user'] as const;
type Role=typeof roles[number];
const uuid=/^[0-9a-f-]{36}$/i;
function data(res:ServerResponse,status:number,value:unknown){
 res.statusCode=status;
 res.setHeader('Content-Type','application/json; charset=utf-8');
 res.setHeader('Cache-Control','no-store');
 res.setHeader('X-Content-Type-Options','nosniff');
 res.end(JSON.stringify(value));
}
async function body(req:IncomingMessage,limit:number){
 if(Number(req.headers['content-length'])>limit)throw new PlannerError(413,'Request is too large.');
 let used=0;const chunks:Buffer[]=[];
 for await(const chunk of req){const b=Buffer.from(chunk);used+=b.length;if(used>limit)throw new PlannerError(413,'Request is too large.');chunks.push(b);}
 return Buffer.concat(chunks);
}
async function json(req:IncomingMessage){
 if(!/^application\/json(?:;|$)/i.test(req.headers['content-type']??''))throw new PlannerError(415,'Expected JSON.');
 const bytes=await body(req,60000);
 try{const a:unknown=JSON.parse(bytes.toString('utf8'));if(!a||Array.isArray(a)||typeof a!=='object')throw Error();return a as Record<string,unknown>;}
 catch{throw new PlannerError(400,'Invalid JSON.');}
}
export function createPlannerPreview(root:string, origin:string){
 // This hook is installed only by the dedicated isolated Vite config, never prod.ts.
 if(!/^http:\/\/127\.0\.0\.1:\d+$/.test(origin))throw new Error('The Planner preview must bind to loopback.');
 root=resolve(root);mkdirSync(root,{recursive:true,mode:0o700});
 const access=join(root,'preview-access.json');
 try{writeFileSync(access,JSON.stringify(Object.fromEntries(roles.map(role=>[role,randomBytes(24).toString('base64url')])),null,2)+'\n',{flag:'wx',mode:0o600});}
 catch(e){if((e as NodeJS.ErrnoException).code!=='EEXIST')throw e;}
 const info=lstatSync(access);
 if(!info.isFile()||info.isSymbolicLink()||(process.platform!=='win32'&&(info.mode&0o077)!==0))throw new Error('Planner preview access file must be private.');
 const codes=JSON.parse(readFileSync(access,'utf8')) as Record<Role,string>;
 if(roles.some(role=>typeof codes[role]!=='string'||codes[role].length<32)||codes.executive===codes['second-user'])throw new Error('Invalid preview account configuration.');
 const hashed=Object.fromEntries(roles.map(role=>[role,digest(codes[role])])) as Record<Role,Buffer>;
 const store=new PlannerStore(root);
 const sessions=new Map<string,{owner:Role,until:number}>();
 const previewCrm={contactId:'preview-contact-01',noteId:'preview-note-01',title:'Follow up with Sample CRM Contact'};
 const createdAt='2026-01-02T15:00:00Z';
 const contact={...emptyErmContact(),id:previewCrm.contactId,name:'Sample CRM Contact',company:'Sample Company',version:1,source:'manual',archived:false,createdAt,updatedAt:createdAt};
 const getNote=()=>({id:previewCrm.noteId,contactId:contact.id,version:1,createdAt,updatedAt:createdAt,title:previewCrm.title,body:'Synthetic CRM note. The source stays in E-CRM.',includeInAI:false,followUpOn:localDay()});
 const page=<T>(items:T[])=>({items,total:items.length,hasMore:false,nextCursor:null});
 return async (req:IncomingMessage,res:ServerResponse,next:()=>void)=>{
  let url:URL;
  try{url=new URL(req.url??'/',origin);}catch{data(res,400,{error:'Invalid request.'});return;}
  const path=url.pathname;
  const erm=path.startsWith('/api/erm/');
  if(!erm&&path!==base&&!path.startsWith(base+'/'))return next();
  const route=path.slice(base.length),method=req.method??'GET';
  try{
   if(req.headers.host!==new URL(origin).host||!['127.0.0.1','::ffff:127.0.0.1','::1'].includes(req.socket.remoteAddress??''))throw new PlannerError(403,'Planner preview is available only on this machine.');
   if(method!=='GET'&&req.headers.origin!==origin)throw new PlannerError(403,'This request did not originate in the Planner preview.');
   const token=(req.headers.cookie??'').split(';').map(v=>v.trim()).find(v=>v.startsWith(cookie+'='))?.slice(cookie.length+1)??'';
   const authenticated=sessions.get(token),owner=authenticated&&authenticated.until>Date.now()?authenticated.owner:null;
   if(authenticated&&!owner)sessions.delete(token);
   if(route==='/session'&&method==='GET')return data(res,200,{owner});
   if(route==='/session'&&method==='POST'){
    const a=await json(req),rh=typeof a.passcode==='string'&&a.passcode.length<=128?digest(a.passcode):digest('');
    const who=roles.find(r=>timingSafeEqual(hashed[r],rh));
    if(!who)throw new PlannerError(401,'The preview access code did not match.');
    if(token)sessions.delete(token);
    for(const [k,v] of sessions)if(v.until<=Date.now())sessions.delete(k);
    if(sessions.size>=1000)throw new PlannerError(503,'Too many active preview sessions.');
    const key=randomBytes(32).toString('base64url');
    sessions.set(key,{owner:who,until:Date.now()+lifetime});
    res.setHeader('Set-Cookie',cookie+'='+key+'; Path='+cookiePath+'; HttpOnly; SameSite=Strict; Max-Age='+lifetime/1000);
    return data(res,200,{owner:who});
   }
   if(route==='/session'&&method==='DELETE'){sessions.delete(token);res.setHeader('Set-Cookie',cookie+'=; Path='+cookiePath+'; HttpOnly; SameSite=Strict; Max-Age=0');return data(res,200,{owner:null});}
   if(!owner)throw new PlannerError(401,'Sign in to the private Planner preview.');
   if(erm){
    if(method!=='GET')throw new PlannerError(403,'The Planner preview does not change E-CRM.');
    if(path==='/api/erm/status')return data(res,200,{model:{available:false,reason:'No provider in this preview.'},scope:'single-executive',evidence:'notes',outlook:'on-demand'});
    if(path==='/api/erm/contacts')return data(res,200,page(owner==='executive'&&url.searchParams.get('archived')!=='true'&&contact.name.toLowerCase().includes((url.searchParams.get('q')??'').toLowerCase())?[contact]:[]));
    if(path==='/api/erm/follow-ups'){const note=getNote(),items=owner==='executive'?[{contactId:contact.id,contactName:contact.name,noteId:note.id,noteTitle:note.title,followUpOn:note.followUpOn}]:[];return data(res,200,{items,total:items.length,hasMore:false});}
    if(owner==='executive'){
     const prefix='/api/erm/contacts/'+contact.id,note=getNote();
     if(path===prefix)return data(res,200,contact);
     if(path===prefix+'/notes')return data(res,200,page([note]));
     if(path===prefix+'/review')return data(res,200,null);
     if(path===prefix+'/notes/'+note.id)return data(res,200,note);
     if(path===prefix+'/notes/'+note.id+'/attachments')return data(res,200,[]);
    }
    throw new PlannerError(404,'Source not found.');
   }
   const on=url.searchParams.get('on')??'';
   if(route==='/summary'&&method==='GET')return data(res,200,store.summary(owner,on));
   if(route==='/day'&&method==='GET')return data(res,200,store.day(owner,on));
   if(route==='/agenda'&&method==='GET')return data(res,200,store.ranges(owner,on,url.searchParams.get('view')??''));
   if(route==='/history'&&method==='GET')return data(res,200,store.history(owner,url.searchParams.get('id')??''));
   if(route==='/crm'&&method==='GET')return data(res,200,owner==='executive'?previewCrm:null);
   if(route==='/actions'&&method==='POST'){
    const a=await json(req);
    if(a.op==='crm'){
     if(owner!=='executive'||a.contactId!==previewCrm.contactId||a.noteId!==previewCrm.noteId)throw new PlannerError(404,'Source not found.');
     return data(res,200,store.act(owner,{...a,title:previewCrm.title,detail:''},{kind:'crm-follow-up',contactId:previewCrm.contactId,noteId:previewCrm.noteId}));
    }
    return data(res,200,store.act(owner,a));
   }
   if(route==='/attachments'&&method==='POST'){
    const fileId=url.searchParams.get('upload')??'',taskId=url.searchParams.get('task')??'';
    if(!uuid.test(fileId)||!uuid.test(taskId))throw new PlannerError(400,'Invalid attachment request.');
    return data(res,200,store.upload(owner,taskId,fileId,url.searchParams.get('name')??'',await body(req,20*1024*1024)));
   }
   if(route.startsWith('/attachments/')&&method==='GET'){
    const fileId=route.slice('/attachments/'.length);
    if(!uuid.test(fileId))throw new PlannerError(404,'File not found.');
    const file=store.file(owner,fileId);
    res.setHeader('Content-Type','application/octet-stream');
    res.setHeader('Content-Disposition',"attachment; filename*=UTF-8''"+encodeURIComponent(file.name).replace(/['()]/g,c=>'%'+c.charCodeAt(0).toString(16)));
    res.setHeader('Cache-Control','no-store');
    res.setHeader('X-Content-Type-Options','nosniff');
    res.end(file.bytes);return;
   }
   throw new PlannerError(404,'Planner endpoint not found.');
  }catch(e){if(!res.headersSent&&!res.destroyed)data(res,e instanceof PlannerError?e.status:503,{error:e instanceof PlannerError?e.message:'Planner storage is temporarily unavailable.'});}
 };
}
