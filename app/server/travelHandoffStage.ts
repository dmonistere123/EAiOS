/** Staging-only transport. No real email or Hermes execution is reachable here. */
import { createServer } from 'node:http';
import type { IncomingMessage,ServerResponse } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { existsSync,mkdirSync,readFileSync,writeFileSync,readdirSync } from 'node:fs';
import { join,resolve,extname } from 'node:path';
import { handleApiRequest } from './httpApi.ts';
import { createHumanContact,listHumanContacts,humanStore,prepareHumanDraft } from './humanDelegation.ts';
import { submitHumanApproval,decideHumanApproval } from './humanApproval.ts';
import { prepareTravelHandoff } from './travelHandoff.ts';
import { handleAssistantPortal,readSmallJson,sendJson } from './assistantPortal.ts';
import { requireSameOriginJson } from './updates.ts';
import { travelStore,writeTrip } from './travelStore.ts';
import { keyContext } from './apiKeys.ts';
import type { MailboxIdentity } from '../src/domain/mailRouting.ts';
import type { TravelTrip } from '../src/domain/types.ts';

export function initializeTravelStage(root:string) {
  mkdirSync(root,{recursive:true,mode:0o700});mkdirSync(join(root,'kanban','attachments'),{recursive:true,mode:0o700});mkdirSync(join(root,'outbox'),{recursive:true,mode:0o700});
  const db=new DatabaseSync(join(root,'kanban.db'));
  db.exec(`CREATE TABLE IF NOT EXISTS tasks(id TEXT PRIMARY KEY,title TEXT,body TEXT,status TEXT,assignee TEXT,created_at REAL);
    CREATE TABLE IF NOT EXISTS task_attachments(id INTEGER PRIMARY KEY,task_id TEXT,filename TEXT,stored_path TEXT,content_type TEXT,size INTEGER,uploaded_by TEXT,created_at REAL);`);db.close();
  if(!listHumanContacts(root).length)createHumanContact(root,{displayName:'Sample Human Assistant',email:'assistant@example.invalid',title:'Staging assistant'});
  const identity:MailboxIdentity={connectionId:'ca_staging',provider:'outlook',email:'executive@example.invalid',providerUserId:'staging-executive',verifiedAt:new Date().toISOString()};
  humanStore(root,db=>{db.exec('CREATE TABLE IF NOT EXISTS mail_routing_settings(id INTEGER PRIMARY KEY,body TEXT NOT NULL)');db.prepare('INSERT OR IGNORE INTO mail_routing_settings VALUES(1,?)').run(JSON.stringify({revision:1,delegationSender:identity}));});
  travelStore(root,db=>{
    if(db.prepare('SELECT id FROM trips WHERE id=?').get('staging-demo'))return;
    const sample:TravelTrip={id:'staging-demo',name:'STAGING SAMPLE · Baton Rouge visit',destination:'Baton Rouge',startsAt:'2026-12-07',endsAt:'2026-12-09',status:'planning',budgetUsd:1800,needsCar:true,preferredHotels:'Near downtown',diningPreferences:'Local restaurants',
      originPlace:{id:'bhm',code:'BHM',city:'Birmingham',name:'Birmingham–Shuttlesworth',country:'US'},destinationPlace:{id:'btr',code:'BTR',city:'Baton Rouge',name:'Baton Rouge Metropolitan',country:'US',latitude:30.5332,longitude:-91.1496},carPreferences:{driverAge:45,residenceCountry:'US',pickupTime:'12:00',dropoffTime:'12:00'},approvals:[],bookings:[
        {id:'sample-flight',tripId:'staging-demo',kind:'flight',title:'Sample round-trip flight',status:'approved',provider:'external',testMode:true,airline:'Sample airline',flightNumber:'DEMO',origin:'BHM',destination:'BTR',departureAt:'2026-12-07T09:00:00',arrivalAt:'2026-12-07T12:00:00',cabin:'Economy',details:'STAGING FIXTURE — invented flight, not a Duffel search result. Return Dec 9, 4:00 PM–7:00 PM.'},
        {id:'sample-hotel',tripId:'staging-demo',kind:'hotel',title:'Sample downtown hotel',status:'approved',provider:'external',hotelName:'Sample downtown hotel',roomType:'King room',checkIn:'2026-12-07',checkOut:'2026-12-09',address:'Baton Rouge, LA',notes:'STAGING FIXTURE — select a real hotel before booking.'},
        {id:'sample-dining',tripId:'staging-demo',kind:'restaurant',title:'Sample client dinner',status:'approved',provider:'external',restaurantName:'Sample client dinner',reservationAt:'2026-12-08T18:30:00',partySize:2,address:'Baton Rouge, LA',notes:'STAGING FIXTURE — choose a real restaurant and verify availability.'},
      ]};writeTrip(db,sample);
  });
  return identity;
}
function staticFile(req:IncomingMessage,res:ServerResponse,dist:string,portal:boolean) {
  const path=new URL(req.url??'/','http://localhost').pathname;
  if(req.method!=='GET'){sendJson(res,405,{error:'Method not supported.'});return;}
  const asset=/^\/assets\/[a-zA-Z0-9_.-]+\.(js|css|svg|woff2?)$/.test(path);
  const route=portal?path==='/assistant-task':/^\/(travel|human-assistant|staff|approvals|artifacts|staging-outbox)?$/.test(path);
  if(!asset&&!route){sendJson(res,404,{error:'Page not available in staging.'});return;}
  const file=asset?join(dist,path):join(dist,'index.html');
  if(!existsSync(file)){sendJson(res,404,{error:'Build staging first.'});return;}
  const types:Record<string,string>={'.js':'text/javascript','.css':'text/css','.html':'text/html','.svg':'image/svg+xml','.woff2':'font/woff2'};
  res.setHeader('content-type',types[extname(file)]??'application/octet-stream');res.setHeader('cache-control','no-store');res.setHeader('referrer-policy','no-referrer');res.setHeader('x-content-type-options','nosniff');res.end(readFileSync(file));
}
export function startTravelStage(root:string,dist:string,executivePort=5275,assistantPort=5276) {
  const identity=initializeTravelStage(root),ctx={hermesHome:root,eaiosRoot:root,dataRoot:root};
  process.env.EAIOS_TRAVEL_ASSISTED='1';process.env.EAIOS_ASSISTANT_ORIGIN=`http://127.0.0.1:${assistantPort}`;
  const mail={verify:async()=>identity,send:async(_ctx:unknown,pkg:unknown,_identity:unknown,files:{filename:string;data:Buffer}[])=>{
    const id='staging-'+crypto.randomUUID(),folder=join(root,'outbox',id);mkdirSync(folder,{mode:0o700});
    writeFileSync(join(folder,'message.json'),JSON.stringify({staging:true,package:pkg,attachments:files.map(f=>f.filename)},null,2),{mode:0o600});
    files.forEach((f,i)=>writeFileSync(join(folder,`attachment-${i+1}.txt`),f.data,{mode:0o600}));
    return {id,provider:'staging-capture'};
  }};
  const executive=createServer((req,res)=>{void (async()=>{
    if(!['127.0.0.1:'+executivePort,'localhost:'+executivePort].includes(req.headers.host??'')){sendJson(res,403,{error:'Invalid staging host.'});return;}
    const path=new URL(req.url??'/','http://localhost').pathname;res.setHeader('cache-control','no-store');
    try {
      const handoff=path.match(/^\/api\/travel\/trips\/([^/]+)\/handoff$/),action=path.match(/^\/api\/human-delegations\/(hd_[\w-]+)\/(submit|decision)$/);
      if(req.method==='POST'&&(handoff||action||path==='/api/human-delegations/drafts')){
        requireSameOriginJson(req);const input=await readSmallJson(req);
        if(handoff){sendJson(res,201,await prepareTravelHandoff(ctx,handoff[1],input,identity));return;}
        if(!action){sendJson(res,201,prepareHumanDraft(root,input,identity));return;}
        sendJson(res,200,action[2]==='submit'?await submitHumanApproval(ctx,action[1],input,mail.verify):await decideHumanApproval(ctx,action[1],input,mail));return;
      }
      if(path==='/api/staging/outbox'&&req.method==='GET'){sendJson(res,200,readdirSync(join(root,'outbox')).map(id=>({id,...JSON.parse(readFileSync(join(root,'outbox',id,'message.json'),'utf8'))})));return;}
      if(path==='/api/modules'&&req.method==='GET'){sendJson(res,200,{enabled:['travel']});return;}
      if(/^\/api\/(travel\/|human-contacts(?:\/|$)|human-delegations(?:\/|$)|artifacts(?:\/|$))/.test(path)){
        if(await keyContext.run(ctx,()=>handleApiRequest(req,res,ctx)))return;
      }
      if(/^\/(api|composio-api|knowledge-api|podcasts-api)(\/|$)/.test(path)){sendJson(res,503,{error:'This staging workspace exposes only travel, artifacts and human delegation.'});return;}
      staticFile(req,res,resolve(dist),false);
    }catch(e){sendJson(res,typeof (e as {status?:number}).status==='number'?(e as {status:number}).status:400,{error:e instanceof Error?e.message:'Staging request failed.'});}
  })();});
  const assistant=createServer((req,res)=>{
    if(!['127.0.0.1:'+assistantPort,'localhost:'+assistantPort].includes(req.headers.host??'')){sendJson(res,403,{error:'Invalid assistant host.'});return;}
    if((req.url??'').startsWith('/api/')){void handleAssistantPortal(req,res,root);return;}
    staticFile(req,res,resolve(dist),true);
  });
  executive.listen(executivePort,'127.0.0.1');assistant.listen(assistantPort,'127.0.0.1');
  return {executive,assistant,root};
}
