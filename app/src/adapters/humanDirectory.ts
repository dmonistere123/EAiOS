import type { HumanContact, HumanDirectoryAdapter } from '../domain/humanDelegation';
async function request<T>(path: string,method='GET',body?: unknown): Promise<T> {
  const res=await fetch('/api/human-contacts'+path,{method,cache:'no-store',...(body===undefined?{}:{headers:{'content-type':'application/json'},body:JSON.stringify(body)})});
  const value=await res.json();if(!res.ok)throw new Error(value.error??'Human assistant directory unavailable.');return value;
}
/** No localStorage, provider credentials or live-to-mock fallback. */
export const liveHumanDirectory: HumanDirectoryAdapter={
  listContacts:()=>request<HumanContact[]>(''),
  createContact:input=>request<HumanContact>('','POST',input),
  updateContact:(id,input,revision)=>request<HumanContact>('/'+encodeURIComponent(id),'PATCH',{...input,revision}),
  retireContact:(id,revision)=>request<HumanContact>('/'+encodeURIComponent(id),'DELETE',{revision}),
};

async function delegationRequest<T>(path:string,body?:unknown):Promise<T>{
 const r=await fetch('/api/human-delegations'+path,{cache:'no-store',...(body===undefined?{}:{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)})});const data=await r.json();if(!r.ok)throw new Error(data.error??'Human delegation request failed.');return data;
}
export const humanDelegation = {
  changeSender:(id:string,connectionId:string,expectedBody:string)=>delegationRequest('/'+encodeURIComponent(id)+'/sender',{connectionId,expectedBody}),
  status:(id:string,revision:number,status:string)=>delegationRequest<import('../domain/humanDelegation').HumanDelegation>('/'+encodeURIComponent(id)+'/status',{revision,status}),
  attachments:(taskId:string)=>delegationRequest<Omit<import('../domain/humanDelegation').HumanDelegationArtifact,'contentHash'>[]>('/attachments?taskId='+encodeURIComponent(taskId)),
  approvals:()=>delegationRequest<import('../domain/types').Approval[]>('/approvals'),
  submit:(id:string,revision:number,artifactIds:string[])=>delegationRequest<import('../domain/humanDelegation').HumanDelegation>('/'+encodeURIComponent(id)+'/submit',{revision,artifactIds}),
  decide:(id:string,input:import('../domain/types').ApprovalDecision)=>delegationRequest<import('../domain/types').AuditResult>('/'+encodeURIComponent(id.replace(/^human:/,''))+'/decision',input),
  async list():Promise<import('../domain/humanDelegation').HumanDelegation[]> {
    const r=await fetch('/api/human-delegations',{cache:'no-store'});const data=await r.json();
    if(!r.ok)throw new Error(data.error??'Could not load delegations.');return data;
  },
  async prepare(input:{workItemId:string;contactId:string;instructions:string;dueAt?:string}):Promise<import('../domain/humanDelegation').HumanDelegation> {
    const r=await fetch('/api/human-delegations/drafts',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(input)});
    const data=await r.json();if(!r.ok)throw new Error(data.error??'Could not prepare delegation.');return data;
  },
};
