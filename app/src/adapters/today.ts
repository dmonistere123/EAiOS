import type { TodayActivity, TodayMeetings } from '../domain/today';
async function read<T>(path:string,signal?:AbortSignal):Promise<T>{
  const r=await fetch(path,{signal,cache:'no-store'});const data=await r.json();
  if(!r.ok)throw new Error(data.error??'Today is temporarily unavailable.');return data;
}
export const today={
  activity:(signal?:AbortSignal)=>read<TodayActivity>('/api/today/activity',signal),
  meetings:(start:string,end:string,signal?:AbortSignal)=>read<TodayMeetings>('/api/today/meetings?'+new URLSearchParams({start,end}),signal),
  async review(key:string):Promise<string[]> {
    const r=await fetch('/api/today/review',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({key})});const data=await r.json();
    if(!r.ok)throw new Error(data.error??'Could not save review status.');return data.reviewed;
  },
};
