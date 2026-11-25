import type { ErmContact,ErmContactInput,ErmNote,ErmNoteInput,ErmPage,ErmStatus,ErmJob,ErmCsvMapping,ErmImportPreview,ErmImportReceipt,ErmAccount } from '../domain/erm';
const enabled=import.meta.env.VITE_HERMES_LIVE==='1'||import.meta.env.VITE_ERM_LIVE==='1';
async function api<T>(path:string,method='GET',body?:unknown,signal?:AbortSignal):Promise<T>{
 if(!enabled)throw new Error('Start the isolated E-CRM preview to save contacts and notes.');
 const r=await fetch('/api/erm/'+path,{method,signal,headers:body?{'Content-Type':'application/json'}:undefined,body:body?JSON.stringify(body):undefined});
 const data=await r.json();if(!r.ok)throw new Error(data.error??'E-CRM request failed.');return data;
}
export interface ErmAttachment {id:string;name:string;size:number;createdAt:string}
const noteRoute=(contact:string,note:string)=>'contacts/'+encodeURIComponent(contact)+'/notes/'+encodeURIComponent(note);
export const erm={
 status:()=>api<ErmStatus>('status'),
 contacts:(q='',cursor:string|null=null,archived=false,signal?:AbortSignal)=>api<ErmPage<ErmContact>>('contacts?'+new URLSearchParams({q,...(cursor?{cursor}:{}),archived:String(archived)}),'GET',undefined,signal),
 contact:(id:string,signal?:AbortSignal)=>api<ErmContact>('contacts/'+id,'GET',undefined,signal),
 saveContact:(contact:ErmContactInput,requestId:string,existing?:ErmContact)=>api<ErmContact>(existing?'contacts/'+existing.id:'contacts',existing?'PATCH':'POST',{contact,requestId,version:existing?.version}),
 archive:(contact:ErmContact,archived:boolean)=>api<ErmContact>('contacts/'+contact.id+'/archive','POST',{version:contact.version,archived}),
 notes:(id:string,cursor:string|null=null,signal?:AbortSignal)=>api<ErmPage<ErmNote>>('contacts/'+id+'/notes'+(cursor?'?cursor='+cursor:''),'GET',undefined,signal),
 note:(id:string,noteId:string,signal?:AbortSignal)=>api<ErmNote>('contacts/'+encodeURIComponent(id)+'/notes/'+encodeURIComponent(noteId),'GET',undefined,signal),
 saveNote:(id:string,note:ErmNoteInput,requestId:string,existing?:ErmNote)=>api<ErmNote>('contacts/'+id+'/notes'+(existing?'/'+existing.id:''),existing?'PATCH':'POST',{note,requestId,version:existing?.version}),
 noteAttachments:(contact:string,note:string)=>api<ErmAttachment[]>(noteRoute(contact,note)+'/attachments'),
 noteAttachmentUrl:(contact:string,note:string,id:string)=>'/api/erm/'+noteRoute(contact,note)+'/attachments/'+encodeURIComponent(id),
 uploadNoteAttachment:async(contact:string,note:string,file:File,requestId:string):Promise<ErmAttachment>=>{
  if(!enabled)throw new Error('E-CRM is not connected.');
  const r=await fetch('/api/erm/'+noteRoute(contact,note)+'/attachments?'+new URLSearchParams({name:file.name,requestId}),{method:'POST',headers:{'Content-Type':'application/octet-stream'},body:file});
  const data=await r.json();if(!r.ok)throw new Error(data.error??'Attachment could not be saved.');return data;
 },
 queueQuickEmail:(contact:string,note:string,draft:{connectionId:string;to:string;subject:string;body:string;requestId:string})=>api<{approvalId:string}>(noteRoute(contact,note)+'/quick-email','POST',draft),
 review:(id:string,signal?:AbortSignal)=>api<ErmJob|null>('contacts/'+id+'/review','GET',undefined,signal),
 analyze:(id:string,question:string,requestId:string)=>api<ErmJob>('contacts/'+id+'/analyze','POST',{question,requestId}),
 job:(id:string,signal?:AbortSignal)=>api<ErmJob>('jobs/'+id,'GET',undefined,signal),
 csvColumns:(text:string)=>api<{headers:string[];mapping:ErmCsvMapping}>('import/csv','POST',{text,inspect:true}),
 csvPreview:(text:string,mapping:ErmCsvMapping)=>api<ErmImportPreview>('import/csv','POST',{text,mapping}),
 accounts:()=>api<ErmAccount[]>('import/accounts'),
 outlookPreview:(connectionId:string,cursor?:string)=>api<ErmImportPreview>('import/outlook','POST',{connectionId,cursor}),
 importContacts:(previewId:string,selected:string[],requestId:string)=>api<ErmImportReceipt>('import/commit','POST',{previewId,selected,requestId}),
};
