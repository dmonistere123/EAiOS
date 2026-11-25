import { createHash, randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { KeyContext } from './apiKeys.ts';
import { SocialError, socialAccounts, socialStore, readSocialPost, putSocialPost } from './socialStore.ts';
import { bindingDigest, verifySocialBinding, publishSocialProvider } from './socialPublishingProvider.ts';
import { SOCIAL_LIMITS, socialPublishingBlock, socialCopyLength, type SocialPost, type SocialBinding, type SocialPublication } from '../src/domain/social.ts';
import type { Approval } from '../src/domain/types.ts';
const rootFor=(ctx:KeyContext)=>ctx.dataRoot??ctx.eaiosRoot;
const fingerprint=(p:SocialPost,b:SocialBinding)=>createHash('sha256').update(JSON.stringify({id:p.id,revision:p.revision,copy:p.copy,title:p.title,imageVersion:p.imageVersion,account:p.account,date:p.plannedDate,time:p.time,zone:p.timeZone,binding:b})).digest('hex');
function jobs(db:DatabaseSync):SocialPublication[]{return (db.prepare('SELECT body FROM social_publications').all() as {body:string}[]).map(r=>JSON.parse(r.body));}
function jobFor(db:DatabaseSync,id:string):SocialPublication{const row=db.prepare('SELECT body FROM social_publications WHERE id=?').get(id) as {body:string}|undefined;if(!row)throw new SocialError(404,'Publication not found.');return JSON.parse(row.body);}
function save(db:DatabaseSync,j:SocialPublication){db.prepare('INSERT INTO social_publications VALUES (?,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body').run(j.id,JSON.stringify(j));}
function event(db:DatabaseSync,j:SocialPublication,kind:string){db.prepare('INSERT INTO social_events(job_id,kind,created_at) VALUES (?,?,?)').run(j.id,kind,new Date().toISOString());}
/** Resolve calendar wall time and reject nonexistent/ambiguous DST times. */
export function socialDueAt(p:Pick<SocialPost,'plannedDate'|'time'|'timeZone'>):number{
 const naive=Date.parse(p.plannedDate+'T'+p.time+':00Z');if(!Number.isFinite(naive))throw new SocialError(400,'Choose a valid posting date and time.');
 const formatter=new Intl.DateTimeFormat('en-CA',{timeZone:p.timeZone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
 const expected=p.plannedDate+'T'+p.time,matches:number[]=[];
 // Current civil time zones use 15-minute offsets. Range covers UTC-12 through UTC+14.
 for(let t=naive-14*3600000;t<=naive+14*3600000;t+=15*60000){const parts=Object.fromEntries(formatter.formatToParts(t).map(x=>[x.type,x.value]));if(`${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`===expected)matches.push(t);}
 if(matches.length!==1)throw new SocialError(400,'This local time is skipped or repeated by daylight saving. Choose a different posting time.');return matches[0];
}
function bindingFor(db:DatabaseSync,accountId:string):SocialBinding{const row=db.prepare('SELECT body FROM social_bindings WHERE id=?').get(accountId) as {body:string}|undefined;if(!row)throw new SocialError(409,'Connect and verify this posting account first.');return JSON.parse(row.body);}
export function submitSocialApproval(root:string,id:string,revision:unknown,now=Date.now()){
 return socialStore(root,db=>submitInStore(db,root,id,revision,now));
}
function submitInStore(db:DatabaseSync,root:string,id:string,revision:unknown,now:number){
  const p=readSocialPost(db,id);
  if(p.revision!==revision)throw new SocialError(409,'This draft changed. Reload before submitting.');
  if(!['draft','reviewed','failed'].includes(p.status))throw new SocialError(409,'This post already has an approval or publication in progress.');
  if(!p.account||p.network==='blog'||p.network==='snapchat')throw new SocialError(409,'Create a draft for a configured posting account first.');
  const blocked=socialPublishingBlock(p.account);if(blocked)throw new SocialError(409,blocked);
  const configured=socialAccounts(root).find(a=>a.id===p.account!.id);
  if(JSON.stringify(configured)!==JSON.stringify(p.account))throw new SocialError(409,'The destination configuration changed. Create a fresh draft.');
  if(!p.copy.trim()||socialCopyLength(p.copy,p.network)>SOCIAL_LIMITS[p.network])throw new SocialError(409,'Complete and shorten the copy before submitting.');
  if((p.imagePrompt||p.network==='instagram')&&!p.imageVersion)throw new SocialError(409,'Generate and review the image before submitting.');
  if(p.imageVersion&&!db.prepare('SELECT 1 FROM images WHERE id=?').get(p.imageVersion))throw new SocialError(409,'The approved image is missing.');
  const binding=bindingFor(db,p.account.id);
  if(JSON.stringify(binding.account)!==JSON.stringify(p.account))throw new SocialError(409,'Reconnect this destination before submitting.');
  const dueAt=socialDueAt(p);if(dueAt<=now)throw new SocialError(409,'Choose a future posting time before submitting.');
  p.status='awaiting_approval';p.revision++;putSocialPost(db,p);
  const j:SocialPublication={id:randomUUID(),post:{...p},binding,fingerprint:fingerprint(p,binding),dueAt,state:'blocked',submittedAt:new Date(now).toISOString()};
  save(db,j);event(db,j,'submitted_blocked_unassigned');return j;
}
export function socialApprovals(root:string):Approval[]{return socialStore(root,db=>jobs(db).filter(j=>j.state==='blocked').map(j=>({
 id:'social:'+j.id,workItemId:'social:'+j.post.id,requestedByAgentId:'social-studio',actionType:'publish',targetSystem:j.post.network,targetObject:j.post.title,risk:'medium',status:'pending',submittedAt:j.submittedAt,reviewVersion:j.fingerprint,
 payload:`Account: ${j.post.account!.label}\nProfile: ${j.post.account!.url}\nVerified identity: ${j.binding.profileName} (${j.binding.actor})\nScheduled: ${j.post.plannedDate} ${j.post.time} ${j.post.timeZone}\nVisibility: Public\n\n${j.post.copy}`,
 evidence:[{kind:'url',label:j.post.account!.url,uri:j.post.account!.url}],socialPost:{postId:j.post.id,imageVersion:j.post.imageVersion,accountUrl:j.post.account!.url,scheduledFor:new Date(j.dueAt).toISOString()},rollbackPlan:'A public post cannot be recalled from all viewers. Cancel or edit before execution; editing cancels this approval.'
})));}
export function decideSocialApproval(root:string,id:string,body:Record<string,unknown>,now=Date.now()){
 return socialStore(root,db=>{
  const j=jobFor(db,id),p=readSocialPost(db,j.post.id);
  if(!['approved','rejected','changes_requested'].includes(String(body.decision)))throw new SocialError(400,'Choose a valid decision.');
  if(j.fingerprint!==body.reviewVersion)throw new SocialError(409,'Refresh and review this approval again.');
  if(j.decision===body.decision&&['scheduled','published','publishing'].includes(j.state))return {ok:true,auditEventId:j.id};
  if(j.state!=='blocked'||fingerprint(p,j.binding)!==j.fingerprint)throw new SocialError(409,'The draft changed or this approval was already decided.');
  if(body.decision==='approved'){
   if(j.dueAt<=now)throw new SocialError(409,'The scheduled time has passed. Edit the draft and submit a new approval.');
   if(bindingDigest(bindingFor(db,p.account!.id))!==bindingDigest(j.binding))throw new SocialError(409,'The connection changed. Submit a fresh approval.');
   j.state='scheduled';p.status='scheduled';
  }else{j.state='cancelled';p.status='draft';p.revision++;}
  j.decision=body.decision as SocialPublication['decision'];j.decidedAt=new Date(now).toISOString();save(db,j);putSocialPost(db,p);event(db,j,'decision_'+j.decision);return {ok:true,auditEventId:j.id};
 });
}
/** Called inside the same transaction as edits and archives. No execution can race an edit. */
export function cancelSocialForEdit(db:DatabaseSync,p:SocialPost){
 if(['publishing','uncertain'].includes(p.status))throw new SocialError(409,'Publication is in progress or its outcome is uncertain. Check the provider before taking further action.');
 for(const j of jobs(db).filter(j=>j.post.id===p.id&&['blocked','scheduled'].includes(j.state))){j.state='cancelled';save(db,j);event(db,j,'cancelled_by_edit');}
}
export interface PublishingProvider {verify:typeof verifySocialBinding;publish:typeof publishSocialProvider;}
const realProvider:PublishingProvider={verify:verifySocialBinding,publish:publishSocialProvider};
/** Atomic claims coordinate both dashboard processes. A claimed send is NEVER replayed. */
export async function runSocialPublishing(ctx:KeyContext,provider:PublishingProvider=realProvider,now=Date.now()){
 const root=rootFor(ctx);
 queueDailySocialApprovals(root,now);
 const job=socialStore(root,db=>{
  for(const j of jobs(db)){
   if(j.state==='publishing'&&now-(j.claimedAt??now)>15*60000){j.state='uncertain';j.error='Execution was interrupted. Check the platform; this post will not be retried automatically.';save(db,j);const p=readSocialPost(db,j.post.id);p.status='uncertain';p.publicationError=j.error;putSocialPost(db,p);event(db,j,'interrupted_uncertain');}
  }
  for(const j of jobs(db).filter(j=>j.state==='scheduled'&&j.dueAt<=now).sort((a,b)=>a.dueAt-b.dueAt)){
   const p=readSocialPost(db,j.post.id);let reason='';
   const configured=socialAccounts(root).find(a=>a.id===p.account?.id);
   let current:SocialBinding|undefined;try{current=bindingFor(db,p.account!.id);}catch{/* Fail this job without stopping the queue. */}
   if(j.decision!=='approved'||fingerprint({...p,status:j.post.status},j.binding)!==j.fingerprint||(!current||bindingDigest(current)!==bindingDigest(j.binding))||JSON.stringify(configured)!==JSON.stringify(j.post.account))reason='Content or connection changed. Submit a new approval.';
   if(p.account && socialPublishingBlock(p.account))reason=socialPublishingBlock(p.account)!;
   if(now-j.dueAt>2*3600000)reason='The posting time was missed by more than two hours. Review and reschedule.';
   if(reason){j.state='failed';j.error=reason;save(db,j);p.status='failed';p.publicationError=reason;putSocialPost(db,p);event(db,j,'blocked_before_execution');continue;}
   j.state='publishing';j.claimedAt=now;save(db,j);p.status='publishing';putSocialPost(db,p);event(db,j,'claimed_once');return j;
  }
  return undefined;
 });
 if(!job)return;
 let attempted=false;
 try{
  await provider.verify(ctx,job.binding);
  const image=job.post.imageVersion?socialStore(root,db=>(db.prepare('SELECT data FROM images WHERE id=?').get(job.post.imageVersion!) as {data:Uint8Array}|undefined)?.data):undefined;
  if(job.post.imageVersion&&!image)throw new Error('The approved image is missing.');
  // From this point an uncertain response might hide a successful external write.
  attempted=true;
  const receipt=await provider.publish(ctx,job.post,job.binding,image?Buffer.from(image):undefined);
  if(!receipt.id)throw new Error('Provider returned no publication receipt.');
  socialStore(root,db=>{const j=jobFor(db,job.id);if(!['publishing','uncertain'].includes(j.state))throw new Error('Publication state changed.');j.state='published';j.receipt=receipt;save(db,j);const p=readSocialPost(db,j.post.id);p.status='published';p.publicationId=receipt.id;p.publishedUrl=receipt.url;p.publishedAt=new Date().toISOString();p.publicationError=undefined;putSocialPost(db,p);event(db,j,'provider_confirmed');});
 }catch{
  socialStore(root,db=>{const j=jobFor(db,job.id);if(j.state==='published')return;j.state=attempted?'uncertain':'failed';j.error=attempted?'The provider outcome could not be confirmed. Check the platform; no automatic retry will occur.':'Connection verification failed before publishing. Reconnect, then submit a fresh approval.';save(db,j);const p=readSocialPost(db,j.post.id);p.status=j.state;p.publicationError=j.error;putSocialPost(db,p);event(db,j,j.state);});
 }
}
export function startSocialPublisher(ctx:KeyContext){let busy=false;const tick=()=>{if(busy)return;busy=true;void runSocialPublishing(ctx).catch(()=>console.warn('Social publishing check failed; no automatic send retry.')).finally(()=>{busy=false;});};const timer=setInterval(tick,30000);timer.unref();return ()=>clearInterval(timer);}

/** Enqueue reviewed content at 06:00 in each post's timezone, never authorize it. */
export function queueDailySocialApprovals(root:string,now=Date.now()) {
 return socialStore(root,db=>{
  for(const j of jobs(db).filter(j=>j.state==='blocked'&&j.dueAt<=now)) {
   j.state='failed';j.error='Approval was not received before the posting time. Review and reschedule.';save(db,j);
   const p=readSocialPost(db,j.post.id);p.status='failed';p.publicationError=j.error;putSocialPost(db,p);event(db,j,'approval_time_missed');
  }
  const posts=(db.prepare('SELECT body FROM posts').all() as {body:string}[]).map(r=>JSON.parse(r.body) as SocialPost);
  for(const p of posts.filter(p=>p.status==='reviewed'&&p.account)) {
   try {
    const due=socialDueAt(p),queueAt=socialDueAt({...p,time:'06:00'});
    if(due<=now) {p.status='failed';p.publicationError='The posting time has passed. Review and reschedule.';putSocialPost(db,p);continue;}
    if(due<=queueAt)throw new SocialError(409,'Choose a posting time after 6:00 AM for the daily approval queue.');
    if(now<queueAt)continue;
    submitInStore(db,root,p.id,p.revision,now);
   } catch(e) {
    p.publicationError=e instanceof SocialError?e.message:'Could not prepare approval. Check the schedule and connection.';
    putSocialPost(db,p);
   }
  }
 });
}
export function deleteSocialPost(root:string,id:string,revision:unknown) {
 return socialStore(root,db=>{
  const p=readSocialPost(db,id);
  if(p.revision!==revision)throw new SocialError(409,'This post changed. Reload before deleting.');
  if(p.status==='published'||p.status==='archived')throw new SocialError(409,'Published history cannot be deleted here.');
  cancelSocialForEdit(db,p);
  db.prepare('DELETE FROM posts WHERE id=?').run(id);
  return {ok:true};
 });
}
