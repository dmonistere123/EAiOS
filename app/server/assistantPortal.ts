import type { IncomingMessage,ServerResponse } from 'node:http';
import { humanStore,HumanDelegationError } from './humanDelegation.ts';
import { authorizedAssistantTask,assistantTaskView,updateChecklist,requestHumanCompletion } from './humanCompletion.ts';
import { requireSameOriginJson } from './updates.ts';
export async function readSmallJson(req:IncomingMessage,limit=64000):Promise<Record<string,unknown>> {
  let size=0,text='';for await(const chunk of req){size+=Buffer.byteLength(chunk);if(size>limit)throw new HumanDelegationError(413,'Request is too large.');text+=chunk;}
  const value=JSON.parse(text||'{}');if(!value||typeof value!=='object'||Array.isArray(value))throw new HumanDelegationError(400,'Invalid request.');return value;
}
export function sendJson(res:ServerResponse,status:number,data:unknown) {res.statusCode=status;res.setHeader('content-type','application/json');res.setHeader('cache-control','no-store');res.end(JSON.stringify(data));}
/** Mounted only on a separate origin with no executive routes or proxy fallback. */
export async function handleAssistantPortal(req:IncomingMessage,res:ServerResponse,home:string) {
  const path=new URL(req.url??'/','http://localhost').pathname;
  res.setHeader('cache-control','no-store');res.setHeader('referrer-policy','no-referrer');res.setHeader('x-content-type-options','nosniff');
  if(!['/api/assistant-task','/api/assistant-task/checklist','/api/assistant-task/completion','/api/assistant-task/itinerary'].includes(path)){sendJson(res,404,{error:'Not available in the assistant workspace.'});return;}
  try {
    const task=authorizedAssistantTask(home,String(req.headers.authorization??'').replace(/^Bearer /,''));
    if(req.method==='GET'&&path==='/api/assistant-task'){sendJson(res,200,assistantTaskView(task));return;}
    if(req.method==='GET'&&path.endsWith('/itinerary')) {
      const artifact=task.package?.artifacts.find(a=>/^itinerary-.*\.txt$/.test(a.filename));
      if(!artifact)throw new HumanDelegationError(404,'The reviewed itinerary attachment is not yet available.');
      const file=humanStore(home,db=>db.prepare('SELECT data FROM human_mail_files WHERE delegation_id=? AND artifact_id=?').get(task.id,artifact.artifactId) as {data:Uint8Array}|undefined);
      if(!file)throw new HumanDelegationError(404,'The reviewed itinerary attachment is not yet available.');
      res.setHeader('content-type','text/plain; charset=utf-8');res.setHeader('content-disposition','attachment; filename="itinerary.txt"');res.end(Buffer.from(file.data));return;
    }
    if(req.method!=='POST'||!['/api/assistant-task/checklist','/api/assistant-task/completion'].includes(path))throw new HumanDelegationError(405,'Action not available.');
    requireSameOriginJson(req);const input=await readSmallJson(req);
    // Assignment identity comes from the credential, never a client-provided task/contact id.
    const next=path.endsWith('/checklist')?updateChecklist(home,task.id,input,'human_assistant'):requestHumanCompletion(home,task.id,input,'human_assistant');
    sendJson(res,200,assistantTaskView(next));
  }catch(e){sendJson(res,e instanceof HumanDelegationError?e.status:400,{error:e instanceof HumanDelegationError?e.message:'Could not complete this request.'});}
}
