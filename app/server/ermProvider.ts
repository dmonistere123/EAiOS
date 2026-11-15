import { mailboxChoices,verifyMailbox,mailComposioRequest } from './mailRouting.ts';
import type { ApiContext } from './httpApi.ts';
import { ErmError,emptyErmContact,validateErmContact } from '../src/domain/erm.ts';
import type { ErmAccount,ErmCandidate } from '../src/domain/erm.ts';
const BASE='https://graph.microsoft.com/v1.0/me/contacts';
const SELECT='id,displayName,givenName,surname,companyName,jobTitle,emailAddresses,businessPhones,homePhones,mobilePhone,businessAddress,homeAddress,otherAddress,businessHomePage';
export function contactsEndpoint(cursor?:string):string {
 if(!cursor)return BASE+'?'+new URLSearchParams({'$top':'100','$select':SELECT});
 if(typeof cursor!=='string'||cursor.length>12000||!/^[\w-]+$/.test(cursor))throw new ErmError(400,'invalid_cursor','Invalid Outlook contacts cursor.');
 let url:URL;try{url=new URL(Buffer.from(cursor,'base64url').toString('utf8'));}catch{throw new ErmError(400,'invalid_cursor','Invalid Outlook contacts cursor.');}
 if(url.origin!=='https://graph.microsoft.com'||url.pathname!=='/v1.0/me/contacts'||url.username||url.password||url.hash||[...url.searchParams.keys()].some(k=>!['$skiptoken','$skip','$top','$select'].includes(k)))throw new ErmError(400,'invalid_cursor','Invalid Outlook contacts cursor.');
 url.searchParams.set('$top','100');url.searchParams.set('$select',SELECT);return url.href;
}
export function outlookContact(value:Record<string,unknown>) {
 const str=(x:unknown)=>typeof x==='string'?x:'';const c=emptyErmContact();
 c.name=str(value.displayName)||[str(value.givenName),str(value.surname)].filter(Boolean).join(' ');c.company=str(value.companyName);c.title=str(value.jobTitle);
 c.emails=Array.isArray(value.emailAddresses)?value.emailAddresses.map(x=>str(x?.address)).filter(Boolean):[];
 c.phones=[{label:'Mobile',value:str(value.mobilePhone)},...(Array.isArray(value.businessPhones)?value.businessPhones.map(x=>({label:'Work',value:str(x)})):[]),...(Array.isArray(value.homePhones)?value.homePhones.map(x=>({label:'Home',value:str(x)})):[])].filter(x=>x.value);
 c.addresses=(['businessAddress','homeAddress','otherAddress'] as const).flatMap((key,i)=>{const a=value[key] as Record<string,unknown>|undefined;if(!a||typeof a!=='object')return [];const address={label:['Work','Home','Other'][i],street:str(a.street),line2:'',city:str(a.city),region:str(a.state),postal:str(a.postalCode),country:str(a.countryOrRegion)};return Object.entries(address).some(([k,v])=>k!=='label'&&v)?[address]:[];});
 c.website=str(value.businessHomePage);if(c.website&&!/^https?:\/\//i.test(c.website))c.website='https://'+c.website;return validateErmContact(c);
}
export async function ermAccounts(ctx:ApiContext):Promise<ErmAccount[]> { const choices=await mailboxChoices(ctx);return choices.filter(c=>c.mailbox?.provider==='outlook'||c.error).map(c=>({connectionId:c.connectionId,email:c.mailbox?.email,error:c.error})); }
export async function readOutlookContacts(ctx:ApiContext,connectionId:string,cursor?:string):Promise<{items:ErmCandidate[];account:string;nextCursor?:string}> {
 const endpoint=contactsEndpoint(cursor),identity=await verifyMailbox(ctx,connectionId);if(identity.provider!=='outlook')throw new ErmError(400,'wrong_provider','Choose an Outlook account.');
 const r=await mailComposioRequest(ctx,'/api/v3.1/tools/execute/proxy',{connected_account_id:connectionId,endpoint,method:'GET',parameters:[{name:'Prefer',value:'IdType="ImmutableId"',type:'header'}]});
 if(r.status===403)throw new ErmError(403,'contacts_permission','Outlook denied contact access. Check Contacts.Read permission in Connections. Manual and CSV entry remain available.');
 if(r.status===401)throw new ErmError(401,'connection_expired','Reconnect this Outlook account in Connections.');
 if(r.status===429)throw new ErmError(429,'provider_throttled','Outlook is rate-limiting contact reads. Wait before trying again.');
 if(r.status!==200||!Array.isArray(r.data?.value)||r.data.value.length>100)throw new ErmError(502,'provider_unavailable','Outlook contacts could not be read. No contacts were imported.');
 const items:ErmCandidate[]=r.data.value.map((value:Record<string,unknown>)=>{if(typeof value.id!=='string'||value.id.length>1000)throw new ErmError(502,'invalid_provider_response','Outlook returned a contact without a valid identifier.');try{return {id:value.id,contact:outlookContact(value)};}catch{return {id:value.id,error:'This contact has missing or invalid contact information. Add it manually after review.'};}});
 let nextCursor:string|undefined;if(r.data['@odata.nextLink']){if(typeof r.data['@odata.nextLink']!=='string')throw new ErmError(502,'invalid_provider_response','Outlook pagination was incomplete.');nextCursor=Buffer.from(r.data['@odata.nextLink']).toString('base64url');contactsEndpoint(nextCursor);}
 return {items,account:connectionId+':'+identity.providerUserId,nextCursor};
}
