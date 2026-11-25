import type { DayPlan, PlanSummary } from '../domain/planner';
const root='/api/daily-planner';
export const plannerPreviewEnabled=import.meta.env.VITE_PLANNER_PREVIEW==='1';
export class PlannerRequestError extends Error {
 status:number;
 constructor(status:number,message:string){super(message);this.status=status;}
}
async function call<T>(path:string,options?:RequestInit):Promise<T>{
 const r=await fetch(root+path,{...options,credentials:'same-origin',cache:'no-store'});
 const value=await r.json().catch(()=>null);
 if(!r.ok)throw new PlannerRequestError(r.status,value?.error??'Daily Planner is unavailable.');
 return value as T;
}
const q=(v:Record<string,string>)=>'?'+new URLSearchParams(v).toString();
export const planner={
 summary:(on:string,signal?:AbortSignal)=>call<PlanSummary>("/summary"+q({on}),{signal}),
 day:(on:string,signal?:AbortSignal)=>call<DayPlan>('/day'+q({on}),{signal}),
 session:()=>call<{owner:string|null}>('/session'),
 signIn:(passcode:string)=>call<{owner:string|null}>('/session',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({passcode})}),
 signOut:()=>call<{owner:null}>('/session',{method:'DELETE'}),
 agenda:<T>(on:string,view:string)=>call<T>('/agenda'+q({on,view})),
 history:<T>(id:string)=>call<T>('/history'+q({id})),
 crm:(contact?:string,note?:string)=>call<{contactId:string;noteId:string;title:string}|null>('/crm'+(contact&&note?q({contact,note}):'')),
 action:<T>(a:Record<string,unknown>,requestId:string=crypto.randomUUID())=>call<T>('/actions',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...a,requestId})}),
 upload:(task:string,file:File,upload=crypto.randomUUID())=>call('/attachments'+q({task,upload,name:file.name}),{method:'POST',body:file}),
 attachment:(id:string)=>root+'/attachments/'+encodeURIComponent(id),
};
