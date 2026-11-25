import type { IncomingMessage, ServerResponse } from 'node:http';
import type { ApiContext } from './httpApi.ts';
import { ErmStore } from './ermStore.ts';
import { ermAttachmentRoute } from './ermAttachments.ts';
import { queueErmQuickEmail } from './ermQuickEmail.ts';
import { ErmError, ermText } from '../src/domain/erm.ts';
import { csvContacts, parseCsv, suggestCsvMapping } from './ermImport.ts';
import { ermAccounts, readOutlookContacts } from './ermProvider.ts';
import { drainErm, ermModel } from './ermAnalysis.ts';
import { moduleConfig } from './modules.ts';

async function readBody(req:IncomingMessage):Promise<Record<string,unknown>> {
  if(!/^application\/json(?:;|$)/i.test(req.headers['content-type']??''))throw new ErmError(415,'json_required','JSON is required.');
  let size=0;const chunks:Buffer[]=[];
  for await(const chunk of req){size+=chunk.length;if(size>1500000)throw new ErmError(413,'too_large','Request exceeds the import size limit.');chunks.push(Buffer.from(chunk));}
  try{const v=JSON.parse(Buffer.concat(chunks).toString('utf8'));if(!v||typeof v!=='object'||Array.isArray(v))throw Error();return v;}catch{throw new ErmError(400,'invalid_json','Invalid request body.');}
}
export async function handleErmApi(req:IncomingMessage,res:ServerResponse,ctx:ApiContext,isolated=false):Promise<boolean> {
  const url=new URL(req.url??'','http://localhost'),path=url.pathname;
  if(!path.startsWith('/api/erm/'))return false;
  res.setHeader('Cache-Control','no-store');res.setHeader('Content-Type','application/json');
  const send=(status:number,value:unknown)=>{res.statusCode=status;res.end(JSON.stringify(value));};
  try{
    if(req.headers['sec-fetch-site']&&!['same-origin','none'].includes(req.headers['sec-fetch-site'] as string))throw new ErmError(403,'origin','Use E-CRM from this application.');
    if(req.headers.origin&&new URL(req.headers.origin).host!==req.headers.host)throw new ErmError(403,'origin','Use E-CRM from this application.');
    const root=ctx.dataRoot??ctx.eaiosRoot;
    if(!moduleConfig(root).enabled.includes('erm'))throw new ErmError(404,'disabled','E-CRM is not enabled on this installation.');
    const store=new ErmStore(root),method=req.method??'GET';
    if(!['GET','POST','PATCH'].includes(method))throw new ErmError(405,'method','Method not supported.');
    const attachment=path.match(/^\/api\/erm\/contacts\/([\w-]+)\/notes\/([\w-]+)\/attachments(?:\/([\w-]+))?$/);
    if(attachment){const [,contact,note,id]=attachment;await ermAttachmentRoute(req,res,store,url,contact,note,id);return true;}
    if(path==='/api/erm/follow-ups'&&method==='GET'){send(200,store.followUps(url.searchParams.get('through')??''));return true;}
    const b=method==='GET'?{}:await readBody(req),key=String(b.requestId??'');
    const version=()=>{if(!Number.isSafeInteger(b.version)||Number(b.version)<1)throw new ErmError(400,'version','A record version is required.');return Number(b.version);};
    const quickEmail=path.match(/^\/api\/erm\/contacts\/([\w-]+)\/notes\/([\w-]+)\/quick-email$/);
    if(quickEmail&&method==='POST'){
      if(isolated)throw new ErmError(503,'isolated','Outlook sending is disconnected in this preview.');
      if(!req.headers.origin||new URL(req.headers.origin).host!==req.headers.host)throw new ErmError(403,'origin','Use E-CRM from this application.');
      send(201,await queueErmQuickEmail(ctx,quickEmail[1],quickEmail[2],b,store));return true;
    }
    const match=path.match(/^\/api\/erm\/contacts\/([\w-]+)(?:\/(notes|review|analyze|archive)(?:\/([\w-]+))?)?$/);
    if(path==='/api/erm/status'&&method==='GET'){
      let model;try{model={available:true,name:ermModel(ctx.eaiosRoot,ctx.hermesHome,isolated).model};}catch(e){model={available:false,reason:(e as Error).message};}
      send(200,{model,scope:'single-executive',evidence:'notes',outlook:'on-demand',preview:isolated});return true;
    }
    if(path==='/api/erm/contacts'){
      if(method==='GET')send(200,store.listContacts(url.searchParams.get('q')??'',url.searchParams.get('cursor'),url.searchParams.get('archived')==='true'));
      else if(method==='POST')send(201,store.createContact(b.contact,key));else throw new ErmError(405,'method','Method not supported.');return true;
    }
    if(match){const [,id,action,noteId]=match;
      if(!action&&method==='GET')send(200,store.contact(id));
      else if(!action&&method==='PATCH')send(200,store.updateContact(id,b.contact,version()));
      else if(action==='archive'&&method==='POST'){if(typeof b.archived!=='boolean')throw new ErmError(400,'archive','Choose archive or restore.');send(200,store.archiveContact(id,version(),b.archived));}
      else if(action==='notes'&&method==='GET')send(200,noteId?store.note(id,noteId):store.notes(id,url.searchParams.get('cursor')));
      else if(action==='notes'&&method==='POST'&&!noteId)send(201,store.saveNote(id,b.note,key));
      else if(action==='notes'&&method==='PATCH'&&noteId)send(200,store.updateNote(id,noteId,b.note,version()));
      else if(action==='review'&&method==='GET')send(200,store.latestReview(id));
      else if(action==='analyze'&&method==='POST'){
        const question=ermText(b.question??'','question',3000),config=ermModel(ctx.eaiosRoot,ctx.hermesHome,isolated);
        const job=store.enqueue(id,question?'question':'review',question,key,config.revision);send(202,job);drainErm(store,ctx.eaiosRoot,ctx.hermesHome,isolated);
      }else throw new ErmError(405,'method','Method not supported.');return true;
    }
    if(/^\/api\/erm\/jobs\/[\w-]+$/.test(path)&&method==='GET'){send(200,store.job(path.split('/').pop()!));drainErm(store,ctx.eaiosRoot,ctx.hermesHome,isolated);return true;}
    if(path==='/api/erm/import/csv'&&method==='POST'){
      const text=ermText(b.text,'CSV',1100000,true);
      if(b.inspect===true){const parsed=parseCsv(text);send(200,{headers:parsed.headers,mapping:suggestCsvMapping(parsed.headers)});}
      else {const parsed=csvContacts(text,b.mapping as Parameters<typeof csvContacts>[1]);send(200,store.preview('csv',parsed.items));}return true;
    }
    if(path==='/api/erm/import/accounts'&&method==='GET'){if(isolated)throw new ErmError(503,'isolated','Outlook is not connected in this isolated preview. Use manual entry or CSV.');send(200,await ermAccounts(ctx));return true;}
    if(path==='/api/erm/import/outlook'&&method==='POST'){
      if(isolated)throw new ErmError(503,'isolated','Outlook is not connected in this isolated preview.');
      const page=await readOutlookContacts(ctx,ermText(b.connectionId,'account',250,true),b.cursor===undefined?undefined:ermText(b.cursor,'cursor',12000));send(200,store.preview('outlook',page.items,page.account,page.nextCursor));return true;
    }
    if(path==='/api/erm/import/commit'&&method==='POST'){send(200,store.importContacts(ermText(b.previewId,'preview',100,true),b.selected as string[],key));return true;}
    throw new ErmError(404,'not_found','E-CRM endpoint not found.');
  }catch(e){if(e instanceof ErmError)send(e.status,{error:e.message,code:e.code});else send(500,{error:'E-CRM could not complete this request. Your previous saved records are unchanged.'});}
  return true;
}
