import type { TripConversationResult } from '../domain/travelConversation';
import type { TravelShortlist } from '../domain/travelGuide';
async function request<T>(path:string,body?:unknown):Promise<T> {
  const res=await fetch('/api/travel'+path,{method:body===undefined?'GET':'POST',cache:'no-store',headers:body===undefined?{}:{'content-type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});
  const result=await res.json();if(!res.ok)throw new Error(result.error||'Travel planning is unavailable.');return result;
}
export const tripConversation={
  send:(id:string,message:string,initial=false,optionIds:string[]=[])=>request<TripConversationResult>(`/trips/${encodeURIComponent(id)}/conversation`,{message,initial,optionIds}),
  recommendations:async(id:string,kinds:TravelShortlist['kind'][]) => (await request<{shortlists:TravelShortlist[]}>(`/trips/${encodeURIComponent(id)}/recommendations?kinds=${kinds.join(',')}`)).shortlists,
};
