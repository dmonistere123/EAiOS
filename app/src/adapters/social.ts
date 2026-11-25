import type { Approval } from '../domain/types';
import type { SocialBoard, SocialBrief, SocialCapabilities, SocialPost, SocialConnectionChoice, SocialBinding } from '../domain/social';
async function request<T>(path: string, body?: unknown, method = 'POST'): Promise<T> {
  const res = await fetch('/api/social' + path, body === undefined ? {cache:'no-store'} : {method, headers:{'content-type':'application/json'},body:JSON.stringify(body)});
  const result = await res.json().catch(() => ({error:'Social Media is unavailable.'}));
  if(!res.ok) throw new Error(typeof result.error==='string'?result.error:'Social Media is unavailable.');
  return result;
}
/** No fallback: production errors must never look like generated or published content. */
export const social = {
  delete: (post:SocialPost) => request('/posts/'+post.id+'/delete',{revision:post.revision}),
  approvals: () => request<Approval[]>('/approvals'),
  decide: (id:string, body:{decision:string;reviewVersion?:string}) => request<{ok:boolean;auditEventId?:string;error?:{safeMessage:string}}>('/approvals/'+id.replace(/^social:/,'')+'/decision',body),
  submit: (post:SocialPost) => request('/posts/'+post.id+'/submit',{revision:post.revision}),
  choices: (id:string) => request<SocialConnectionChoice[]>('/accounts/'+id+'/choices'),
  connect: (id:string) => request<{url:string}>('/accounts/'+id+'/connect',{}),
  bind: (id:string,choice:SocialConnectionChoice) => request<SocialBinding>('/accounts/'+id+'/bind',{connectionId:choice.connectionId,confirmedActor:choice.actor}),
  board: () => request<SocialBoard>(''),
  capabilities: () => request<SocialCapabilities>('/capabilities'),
  generate: (brief: SocialBrief, requestId: string, slotIndex?: number) => request<SocialPost[]>('/generate',{brief,requestId,slotIndex}),
  manual: (brief: SocialBrief, requestId: string) => request<SocialPost[]>('/manual',{brief,requestId}),
  edit: (post: SocialPost, action: 'edit'|'review'|'archive') => request<SocialPost>('/posts/'+post.id,{...post,action},'PUT'),
  image: (post: SocialPost, requestId: string) => request<SocialPost>('/posts/'+post.id+'/image',{revision:post.revision,requestId}),
  imageUrl: (post: SocialPost) => post.imageVersion ? '/api/social/images/'+post.imageVersion : '',
};
