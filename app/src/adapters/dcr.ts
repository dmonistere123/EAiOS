import type {DcrSnapshot,DcrFields,DcrRecord,DcrRequest,DcrArtifactPreview,DcrConnections,DcrSource,DcrWorkKind} from '../domain/dcr';
import type {Approval,ApprovalDecision,AuditResult} from '../domain/types';
async function request<T>(path='',body?:unknown):Promise<T>{const r=await fetch('/api/dcr'+path,{method:body===undefined?'GET':'POST',headers:body===undefined?{}:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});const value=await r.json();if(!r.ok)throw Error(value.error??'DCR unavailable.');return value;}
export const dcr={
 editFinding:(id:string,revision:number,fields:DcrFields)=>request('/findings/edit',{id,revision,fields}),
 saveFindingContact:(id:string,revision:number,contact:import('../domain/erm').ErmContactInput)=>request<import('../domain/erm').ErmContact>('/findings/contact',{id,revision,contact}),
 scan:()=>request('/scan',{}),
 pauseScan:(paused:boolean)=>request('/scan/pause',{paused}),
 decideFinding:(id:string,revision:number,decision:'confirm'|'dismiss',fields?:DcrFields)=>request('/findings/decide',{id,revision,decision,fields}),
 snapshot:()=>request<DcrSnapshot>(),
 connections:()=>request<DcrConnections>('/connections'),
 previewArtifact:(id:string)=>request<DcrArtifactPreview>('/artifacts/preview',{id}),
 selectArtifact:(preview:DcrArtifactPreview)=>request<DcrSource>('/artifacts/select',{id:preview.id,version:preview.version}),
 linkWork:(record:DcrRecord,kind:DcrWorkKind,id:string,version?:string,remove=false)=>request<DcrRecord>('/work-links',{recordId:record.id,revision:record.revision,kind,id,version,remove}),
 save:(fields:DcrFields,sourceIds:string[],linkedIds:string[],record?:DcrRecord)=>request<DcrRecord>('/records',{fields,sourceIds,linkedIds,id:record?.id,revision:record?.revision}),
 fromDecision:(record:DcrRecord,fields:DcrFields)=>request<DcrRecord>('/commitments/from-decision',{decisionId:record.id,revision:record.revision,fields}),
 addSource:(title:string,text:string)=>request('/sources',{title,text}),
 removeSource:(id:string)=>request('/sources/remove',{id}),
 ask:(prompt:string,recordId:string|null,sourceIds:string[],propose=false)=>request<DcrRequest>('/ask',{prompt,recordId,sourceIds,propose}),
 accept:(id:string,edits:DcrFields[],link:boolean)=>request<DcrRecord[]>('/accept',{id,edits,link}),
 dismiss:(id:string)=>request('/dismiss',{id}),
 prepare:(record:DcrRecord,body:string)=>request<{id:string}>('/prepare',{recordId:record.id,revision:record.revision,body}),
 approvals:()=>request<Approval[]>('/approvals'),
 decide:(id:string,decision:ApprovalDecision)=>request<AuditResult>('/decide',{id,...decision}),
};
