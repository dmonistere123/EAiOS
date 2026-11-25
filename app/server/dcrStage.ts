/** Loopback-only DCR staging. An allowlist, never a proxy to the production API. */
import {createServer} from 'node:http';
import {readFileSync,existsSync,mkdirSync,writeFileSync} from 'node:fs';
import {join,extname} from 'node:path';
import {randomBytes,randomUUID} from 'node:crypto';
import {DcrStore,DcrError,insist} from './dcrStore.ts';
import {runDcrConversation} from './dcrConversation.ts';
import {decideReplyApproval} from './mailReplies.ts';
import type {BoundReply,ReplyProvider} from './mailReplies.ts';
import type {Approval} from '../src/domain/types.ts';
import type {DcrRecord} from '../src/domain/dcr.ts';
import {stageDcrConnections} from './dcrConnectionFixtures.ts';
const identity={connectionId:'dcr-fixture-outlook',provider:'outlook' as const,email:'executive@example.test',providerUserId:'dcr-fixture-executive',verifiedAt:'2026-11-12T00:00:00Z'};
function fixtureReply(body:string):BoundReply{return {identity,reference:{sourceMessageId:'dcr-fixture-message'},sourceSubject:'Northstar pilot follow-up · fictional staging thread',sourceAuthor:'maya@example.test',package:{recipient:{displayName:'Maya Chen (fictional)',email:'maya@example.test'},sender:{provider:'outlook',accountId:identity.connectionId,email:identity.email},subject:'Re: Northstar pilot follow-up · fictional staging thread',body,artifacts:[],packageHash:''}};}
export function dcrApprovals(store:DcrStore):Approval[]{return store.db.prepare('SELECT id,body,status FROM tasks').all().map(row=>{
 const env=JSON.parse(String(row.body));return {id:String(row.id),workItemId:String(row.id),requestedByAgentId:'staging-executive',status:env.decision??'pending',actionType:'send',targetSystem:'Outlook · staging capture',targetObject:env.title,submittedAt:env.submittedAt,risk:'low',evidence:[],payload:env.payload,reviewVersion:String(row.body),mailReply:{senderEmail:identity.email,recipientEmail:'maya@example.test',body:env.mailReply.package.body},dcrStaging:true,sourceContext:{authorName:'Maya Chen (fictional)',subject:env.mailReply.sourceSubject,excerpt:'Fixture message for reviewing the approval flow. No real mailbox was read.'}} as Approval;
 });}
export function prepareDcrApproval(store:DcrStore,record:DcrRecord,revision:unknown,body:unknown){return store.transaction(()=>{
 insist(record.revision===revision,'Record changed. Reload before preparing the follow-up.',409);
 insist(typeof body==='string'&&body.trim()&&body.length<=10000,'Write the exact follow-up to review (up to 10,000 characters).');
 insist(record.sourceIds.every(id=>store.source(id)),'Source unavailable.',409);
 const pending=store.db.prepare('SELECT id,body FROM tasks').all().find(t=>{const env=JSON.parse(String(t.body));return env.dcrRecordId===record.id&&!env.decision;});insist(!pending,'This item already has a pending approval. Review it in Approvals.',409);
 const bound=fixtureReply(body.trim()),id=randomUUID();const env={eaios:'approval',title:`DCR follow-up · ${record.title}`,actionType:'send',targetSystem:'outlook',requestedBy:'staging-executive',risk:'low',submittedAt:new Date().toISOString(),dcrRecordId:record.id,dcrRevision:record.revision,dcrWork:store.workLinks().filter(l=>l.recordId===record.id).map(l=>({kind:l.kind,id:l.id,version:l.work?.version??null})),mailReply:bound,dcrStaging:true,payload:`From: ${bound.package.sender.email}\nTo: ${bound.package.recipient.email}\nSubject: ${bound.package.subject}\n\n${bound.package.body}`};
 store.db.prepare("INSERT INTO tasks(id,body,status,assignee) VALUES(?,?,'blocked',NULL)").run(id,JSON.stringify(env));store.audit(record.id,'approval_prepared',`Staging capture approval ${id}; no email sent.`);return {id};
 });}
