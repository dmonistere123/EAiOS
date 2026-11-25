import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { planner, PlannerRequestError } from '../adapters/planner';
import type { PlanSummary } from '../domain/planner';

export default function MyPlan({day,refresh}:{day:string;refresh:number}) {
 const [plan,setPlan]=useState<PlanSummary|null>(null);
 const [status,setStatus]=useState<'loading'|'sign-in'|'error'|'ready'>('loading');
 useEffect(()=>{
  const c=new AbortController();
  void planner.summary(day,c.signal).then(value=>{if(!c.signal.aborted){setPlan(value);setStatus('ready');}}).catch(e=>{if(!c.signal.aborted){setPlan(null);setStatus(e instanceof PlannerRequestError&&e.status===401?'sign-in':'error');}});
  return()=>c.abort();
 },[day,refresh]);
 const one=plan?.one;
 const progress=(lane:'three'|'five',cap:number)=>{const group=plan?.[lane];return group?.total?group.done+' of '+group.total+' done':cap+' slots open';};
 return <section aria-label="My Plan" className="rounded-xl border border-signal/25 bg-surface p-4">
  <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-sm font-semibold text-signal">My Plan</h2><p className="mt-1 text-xs text-ink-dim">What I’m choosing to accomplish.</p></div><Link className="rounded-lg border border-signal/40 px-3 py-2 text-xs text-signal" to="/daily-planner">Open Daily Planner →</Link></div>
  {status==='ready'?<div className="mt-3 grid gap-3 text-sm sm:grid-cols-[2fr_1fr_1fr]"><div><span className="block text-xs text-ink-faint">The One</span><span>{one?(one.state==='done'?'✓ ':'')+one.title:'Not selected'}</span></div><div><span className="block text-xs text-ink-faint">The Three</span>{progress('three',3)}</div><div><span className="block text-xs text-ink-faint">The Five</span>{progress('five',5)}</div></div>:<p className="mt-3 text-xs text-ink-dim">{status==='loading'?'Loading your plan…':status==='sign-in'?'Sign in to view your private plan.':'Your plan is unavailable. The rest of Today is unaffected.'}</p>}
 </section>;
}
