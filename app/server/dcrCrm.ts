import type {KeyContext} from './apiKeys.ts';
import {DcrScannerStore} from './dcrScannerStore.ts';
import {insist} from './dcrStore.ts';
import {ErmStore} from './ermStore.ts';
import {ErmError,validateErmContact} from '../src/domain/erm.ts';
import {moduleConfig} from './modules.ts';

/** E-CRM's durable receipt prevents duplicates if the DCR update is interrupted. */
export function saveRelationshipContact(ctx:KeyContext,scanner:DcrScannerStore,input:Record<string,unknown>){
 const root=ctx.dataRoot??ctx.eaiosRoot;
 insist(moduleConfig(root).enabled.includes('erm'),'E-CRM is not enabled on this installation.',409);
 return scanner.store.transaction(()=>{
 const f=scanner.findings().find(f=>f.id===input.id);
 insist(f&&f.fields.kind==='relationship'&&!f.mergedInto,'Choose a detected relationship.',404);
 const crm=new ErmStore(root);
 if(f.crmContactId)return crm.contact(f.crmContactId);
 insist(f.state==='detected'&&f.revision===input.revision,'This detected item changed. Refresh and review it again.',409);
 try{
  const contact=crm.createContact(validateErmContact(input.contact),'dcr-finding-'+f.id);
  crm.saveNote(contact.id,{title:'DCR relationship context',body:[f.fields.what,f.fields.why,f.fields.recommendation].filter(Boolean).join('\n\n'),includeInAI:false},'dcr-context-'+f.id);
   const current=scanner.findings().find(x=>x.id===f.id)!;
   insist(current.state==='detected'&&current.revision===f.revision,'Relationship changed. Refresh before continuing.',409);
   scanner.update({...current,crmContactId:contact.id,state:'dismissed',revision:current.revision+1,updatedAt:new Date().toISOString()});
   scanner.store.audit(f.id,'relationship_saved_to_crm',contact.id);
  return contact;
 }catch(e){if(e instanceof ErmError)insist(false,e.message,e.status);throw e;}
 });
}
