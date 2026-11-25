import {saveRelationshipContact} from './dcrCrm.ts';
import {scannerConfig,runScanner,confirmScannedFinding} from './dcrScanner.ts';
import {DcrScannerStore} from './dcrScannerStore.ts';
/** Single-executive DCR pilot within the existing private executive application.
 * Never mounted by the assignment-only HI listener. No fixture data or mail transport. */
import type {IncomingMessage,ServerResponse} from 'node:http';
import {readFileSync,mkdirSync,lstatSync,chmodSync} from 'node:fs';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {randomUUID} from 'node:crypto';
import {DcrStore,DcrError,insist} from './dcrStore.ts';
import {DcrConnectionsReader} from './dcrConnections.ts';
import {runDcrConversation} from './dcrConversation.ts';
import {appKey,savedKey,type KeyContext} from './apiKeys.ts';
import {boxIdentity} from './identity.ts';
import {requireSameOriginJson} from './updates.ts';

export function dcrPolicy(dataRoot:string){
  try{
    const raw=readFileSync(join(dataRoot,'dcr.local.json'),'utf8');if(raw.length>4000)return null;
    const value=JSON.parse(raw);
    if(value.enabled!==true||value.principal!=='executive'||!Array.isArray(value.origins)||!value.origins.length||value.origins.some((s:unknown)=>typeof s!=='string'||new URL(s).origin!==s))return null;
    return {origins:value.origins as string[],allowAi:value.allowAi===true};
  }catch{return null;}
}
function dcrAiKey(ctx:KeyContext){try{return appKey('OPENROUTER_API_KEY',ctx)||savedKey(ctx,'hermes','OPENROUTER_API_KEY');}catch{return '';}}
const stores=new Map<string,DcrStore>();
export function productionDcrStore(ctx:KeyContext){
  const root=join(ctx.hermesHome,'eaios','dcr');
  let store=stores.get(root);if(store)return store;
  mkdirSync(root,{recursive:true,mode:0o700});
  insist(!lstatSync(root).isSymbolicLink(),'DCR storage must be a private directory.',503);
  const file=join(root,'kanban.db');try{insist(!lstatSync(file).isSymbolicLink(),'DCR storage is unavailable.',503);}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}
  store=new DcrStore(root,new DcrConnectionsReader({kanban:join(ctx.hermesHome,'kanban.db'),attachments:join(ctx.hermesHome,'kanban','attachments'),human:join(ctx.hermesHome,'eaios','human-delegation.db')},'Your saved Artifacts and existing work'),{production:true});
  chmodSync(root,0o700);chmodSync(file,0o600);stores.set(root,store);return store;
}
export function closeProductionDcrStores(){for(const store of stores.values())store.db.close();stores.clear();}
function workVersions(store:DcrStore,id:string){return store.workLinks().filter(l=>l.recordId===id).map(l=>({kind:l.kind,id:l.id,version:l.work?.version??null}));}
export function checkDcrApproval(ctx:KeyContext,env:Record<string,any>){
  if(!env.dcrRecordId||env.dcrStaging)return;
  insist(dcrPolicy(ctx.dataRoot??ctx.eaiosRoot),'DCR is disabled. Reject this draft or enable DCR before reviewing it.',409);
  const store=productionDcrStore(ctx),record=store.record(env.dcrRecordId);
  insist(record.revision===env.dcrRevision,'This DCR record changed. Reject the draft and prepare a fresh follow-up.',409);
  record.sourceIds.forEach(id=>store.source(id));
  insist(JSON.stringify(workVersions(store,record.id))===JSON.stringify(env.dcrWork??[]),'Linked work changed. Reject the draft and prepare a fresh follow-up.',409);
}
function approvals(ctx:KeyContext){
  const db=new DatabaseSync(join(ctx.hermesHome,'kanban.db'),{readOnly:true});
  try{return db.prepare("SELECT id,body FROM tasks WHERE json_valid(body) AND json_extract(body,'$.dcrRecordId') IS NOT NULL").all().map(row=>({id:String(row.id),env:JSON.parse(String(row.body))}));}finally{db.close();}
}
export function prepareProductionDcrApproval(ctx:KeyContext,store:DcrStore,input:Record<string,any>){
  const record=store.record(input.recordId);
  insist(input.revision===record.revision,'Record changed. Reload before preparing this follow-up.',409);
  insist(typeof input.body==='string'&&input.body.trim()&&input.body.length<=10000,'Write the exact follow-up to review (up to 10,000 characters).');
  record.sourceIds.forEach(id=>store.source(id));
  const db=new DatabaseSync(join(ctx.hermesHome,'kanban.db'));
  try{
    db.exec('PRAGMA busy_timeout=5000; BEGIN IMMEDIATE');
    const existing=db.prepare("SELECT id,body FROM tasks WHERE json_valid(body) AND json_extract(body,'$.dcrRecordId')=? AND json_extract(body,'$.decision') IS NULL").get(record.id);
    if(existing){db.exec('COMMIT');return {id:String(existing.id)};}
    const id='t_'+randomUUID().replaceAll('-',''),now=new Date().toISOString();
    const env={eaios:'approval',title:`DCR follow-up · ${record.title}`,actionType:'send',targetSystem:'outlook',requestedBy:'executive',risk:'low',submittedAt:now,dcrRecordId:record.id,dcrRevision:record.revision,dcrWork:workVersions(store,record.id),payload:input.body.trim()};
    checkDcrApproval(ctx,env);
    db.prepare("INSERT INTO tasks(id,title,body,status,assignee,created_by,created_at) VALUES(?,?,?,'blocked',NULL,'eaios-executive',?)").run(id,env.title,JSON.stringify(env),Math.floor(Date.now()/1000));
    db.prepare('INSERT INTO task_events(task_id,kind,payload,created_at) VALUES(?,?,?,?)').run(id,'dcr_follow_up_prepared',JSON.stringify({recordId:record.id,revision:record.revision}),Math.floor(Date.now()/1000));
    db.exec('COMMIT');return {id};
  }catch(e){if(db.isTransaction)db.exec('ROLLBACK');throw e;}finally{db.close();}
}
export async function handleDcrProduction(req:IncomingMessage,res:ServerResponse,ctx:KeyContext):Promise<boolean>{
  const path=new URL(req.url??'/','http://localhost').pathname;if(path!=='/api/dcr'&&!path.startsWith('/api/dcr/'))return false;
  const json=(status:number,value:unknown)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(value));};
  try{
    const policy=dcrPolicy(ctx.dataRoot??ctx.eaiosRoot);insist(policy,'DCR is not enabled on this box.',403);
    insist(policy.origins.some(origin=>new URL(origin).host===req.headers.host),'DCR is available only through the configured executive application.',403);
    insist(!req.headers.origin||policy.origins.includes(String(req.headers.origin)),'A same-origin request is required.',403);
    insist(!req.headers['sec-fetch-site']||['same-origin','none'].includes(String(req.headers['sec-fetch-site'])),'A same-origin request is required.',403);
    let input:Record<string,any>={};
    if(req.method!=='GET'){
      insist(req.method==='POST','Method not supported.',405);
      try{requireSameOriginJson(req);}catch{throw new DcrError(403,'A same-origin JSON request is required.');}
      let raw='';for await(const chunk of req){raw+=chunk;insist(Buffer.byteLength(raw)<=100000,'Request too large.',413);}
      try{input=JSON.parse(raw);}catch{throw new DcrError(400,'Invalid JSON.');}
      insist(input&&typeof input==='object'&&!Array.isArray(input),'Invalid request.');
    }
    const store=productionDcrStore(ctx),connections=store.connections!;
    // Both executive listeners share this database. Only expired model requests
    // are interrupted; opening the other listener cannot cancel active work.
    for(const r of store.requests())if(r.state==='running'&&Date.now()-Date.parse(r.createdAt)>120000)store.fail(r.id,'This answer was interrupted. Ask again to retry.');
    const assistantName=boxIdentity(ctx).assistantName;
    if(req.method==='GET'&&path==='/api/dcr'){
      const scanner=new DcrScannerStore(store).status(scannerConfig(ctx)),records=store.records(),requests=store.visibleRequests();
      const referenced=new Set([...records.flatMap(r=>r.sourceIds),...requests.flatMap(r=>r.sourceIds),...scanner.findings.flatMap(f=>f.sourceIds),...(scanner.relationshipEvidence??[]).flatMap(e=>e.sourceIds)]);
      // The background queue is private server state, not a mailbox dump in every UI refresh.
      const sources=store.availableSources().filter(s=>!s.origin||referenced.has(s.id));
      return json(200,{scanner,staging:false,records,sources,requests,history:store.history(),workLinks:store.workLinks(),followUps:approvals(ctx).map(({id,env})=>({id,recordId:env.dcrRecordId,status:env.mailDelivery?.status??env.decision??'pending',receiptId:env.mailDelivery?.receipt?.id})),assistantName,aiAvailable:policy.allowAi&&!!dcrAiKey(ctx)}),true;
    }
    if(req.method==='GET'&&path==='/api/dcr/connections')return json(200,connections.catalog()),true;
    if(req.method==='POST'){
      let value:unknown;
      if(path==='/api/dcr/scan'){insist(scannerConfig(ctx),'Automatic scanning is not configured.',409);const scanner=new DcrScannerStore(store);insist(!scanner.get<boolean>('paused'),'Resume scanning before running a new scan.',409);void scanProductionDcr(ctx,true);value={ok:true};}
      else if(path==='/api/dcr/scan/pause'){insist(typeof input.paused==='boolean','Choose pause or resume.');const scanner=new DcrScannerStore(store);scanner.set('paused',input.paused);if(!input.paused)scanner.set('lastSlot','');value={ok:true};}
      else if(path==='/api/dcr/findings/edit')value=new DcrScannerStore(store).editRelationship(input.id,input.revision,input.fields);
      else if(path==='/api/dcr/findings/contact')value=saveRelationshipContact(ctx,new DcrScannerStore(store),input);
      else if(path==='/api/dcr/findings/decide')value=await confirmScannedFinding(ctx,new DcrScannerStore(store),input);
      else if(path==='/api/dcr/records')value=store.save(input.fields,input.id,input.revision,input.sourceIds??[],input.linkedIds??[]);
      else if(path==='/api/dcr/commitments/from-decision')value=store.commitmentFromDecision(input.decisionId,input.revision,input.fields);
      else if(path==='/api/dcr/sources')value=store.addSource(input.title,input.text);
      else if(path==='/api/dcr/sources/remove'){store.revokeSource(input.id);value={ok:true};}
      else if(path==='/api/dcr/artifacts/preview'){try{value=connections.artifact(input.id);}catch{throw new DcrError(409,'Artifact unavailable or unsupported. Choose a current text Artifact up to 20,000 characters.');}}
      else if(path==='/api/dcr/artifacts/select')value=store.addArtifact(input.id,input.version);
      else if(path==='/api/dcr/work-links')value=store.linkWork(input.recordId,input.revision,input.kind,input.id,input.version,input.remove===true);
      else if(path==='/api/dcr/accept'){insist(Array.isArray(input.edits),'Review the proposal.');value=store.accept(input.id,input.edits,input.link===true);}
      else if(path==='/api/dcr/dismiss'){const r=store.request(input.id);insist(r.state!=='running','Wait for the answer.');store.setRequest({...r,accepted:true});value={ok:true};}
      else if(path==='/api/dcr/prepare')value=prepareProductionDcrApproval(ctx,store,input);
      else if(path==='/api/dcr/ask'){
        const key=policy.allowAi?dcrAiKey(ctx):'';insist(key,'AI is not configured for DCR. Records remain available.',503);
        const r=store.begin(input.prompt,input.recordId??null,input.sourceIds??[],input.propose===true);
        json(r.state==='running'?202:200,r);if(r.state==='running')void runDcrConversation(store,r.id,key,fetch,assistantName);return true;
      }else throw new DcrError(404,'DCR endpoint not found.');
      json(200,value);return true;
    }
    throw new DcrError(404,'DCR endpoint not found.');
  }catch(e){json(e instanceof DcrError?e.status:503,{error:e instanceof DcrError?e.message:'DCR is temporarily unavailable. Your confirmed records are preserved.'});return true;}
}

export async function scanProductionDcr(ctx:KeyContext,force=false){
 const config=scannerConfig(ctx);if(!config)return;const fingerprint=JSON.stringify(config);
 try{await runScanner(ctx,productionDcrStore(ctx),{force,config,stillEnabled:()=>JSON.stringify(scannerConfig(ctx))===fingerprint});}catch{ /* Failed runs remain visible; never log private source content. */ }
}
/** Persistent slot claims coordinate both executive listeners and survive restarts. */
export function startDcrScanner(ctx:KeyContext){
 const tick=()=>{if(scannerConfig(ctx))void scanProductionDcr(ctx);};
 const timer=setInterval(tick,60000);timer.unref();const first=setTimeout(tick,15000);first.unref();
 return ()=>{clearInterval(timer);clearTimeout(first);};
}
