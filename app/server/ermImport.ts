import { ErmError,emptyErmContact,validateErmContact,ERM_FIELDS } from '../src/domain/erm.ts';
import type { ErmCsvMapping,ErmCandidate,ErmCsvField } from '../src/domain/erm.ts';
import { fingerprint } from './ermStore.ts';
export function parseCsv(text:string):{headers:string[];rows:string[][]} {
 if(typeof text!=='string'||Buffer.byteLength(text)>1000000)throw new ErmError(400,'csv_limit','CSV files must be smaller than 1 MB.');
 text=text.replace(/^\uFEFF/,'');const rows:string[][]=[];let row:string[]=[],cell='',quoted=false,closed=false;
 for(let i=0;i<text.length;i++){const c=text[i];if(quoted){if(c==='"'){if(text[i+1]==='"'){cell+='"';i++;}else{quoted=false;closed=true;}}else cell+=c;continue;}
  if(c==='"'){if(cell||closed)throw new ErmError(400,'invalid_csv','Unexpected quote in CSV.');quoted=true;continue;}
  if(c===','||c==='\n'||c==='\r'){row.push(cell);cell='';closed=false;if(c!==','){if(c==='\r'&&text[i+1]==='\n')i++;if(row.some(x=>x.trim()))rows.push(row);row=[];if(rows.length>501)throw new ErmError(400,'csv_limit','Import at most 500 contacts at a time.');}continue;}
  if(closed&&c.trim())throw new ErmError(400,'invalid_csv','Unexpected text after a CSV quote.');if(!closed)cell+=c;
 }
 if(quoted)throw new ErmError(400,'invalid_csv','A CSV quote is not closed.');if(cell||row.length){row.push(cell);if(row.some(x=>x.trim()))rows.push(row);}
 if(rows.length<2||rows.length>501)throw new ErmError(400,'invalid_csv','Include a header and between 1 and 500 contact rows.');
 const headers=rows.shift()!.map(h=>h.trim());if(headers.length>60||headers.some(h=>!h||h.length>150))throw new ErmError(400,'invalid_csv','Use between 1 and 60 named columns.');
 if(new Set(headers.map(h=>h.toLowerCase())).size!==headers.length)throw new ErmError(400,'invalid_csv','Duplicate CSV column names.');
 if(rows.some(r=>r.length!==headers.length))throw new ErmError(400,'invalid_csv','CSV rows must have the same number of columns as the header.');return {headers,rows};
}
const aliases:Record<ErmCsvField,string[]>={name:['name','fullname','displayname','contactname'],company:['company','companyname','organization'],title:['title','jobtitle','position'],email:['email','emailaddress','primaryemail','email1'],email2:['email2','secondaryemail','additionalemail','email2address'],mobile:['mobile','mobilephone','cell','cellphone'],workPhone:['phone','phonenumber','workphone','businessphone'],homePhone:['homephone'],street:['street','streetaddress','address','businessstreet'],line2:['line2','address2','suite'],city:['city','businesscity'],region:['state','region','province','businessstate'],postal:['zip','zipcode','postalcode','postal','businesspostalcode'],country:['country','businesscountryregion'],website:['website','webpage','businesshomepage'],preferred:['preferred','preferredcontactmethod']};
export function suggestCsvMapping(headers:string[]):ErmCsvMapping {const mapping:ErmCsvMapping={};for(const key of ERM_FIELDS){const h=headers.find(h=>aliases[key].includes(h.toLowerCase().replace(/[^a-z0-9]/g,'')));if(h)mapping[key]=h;}return mapping;}
export function csvContacts(text:string,provided?:ErmCsvMapping):{headers:string[];mapping:ErmCsvMapping;items:ErmCandidate[]} {
 const {headers,rows}=parseCsv(text),mapping=provided??suggestCsvMapping(headers);
 if(!mapping||typeof mapping!=='object'||Array.isArray(mapping)||!mapping.name||!headers.includes(mapping.name))throw new ErmError(400,'csv_mapping','Map a name column before importing.');
 for(const [key,value] of Object.entries(mapping))if(!ERM_FIELDS.includes(key as ErmCsvField)||typeof value!=='string'||!headers.includes(value))throw new ErmError(400,'csv_mapping','Choose valid CSV columns.');
 const items=rows.map((row):ErmCandidate=>{const get=(key:ErmCsvField)=>mapping[key]?row[headers.indexOf(mapping[key]!)].trim():'';const id=fingerprint(Object.fromEntries(ERM_FIELDS.map(k=>[k,get(k)])));
  try {const c=emptyErmContact();c.name=get('name');c.company=get('company');c.title=get('title');c.emails=[get('email'),get('email2')].filter(Boolean);c.phones=[{label:'Mobile',value:get('mobile')},{label:'Work',value:get('workPhone')},{label:'Home',value:get('homePhone')}].filter(x=>x.value);c.website=get('website');if(c.website&&!/^https?:\/\//i.test(c.website))c.website='https://'+c.website;c.preferred=get('preferred');const address={label:'Work',street:get('street'),line2:get('line2'),city:get('city'),region:get('region'),postal:get('postal'),country:get('country')};if(Object.entries(address).some(([k,v])=>k!=='label'&&v))c.addresses=[address];return {id,contact:validateErmContact(c)};}catch(error){return {id,error:error instanceof Error?error.message:'Invalid contact row.'};}
 });return {headers,mapping,items};
}
