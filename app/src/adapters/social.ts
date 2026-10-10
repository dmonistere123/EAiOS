import type { SocialBoard, SocialBrief, SocialCapabilities, SocialPost } from '../domain/social';
async function request<T>(path: string, body?: unknown, method = 'POST'): Promise<T> {
  const res = await fetch('/api/social' + path, body === undefined ? {cache:'no-store'} : {method, headers:{'content-type':'application/json'},body:JSON.stringify(body)});
  const result = await res.json().catch(() => ({error:'Social Media is unavailable.'}));
  if(!res.ok) throw new Error(typeof result.error==='string'?result.error:'Social Media is unavailable.');
  return result;
}
/** No fallback: production errors must never look like generated or published content. */
export const social = {
  board: () => request<SocialBoard>(''),
  capabilities: () => request<SocialCapabilities>('/capabilities'),
  generate: (brief: SocialBrief, requestId: string, slotIndex?: number) => request<SocialPost[]>('/generate',{brief,requestId,slotIndex}),
  manual: (brief: SocialBrief, requestId: string) => request<SocialPost[]>('/manual',{brief,requestId}),
  edit: (post: SocialPost, action: 'edit'|'review'|'archive') => request<SocialPost>('/posts/'+post.id,{...post,action},'PUT'),
  image: (post: SocialPost, requestId: string) => request<SocialPost>('/posts/'+post.id+'/image',{revision:post.revision,requestId}),
  imageUrl: (post: SocialPost) => post.imageVersion ? '/api/social/images/'+post.imageVersion : '',
};