export function startDcrStage(root:string,dist:string,port=5277,key='',assistantName='AI chief of staff'){
 const connections=stageDcrConnections(root);
 const store=new DcrStore(root,connections);store.seed();const cookie=randomBytes(32).toString('hex');
 const ctx={hermesHome:root,eaiosRoot:root,dataRoot:root};
 const capture:ReplyProvider={verify:async(_ctx,id)=>{insist(id===identity.connectionId,'Fixture mailbox mismatch.',409);return identity;},source:async(_ctx,connectionId,messageId)=>{insist(connectionId===identity.connectionId&&messageId==='dcr-fixture-message','Fixture source mismatch.',409);return fixtureReply('');},send:async(_ctx,pkg)=>{const id=randomUUID();mkdirSync(join(root,'outbox'),{recursive:true,mode:0o700});writeFileSync(join(root,'outbox',id+'.json'),JSON.stringify({id,provider:'staging-capture',at:new Date().toISOString(),package:pkg},null,2),{mode:0o600});return {id,provider:'staging-capture'};}};
 const server=createServer(async(req,res)=>{
  const json=(status:number,value:unknown)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(value));};
  try{
   const host=req.headers.host;insist(host===`127.0.0.1:${server.address()&&typeof server.address()==='object'?(server.address() as {port:number}).port:port}`||host===`localhost:${port}`,'Invalid staging host.',403);
   const path=new URL(req.url??'/','http://'+host).pathname;
   const cookieName=`dcr_stage_${(server.address() as {port:number}).port}`;
   if(path.startsWith('/api/')){
    insist(req.headers.cookie?.split(';').some(x=>x.trim()===`${cookieName}=${cookie}`),'Open the staging page first.',401);
    const site=req.headers['sec-fetch-site'];insist(!site||site==='same-origin'||site==='none','Cross-origin requests are not allowed.',403);
    if(req.headers.origin)insist(req.headers.origin===`http://${host}`,'Cross-origin requests are not allowed.',403);
    let input:Record<string,any>={};
    if(req.method!=='GET'){
     insist(req.method==='POST','Method not allowed.',405);insist(req.headers['content-type']?.split(';')[0]==='application/json','JSON required.',415);
     let raw='';for await(const chunk of req){raw+=chunk;insist(raw.length<=100000,'Request too large.',413);}try{input=JSON.parse(raw);}catch{throw new DcrError(400,'Invalid JSON.');}insist(input&&typeof input==='object'&&!Array.isArray(input),'Invalid request.');
    }
    if(req.method==='GET'&&path==='/api/identity')return json(200,{assistantName,executiveName:'Staging executive'});
    if(req.method==='GET'&&path==='/api/modules')return json(200,{enabled:['dcr','approvals']});
    if(req.method==='GET'&&path==='/api/dcr')return json(200,{staging:true,workLinks:store.workLinks(),followUps:store.db.prepare('SELECT id,body FROM tasks').all().map(row=>{const env=JSON.parse(String(row.body));return {id:row.id,recordId:env.dcrRecordId,status:env.mailDelivery?.status==='sent'?'captured':env.mailDelivery?.status??env.decision??'pending',receiptId:env.mailDelivery?.receipt?.id};}),records:store.records(),sources:store.availableSources(),requests:store.visibleRequests(),history:store.history(),assistantName,aiAvailable:!!key});
    if(req.method==='GET'&&path==='/api/dcr/connections')return json(200,connections.catalog());
    if(req.method==='POST'&&path==='/api/dcr/artifacts/preview'){
     try{return json(200,connections.artifact(input.id));}catch{return json(409,{error:'Artifact unavailable or unsupported. Choose a current text Artifact up to 20,000 characters.'});}
    }
    if(req.method==='POST'&&path==='/api/dcr/artifacts/select')return json(200,store.addArtifact(input.id,input.version));
    if(req.method==='POST'&&path==='/api/dcr/work-links')return json(200,store.linkWork(input.recordId,input.revision,input.kind,input.id,input.version,input.remove===true));
    if(req.method==='GET'&&path==='/api/dcr/approvals')return json(200,dcrApprovals(store));
    if(req.method==='POST'&&path==='/api/dcr/records')return json(200,store.transaction(()=>store.save(input.fields,input.id,input.revision,input.sourceIds??[],input.linkedIds??[])));
    if(req.method==='POST'&&path==='/api/dcr/commitments/from-decision')return json(200,store.commitmentFromDecision(input.decisionId,input.revision,input.fields));
    if(req.method==='POST'&&path==='/api/dcr/sources')return json(200,store.addSource(input.title,input.text));
    if(req.method==='POST'&&path==='/api/dcr/sources/remove'){store.revokeSource(input.id);return json(200,{ok:true});}
    if(req.method==='POST'&&path==='/api/dcr/ask'){
     insist(!!key,'AI is not configured. Records remain available.',503);insist(store.requests().filter(r=>r.state==='running').length<2,'Two answers are already in progress. Please wait.',429);
     const request=store.begin(input.prompt,input.recordId??null,input.sourceIds??[],input.propose===true);json(request.state==='running'?202:200,request);if(request.state==='running')void runDcrConversation(store,request.id,key,fetch,assistantName);return;
    }
    if(req.method==='POST'&&path==='/api/dcr/accept'){insist(Array.isArray(input.edits),'Review the proposal.');return json(200,store.accept(input.id,input.edits,input.link===true));}
    if(req.method==='POST'&&path==='/api/dcr/dismiss'){const r=store.request(input.id);insist(r.state!=='running','Wait for the answer.');store.setRequest({...r,accepted:true});return json(200,{ok:true});}
    if(req.method==='POST'&&path==='/api/dcr/prepare')return json(200,prepareDcrApproval(store,store.record(input.recordId),input.revision,input.body));
    if(req.method==='POST'&&path==='/api/dcr/decide'){
     insist(['approved','rejected','changes_requested'].includes(input.decision),'Choose an approval decision.');
     const task=store.db.prepare('SELECT * FROM tasks WHERE id=?').get(input.id);insist(task,'Approval not found.',404);const env=JSON.parse(String(task.body));
     insist(task.body===input.reviewVersion&&!env.decision&&!task.assignee&&!task.claim_lock&&!task.current_run_id&&task.status==='blocked','Approval changed or already decided.',409);
     const record=store.record(env.dcrRecordId);if(input.decision==='approved'){insist(record.revision===env.dcrRevision,'The DCR record changed. Reject this draft and prepare a fresh approval.',409);record.sourceIds.forEach(id=>store.source(id));const work=store.workLinks().filter(l=>l.recordId===record.id).map(l=>({kind:l.kind,id:l.id,version:l.work?.version??null}));insist(JSON.stringify(work)===JSON.stringify(env.dcrWork??[]),'Linked work changed. Reject this draft and prepare a fresh approval.',409);}
     if(input.decision==='approved'){const result=await decideReplyApproval(ctx,input.id,{decision:'approved',expectedBody:input.reviewVersion},capture);store.audit(record.id,'approval_decided','Approved staging capture '+input.id);return json(200,result);}
     store.transaction(()=>{store.db.prepare("UPDATE tasks SET body=?,status='blocked' WHERE id=?").run(JSON.stringify({...env,decision:input.decision,decidedAt:new Date().toISOString()}),input.id);store.audit(record.id,'approval_decided',input.decision+' '+input.id);});return json(200,{ok:true,auditEventId:input.id});
    }
    return json(404,{error:'This API is not available in isolated DCR staging.'});
   }
   insist(req.method==='GET'||req.method==='HEAD','Method not allowed.',405);
   let file:string;if(['/','/dcr','/approvals'].includes(path)){file=join(dist,'index.html');res.setHeader('Set-Cookie',`${cookieName}=${cookie}; HttpOnly; SameSite=Strict; Path=/`);}
   else if(/^\/assets\/[a-zA-Z0-9_.-]+$/.test(path))file=join(dist,path);else if(path==='/favicon.svg')file=join(dist,'favicon.svg');else return json(404,{error:'This page is not available in DCR staging.'});
   insist(existsSync(file),'Build DCR staging before starting it.',404);const mime:Record<string,string>={'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.woff2':'font/woff2'};
   res.writeHead(200,{'Content-Type':mime[extname(file)]??'application/octet-stream','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'same-origin'});res.end(req.method==='HEAD'?undefined:readFileSync(file));
  }catch(e){json(e instanceof DcrError?e.status:500,{error:e instanceof DcrError?e.message:'Staging request failed. No production services were contacted.'});}
 });
 server.listen(port,'127.0.0.1');return {server,store};
}
