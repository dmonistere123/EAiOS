import type { PodcastPromo, PromoSnapshot } from '../domain/podcastPromo';
async function request<T>(url:string,body?:unknown):Promise<T>{
  const response=await fetch(url,{method:body===undefined?'GET':'POST',headers:body===undefined?{}:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
  const result=await response.json();if(!response.ok)throw Error(result.error||'The video request failed.');return result;
}
export const podcastPromo={
  list:(id:string)=>request<PromoSnapshot>(`/api/podcasts/${encodeURIComponent(id)}/promos`),
  create:(id:string,input:{requestId:string;prompt?:string;scope?:string;baseId?:string})=>request<PodcastPromo>(`/api/podcasts/${encodeURIComponent(id)}/promos`,input),
  cancel:(id:string)=>request<PodcastPromo>(`/api/podcast-promos/${encodeURIComponent(id)}/cancel`,{}),
  media:(id:string,kind:'video'|'poster'|'captions')=>`/api/podcast-promos/${encodeURIComponent(id)}/${kind}`,
};
