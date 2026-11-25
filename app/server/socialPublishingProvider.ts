import { socialPublishingBlock } from '../src/domain/social.ts';
/** Deterministic provider calls. No language model receives posting tools or tokens. */
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { appKey, type KeyContext } from './apiKeys.ts';
import { SocialError, socialAccounts, socialStore } from './socialStore.ts';
import type { SocialAccount, SocialPost, SocialBinding, SocialConnectionChoice } from '../src/domain/social.ts';
// Provider responses have heterogeneous documented JSON shapes. They never cross the API unfiltered.
type Wire = Record<string, any>;
const rootFor=(ctx:KeyContext)=>ctx.dataRoot??ctx.eaiosRoot;
const toolkit=(a:SocialAccount)=>a.network==='x'?'twitter':a.network;
const slug=(a:Wire)=>typeof a.toolkit==='string'?a.toolkit:a.toolkit?.slug;
export const bindingDigest=(b:SocialBinding)=>createHash('sha256').update(JSON.stringify(b)).digest('hex');
export async function composioRequest(ctx:KeyContext,path:string,body?:unknown):Promise<Wire>{
 const token=appKey('COMPOSIO_API_KEY',ctx);if(!token)throw new SocialError(503,'Add the Composio key in Settings first.');
 const response=await fetch('https://backend.composio.dev'+path,{method:body===undefined?'GET':'POST',redirect:'error',signal:AbortSignal.timeout(60000),headers:{'content-type':'application/json','x-api-key':token},...(body===undefined?{}:{body:JSON.stringify(body)})});
 if(!response.ok){await response.body?.cancel();throw new SocialError(502,`Composio returned HTTP ${response.status}. Check the connection and provider permissions.`);}
 const raw=await response.text();if(raw.length>2000000)throw new SocialError(502,'Provider response was too large.');return JSON.parse(raw);
}
async function pages(ctx:KeyContext,path:string){const rows:Wire[]=[];const seen=new Set<string>();let cursor='';for(let i=0;i<64;i++){const data=await composioRequest(ctx,path+(cursor?'&cursor='+encodeURIComponent(cursor):''));rows.push(...(data.items??[]));if(!data.next_cursor)return rows;if(typeof data.next_cursor!=='string'||seen.has(data.next_cursor))break;cursor=data.next_cursor;seen.add(cursor);}throw new SocialError(502,'Unable to load the complete connection list.');}
async function tool(ctx:KeyContext,b:Pick<SocialBinding,'connectionId'|'userId'>,name:string,args:unknown={}){
 const raw=await composioRequest(ctx,'/api/v3/tools/execute/'+name,{connected_account_id:b.connectionId,entity_id:b.userId,version:'00000000_00',arguments:args});
 if(raw.successful!==true)throw new SocialError(502,`The ${name.split('_')[0]} request failed. Check account permissions in Connections.`);return raw.data as Wire;
}
const liHeaders=[{name:'LinkedIn-Version',value:'202606',type:'header'},{name:'X-Restli-Protocol-Version',value:'2.0.0',type:'header'}];
async function proxy(ctx:KeyContext,b:Pick<SocialBinding,'connectionId'>,endpoint:string,method='GET',body?:unknown,binary?:Buffer){
 const response=await composioRequest(ctx,'/api/v3/tools/execute/proxy',{connected_account_id:b.connectionId,endpoint,method,parameters:endpoint.includes('linkedin.com')?liHeaders:[],...(body===undefined?{}:{body}),...(binary?{binary_body:{base64:binary.toString('base64'),content_type:'image/png'}}:{})});
 if(typeof response.status!=='number'||response.status<200||response.status>=300)throw new SocialError(502,`Provider returned HTTP ${response.status??'unknown'}. Check account permissions.`);
 return response;
}
async function inspect(ctx:KeyContext,account:SocialAccount,connection:Wire):Promise<SocialBinding>{
 if(connection.status!=='ACTIVE'||slug(connection)!==toolkit(account)||!connection.id||!connection.user_id)throw new SocialError(409,'Choose an active connection for this platform.');
 const blocked=socialPublishingBlock(account);if(blocked)throw new SocialError(409,blocked);
 const base={account,connectionId:String(connection.id),userId:String(connection.user_id),verifiedAt:new Date().toISOString()};
 if(account.network==='linkedin'){
  const profile=(await tool(ctx,base,'LINKEDIN_GET_MY_INFO')).response_dict;
  const actor=profile?.author_id??(profile?.sub?'urn:li:person:'+profile.sub:'');
  if(!/^urn:li:person:[\w-]+$/.test(actor))throw new SocialError(502,'LinkedIn did not return a verified member ID.');
  const company=new URL(account.url).pathname.match(/^\/company\/(\d+)\/?$/);
  if(company){
   const author='urn:li:organization:'+company[1];
   const acls=await proxy(ctx,base,'https://api.linkedin.com/rest/organizationAcls?q=roleAssignee&role=ADMINISTRATOR&state=APPROVED&count=100');
   if(!acls.data?.elements?.some((e:Wire)=>e.organization===author&&e.state==='APPROVED'&&e.role==='ADMINISTRATOR'))throw new SocialError(409,'This LinkedIn connection has not verified administrator access to the company page. Company-page permissions are required.');
   return {...base,actor:author,profileName:account.label};
  }
  return {...base,actor,profileName:String(profile.name??profile.given_name??actor)};
 }
 const result=await tool(ctx,base,account.network==='x'?'TWITTER_USER_LOOKUP_ME':'INSTAGRAM_GET_USER_INFO');
 const profile=account.network==='x'?result.data:result;
 const expected=new URL(account.url).pathname.split('/').filter(Boolean)[0]?.toLowerCase();
 if(typeof profile?.username!=='string'||profile.username.toLowerCase()!==expected||!profile.id)throw new SocialError(409,'The authenticated account does not match this saved profile URL. Connect the correct account.');
 if(account.network==='instagram'&&profile.account_type && !['BUSINESS','MEDIA_CREATOR','CREATOR'].includes(profile.account_type))throw new SocialError(409,'Instagram requires a Business or Creator account.');
 return {...base,actor:String(profile.id),profileName:'@'+profile.username};
}
export async function socialConnectionChoices(ctx:KeyContext,accountId:string):Promise<SocialConnectionChoice[]>{
 const account=socialAccounts(rootFor(ctx)).find(a=>a.id===accountId);if(!account)throw new SocialError(404,'Account not configured.');
 const choices:SocialConnectionChoice[]=[];
 for(const c of (await pages(ctx,'/api/v3/connected_accounts?limit=100')).filter(c=>slug(c)===toolkit(account)&&c.status==='ACTIVE')){
  try{const b=await inspect(ctx,account,c);choices.push({connectionId:b.connectionId,actor:b.actor,profileName:b.profileName});}catch(e){choices.push({connectionId:String(c.id),error:e instanceof Error?e.message:'Connection could not be verified.'});}
 }
 return choices;
}
export async function bindSocialAccount(ctx:KeyContext,accountId:string,body:Record<string,unknown>){
 const account=socialAccounts(rootFor(ctx)).find(a=>a.id===accountId);if(!account)throw new SocialError(404,'Account not configured.');
 if(typeof body.connectionId!=='string'||!/^ca_[\w-]+$/.test(body.connectionId))throw new SocialError(400,'Choose a verified connection.');
 const connection=await composioRequest(ctx,'/api/v3/connected_accounts/'+encodeURIComponent(body.connectionId));
 const binding=await inspect(ctx,account,connection);
 if(body.confirmedActor!==binding.actor)throw new SocialError(409,'Review the authenticated profile before linking it.');
 socialStore(rootFor(ctx),db=>db.prepare('INSERT INTO social_bindings VALUES (?,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body').run(accountId,JSON.stringify(binding)));
 return binding;
}
export async function connectSocialAccount(ctx:KeyContext,accountId:string){
 const account=socialAccounts(rootFor(ctx)).find(a=>a.id===accountId);if(!account)throw new SocialError(404,'Account not configured.');
 const blocked=socialPublishingBlock(account);if(blocked)throw new SocialError(409,blocked);
 const name=toolkit(account),catalog=await composioRequest(ctx,'/api/v3/toolkits/'+name);
 const configs=(await pages(ctx,'/api/v3/auth_configs?toolkit_slug='+name+'&limit=100')).filter(c=>slug(c)===name);
 if(configs.length>1)throw new SocialError(409,'Multiple authentication configurations exist. Choose the intended configuration in Composio before linking this account.');
 let id=configs[0]?.id;
 if(!id){
  if(!catalog.composio_managed_auth_schemes?.includes('OAUTH2'))throw new SocialError(409,'X needs your developer app configured in Composio first. Create a custom Twitter authentication configuration, then return here.');
  const created=await composioRequest(ctx,'/api/v3/auth_configs',{toolkit:{slug:name},auth_config:{type:'use_composio_managed_auth',name:'EAiOS Social — '+name}});id=created.auth_config?.id;
 }
 if(!id)throw new SocialError(502,'Authentication setup did not complete.');
 const linked=await composioRequest(ctx,'/api/v3/connected_accounts/link',{auth_config_id:id,user_id:'eaios-executive'});
 const url=new URL(linked.redirect_url);if(url.protocol!=='https:'||!(url.hostname==='composio.dev'||url.hostname.endsWith('.composio.dev')))throw new SocialError(502,'Unexpected authorization URL.');
 return {url:url.href};
}
export async function verifySocialBinding(ctx:KeyContext,b:SocialBinding){
 const current=await composioRequest(ctx,'/api/v3/connected_accounts/'+encodeURIComponent(b.connectionId));
 const verified=await inspect(ctx,b.account,current);
 if(verified.actor!==b.actor||verified.userId!==b.userId)throw new SocialError(409,'The authenticated identity changed. Reconnect and approve a fresh draft.');
}
const requireId=(value:unknown,pattern:RegExp)=>{if(typeof value!=='string'||!pattern.test(value))throw new Error('Provider did not return a valid publication receipt.');return value;};
/** Only called after a durable approved-job claim. Failures are never automatically retried. */
export async function publishSocialProvider(ctx:KeyContext,post:SocialPost,b:SocialBinding,image?:Buffer):Promise<{id:string;url?:string}>{
 const blocked=socialPublishingBlock(b.account);if(blocked)throw new SocialError(409,blocked);
 if(post.network==='linkedin'){
  let media:string|undefined;
  if(image){
   const init=await proxy(ctx,b,'https://api.linkedin.com/rest/images?action=initializeUpload','POST',{initializeUploadRequest:{owner:b.actor}});
   media=requireId(init.data?.value?.image,/^urn:li:image:[\w-]+$/);
   const upload=new URL(init.data.value.uploadUrl);
   if(upload.protocol!=='https:'||upload.hostname!=='www.linkedin.com'||!upload.pathname.startsWith('/dms-uploads/'))throw new Error('Unexpected LinkedIn image upload URL.');
   await proxy(ctx,b,upload.href,'PUT',undefined,image);
  }
  const receipt=await proxy(ctx,b,'https://api.linkedin.com/rest/posts','POST',{author:b.actor,commentary:post.copy,visibility:'PUBLIC',distribution:{feedDistribution:'MAIN_FEED',targetEntities:[],thirdPartyDistributionChannels:[]},lifecycleState:'PUBLISHED',isReshareDisabledByAuthor:false,...(media?{content:{media:{id:media,title:post.title}}}:{})});
  const id=requireId(receipt.headers?.['x-restli-id']??receipt.headers?.['X-RestLi-Id']??receipt.data?.id,/^urn:li:(share|ugcPost):\d+$/);
  return {id,url:'https://www.linkedin.com/feed/update/'+encodeURIComponent(id)+'/'};
 }
 if(post.network==='x'){
  let media:string|undefined;
  if(image){const upload=await proxy(ctx,b,'https://api.x.com/2/media/upload','POST',{media:image.toString('base64'),media_category:'tweet_image',media_type:'image/png'});media=requireId(upload.data?.data?.id??upload.data?.data?.media_id,/^\d+$/);}
  const receipt=await proxy(ctx,b,'https://api.x.com/2/tweets','POST',{text:post.copy,...(media?{media:{media_ids:[media]}}:{})});
  const id=requireId(receipt.data?.data?.id,/^\d+$/);return {id,url:'https://x.com/i/status/'+id};
 }
 if(post.network!=='instagram'||!image)throw new Error('Instagram requires an approved image.');
 // Meta fetches images from public URLs. Use temporary provider storage, never expose the private dashboard.
 const jpeg=await sharp(image).flatten({background:'#ffffff'}).jpeg({quality:92}).toBuffer();
 const session=await composioRequest(ctx,'/api/v3.1/tool_router/session',{user_id:b.userId,toolkits:{enabled:[]},instant:false,manage_connections:{enable:false},workbench:{enable:true},proxy_execute:{enable:false}});
 const sessionId=requireId(session.session_id,/^trs_[\w-]+$/),path=post.id+'.jpg';
 const prefix='/api/v3.1/tool_router/session/'+sessionId+'/mounts/files/';
 const signed=await composioRequest(ctx,prefix+'upload_url',{mount_relative_path:path,mimetype:'image/jpeg'});
 const url=new URL(signed.upload_url);
 if(url.protocol!=='https:'||!['.amazonaws.com','.composio.dev','.r2.cloudflarestorage.com'].some(s=>url.hostname.endsWith(s)))throw new Error('Unexpected image storage URL.');
 const uploaded=await fetch(url,{method:'PUT',redirect:'error',signal:AbortSignal.timeout(60000),headers:{'content-type':'image/jpeg'},body:new Uint8Array(jpeg)});
 if(!uploaded.ok)throw new Error('Temporary image upload failed.');await uploaded.body?.cancel();
 const download=await composioRequest(ctx,prefix+'download_url',{mount_relative_path:path});
 const publicUrl=new URL(download.download_url);if(publicUrl.protocol!=='https:'||!['.amazonaws.com','.composio.dev','.r2.cloudflarestorage.com'].some(s=>publicUrl.hostname.endsWith(s)))throw new Error('Unexpected image download URL.');
 const container=await tool(ctx,b,'INSTAGRAM_CREATE_MEDIA_CONTAINER',{ig_user_id:b.actor,caption:post.copy,image_url:publicUrl.href,content_type:'photo'});
 const creationId=requireId(container.id,/^\d+$/);
 let ready=false;
 for(let i=0;i<15;i++){const status=await tool(ctx,b,'INSTAGRAM_GET_POST_STATUS',{creation_id:creationId});if(status.status_code==='FINISHED'){ready=true;break;}if(['ERROR','EXPIRED'].includes(status.status_code))break;await new Promise(r=>setTimeout(r,2000));}
 if(!ready)throw new Error('Instagram image processing did not finish. No publish retry was attempted.');
 const result=await tool(ctx,b,'INSTAGRAM_CREATE_POST',{ig_user_id:b.actor,creation_id:creationId});
 const id=requireId(result.id,/^\d+$/);
 // The ID is authoritative even if permalink lookup is unavailable.
 return {id};
}
