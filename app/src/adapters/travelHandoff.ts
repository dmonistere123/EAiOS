import type { HumanDelegation, HumanChecklistItem } from '../domain/humanDelegation';
export type AssistantTaskView=Pick<HumanDelegation,'id'|'status'|'revision'|'instructions'|'checklist'|'completionNote'|'completionFeedback'>&{title?:string;assistant?:string};
async function json<T>(path:string,body?:unknown,token?:string):Promise<T>{
  const res=await fetch(path,{cache:'no-store',method:body===undefined?'GET':'POST',headers:{...(body!==undefined?{'content-type':'application/json'}:{}),...(token?{authorization:'Bearer '+token}:{})},...(body!==undefined?{body:JSON.stringify(body)}:{})});
  const value=await res.json();if(!res.ok)throw new Error(value.error??'Request failed.');return value;
}
export const travelHandoff={
  prepare:(tripId:string,contactId:string,instructions:string)=>json<{delegation:HumanDelegation;artifactId?:string;existing:boolean}>(`/api/travel/trips/${encodeURIComponent(tripId)}/handoff`,{contactId,instructions}),
};
export const assistantTask={
  load:(token:string)=>json<AssistantTaskView>('/api/assistant-task',undefined,token),
  save:(token:string,revision:number,items:HumanChecklistItem[])=>json<AssistantTaskView>('/api/assistant-task/checklist',{revision,items},token),
  submit:(token:string,revision:number,note:string)=>json<AssistantTaskView>('/api/assistant-task/completion',{revision,note},token),
  async itinerary(token:string){const res=await fetch('/api/assistant-task/itinerary',{headers:{authorization:'Bearer '+token},cache:'no-store'});if(!res.ok)throw new Error('Itinerary is unavailable.');return res.text();},
};
