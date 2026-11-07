import type {InsightsSnapshot,InsightReport} from '../domain/insights';
async function result<T>(response:Response):Promise<T>{const body=await response.json();if(!response.ok)throw new Error(body.error??'Executive Insights is unavailable.');return body;}
export const insights={
 read:(days:number,signal?:AbortSignal)=>fetch('/api/executive-insights?days='+days,{signal}).then(result<InsightsSnapshot>),
 generate:(days:number)=>fetch('/api/executive-insights/generate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({days})}).then(result<InsightReport>),
};
