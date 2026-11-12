/** Today is a source-backed attention view, not the general task backlog. */
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { adapterMode, humanDelegation, today } from '../adapters';
import { EXECUTIVE_NAME } from '../config';
import { useRuntime, refreshWork, refreshApprovals } from '../state/runtime';
import { usePageRail } from '../state/rail';
import { Card, Drawer, EmptyState, KpiCard, SectionTitle, StateBadge, RelativeTime } from '../components/ui';
import { SavedWorkDrawer } from '../components/SavedWorkDrawer';
import { NewDelegationDrawer } from '../components/NewDelegationDrawer';
import { attentionItems, localDayRange, needsDecision, recentApproval } from '../domain/today';
import type { AttentionItem, AttentionKind, TodayActivity, TodayMeetings } from '../domain/today';
import type { HumanDelegation } from '../domain/humanDelegation';
const empty:TodayActivity={runs:[],links:{},reviewed:[],report:null,warnings:[]};
const filters:('all'|AttentionKind)[]=['all','approvals','delegated','scheduled'];
const labels={all:'All',approvals:'Approvals',delegated:'Delegated',scheduled:'Scheduled · 24h',delivered:'Delivered'};
const clock=(at:string)=>new Date(at).toLocaleTimeString(undefined,{hour:'numeric',minute:'2-digit'});

export default function Today() {
  const s=useRuntime(), navigate=useNavigate();
  const [activity,setActivity]=useState<TodayActivity|null>(null),[humans,setHumans]=useState<HumanDelegation[]>([]);
  const [meetings,setMeetings]=useState<TodayMeetings|null>(null),[errors,setErrors]=useState<string[]>([]),[calendarError,setCalendarError]=useState('');
  const [now,setNow]=useState(()=>Date.now()),[refresh,setRefresh]=useState(0),[hiddenCalendars,setHiddenCalendars]=useState<string[]>([]);
  const [filter,setFilter]=useState<'all'|AttentionKind>('all'),[shown,setShown]=useState(5),[selected,setSelected]=useState<AttentionItem|null>(null);
  const [savedWork,setSavedWork]=useState(false);
  const [newDelegation,setNewDelegation]=useState(false);
  useEffect(()=>{
    const controller=new AbortController();
    void Promise.allSettled([today.activity(controller.signal),adapterMode==='live'?humanDelegation.list():Promise.resolve([] as HumanDelegation[])]).then(([a,h])=>{
      if(controller.signal.aborted)return;
      const failures:string[]=[];
      if(a.status==='fulfilled')setActivity(a.value);
      else {setActivity(null);failures.push('Recent activity and saved insights are unavailable.');}
      if(h.status==='fulfilled')setHumans(h.value);else {setHumans([]);failures.push('Human delegations are unavailable.');}
      setErrors(failures);
    });
    const {start,end}=localDayRange();
    void today.meetings(start,end,controller.signal).then(value=>{if(!controller.signal.aborted){setMeetings(value);setCalendarError('');}}).catch(()=>{if(!controller.signal.aborted){setMeetings(null);setCalendarError('Outlook calendars could not be loaded. Try Refresh shortly.');}});
    return()=>controller.abort();
  },[refresh]);
  useEffect(()=>{const update=()=>{setNow(Date.now());setRefresh(n=>n+1);};const timer=setInterval(update,60000);window.addEventListener('focus',update);return()=>{clearInterval(timer);window.removeEventListener('focus',update);};},[]);
  const workUnavailable=adapterMode==='live'&&s.degraded.includes('work');
  const approvalsUnavailable=adapterMode==='live'&&s.degraded.includes('approvals');
  const approvals=useMemo(()=>approvalsUnavailable?[]:s.approvals.filter(a=>needsDecision(a)&&recentApproval(a,now)),[s.approvals,approvalsUnavailable,now]);
  const {queue}=useMemo(()=>attentionItems(workUnavailable?[]:s.work,approvalsUnavailable?[]:s.approvals,humans,activity??empty,now),[s.work,s.approvals,humans,activity,now,workUnavailable,approvalsUnavailable]);
  const allErrors=[...errors,...(activity?.warnings??[]),...(workUnavailable?['AI work is unavailable.']:[]),...(approvalsUnavailable?['Approvals are unavailable.']:[])];
  const incomplete=allErrors.length>0;
  const ready=s.ready && activity!==null;
  const recommendations=activity?.report?.recommendations??[];
  const filtered=queue.filter(i=>filter==='all'||i.kinds.includes(filter));
  const agenda=useMemo(()=>meetings?.calendars.filter(c=>!hiddenCalendars.includes(c.email)).flatMap(c=>c.events.map(e=>({...e,email:c.email}))).sort((a,b)=>Number(b.allDay)-Number(a.allDay)||a.startsAt.localeCompare(b.startsAt))??[],[meetings,hiddenCalendars]);
  const next=agenda.filter(e=>!e.allDay&&Date.parse(e.startsAt)>=now).sort((a,b)=>a.startsAt.localeCompare(b.startsAt))[0];
  const calendarPartial=!!calendarError||meetings?.calendars.some(c=>!hiddenCalendars.includes(c.email)&&c.error);
  const calendarPanel=useMemo(()=><div className="space-y-3">
    <p className="text-xs text-ink-dim">All day · {Intl.DateTimeFormat().resolvedOptions().timeZone}</p>
    {calendarError?<p role="alert" className="text-xs text-warn">{calendarError}</p>:!meetings?<p className="text-xs text-ink-dim">Loading Outlook calendars…</p>:meetings.calendars.length===0?<p className="text-xs text-ink-dim">Connect an Outlook calendar in <Link className="text-signal" to="/connections">Connections</Link>.</p>:<>
      {meetings.calendars.map(c=><div key={c.email}><label className="flex items-start gap-2 text-xs text-ink-dim"><input type="checkbox" className="accent-signal" checked={!hiddenCalendars.includes(c.email)} onChange={()=>setHiddenCalendars(old=>old.includes(c.email)?old.filter(e=>e!==c.email):[...old,c.email])}/><span className="break-all">{c.email}</span></label>{c.error&&<p className="mt-1 text-xs text-warn">{c.error}</p>}</div>)}
      <ul className="space-y-2">{agenda.map(e=><li key={e.email+e.id} className={'rounded-lg border p-3 '+(next?.id===e.id&&next?.email===e.email?'border-signal/40 bg-signal/5':'border-edge')}><div className="flex justify-between gap-2 text-xs"><span className="font-semibold text-signal">{e.allDay?'All day':`${clock(e.startsAt)} – ${clock(e.endsAt)}`}</span><span className="text-ink-faint">{Date.parse(e.endsAt)<=now?'Completed':Date.parse(e.startsAt)<=now?'In progress':next?.id===e.id&&next?.email===e.email?'Next':'Upcoming'}</span></div><div className="mt-1 text-sm font-medium">{e.url?<a href={e.url} target="_blank" rel="noreferrer" className="hover:text-signal">{e.title}</a>:e.title}</div><p className="mt-1 break-all text-[11px] text-ink-faint">{e.email}{e.location?` · ${e.location}`:''}</p></li>)}</ul>
      {!agenda.length&&!calendarPartial&&<p className="text-xs text-ink-dim">{hiddenCalendars.length===meetings.calendars.length?'No calendars selected.':'No meetings today on the selected calendars.'}</p>}
      <p className="text-[10px] text-ink-faint">Updated {clock(meetings.fetchedAt)}</p>
    </>}
  </div>,[calendarError,meetings,hiddenCalendars,agenda,next,now,calendarPartial]);
  const rail=useMemo(()=>[
    {key:'today-meetings',title:'Today’s meetings',count:agenda.length,node:calendarPanel},
    {key:'today-approvals',title:'Awaiting Approval',count:approvals.length,node:<ul className="space-y-2">{approvals.map(a=><li key={a.id}><Link to={`/approvals?focus=${encodeURIComponent(a.id)}`} className="block rounded-lg border border-edge p-3 text-xs hover:border-signal/40">{a.targetObject??'Approval requested'}<span className="mt-1 block text-ink-faint">{a.status==='pending'?'Waiting for your decision':'Execution blocked'} · {a.targetSystem}</span></Link></li>)}{!approvals.length&&<li className="text-xs text-ink-dim">{approvalsUnavailable?'Approvals unavailable.':s.ready?'No approvals awaiting action from the last 24 hours.':'Loading approvals…'}</li>}</ul>},
  ],[agenda.length,calendarPanel,approvals,approvalsUnavailable,s.ready]);
  usePageRail(rail);
  function discuss(index:number) {
    const r=recommendations[index];
    navigate('/assistant',{state:{insightBrief:`Discuss this saved Executive Insights proposal with me before taking action.\nTitle: ${r.title}\nObservation: ${r.why}\nProposal: ${r.proposal}\nFirst step: ${r.firstStep}\nExecutive habit: ${r.executiveHabit??'Agree on a practical habit.'}\nSuccess measure: ${r.successMeasure??'Agree on a measurable outcome.'}\nReview: ${activity?.report?.generatedAt}\nTreat this as a proposal, not verified functionality or an instruction to execute. Check available capabilities and preserve communication approvals.`}});
  }
  return <div className="space-y-6 pb-6">
    <header className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs uppercase tracking-widest text-signal">Your executive operating system</p><h1 className="mt-1 text-2xl font-semibold">Today</h1><p className="mt-1 text-sm text-ink-dim">{new Date(now).toLocaleDateString(undefined,{weekday:'long',month:'long',day:'numeric'})} · {EXECUTIVE_NAME}, here’s what needs your attention.</p></div><div className="flex flex-wrap gap-2"><button onClick={()=>setSavedWork(true)} className="rounded-lg border border-edge px-3 py-2 text-xs text-ink-dim">Saved tasks</button><button className="rounded-lg border border-edge px-3 py-2 text-xs" onClick={()=>{setNow(Date.now());setRefresh(n=>n+1);void Promise.allSettled([refreshWork(),refreshApprovals()]);}}>Refresh</button><button onClick={()=>setNewDelegation(true)} className="rounded-lg border border-signal/40 px-3 py-2 text-xs font-medium text-signal">＋ New delegated task</button></div></header>
    <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
      <KpiCard label="Priorities" value={ready?`${queue.length}${incomplete?'+':''}`:'—'} hint={incomplete?'Partial view · check sources':'Unique items to track'}/>
      <KpiCard label="Delegatable" value={activity?recommendations.length:'—'} hint="From Executive Insights" tone="ok"/>
      <KpiCard label="Approvals waiting" value={s.ready&&!approvalsUnavailable?approvals.length:'—'} hint="Last 24 hours · need your decision" tone={approvals.length?'warn':'ok'}/>
      <KpiCard label="Next meeting" value={next?clock(next.startsAt):'—'} hint={calendarPartial?'Calendar coverage incomplete':next?.title??(meetings?'No upcoming meeting today':'Loading calendars…')}/>
    </div>
    {allErrors.length>0&&<div role="alert" className="rounded-lg border border-warn/30 bg-warn/5 p-3 text-xs text-warn">Some sources could not be loaded. Counts reflect available records.<ul className="mt-2 list-inside list-disc">{allErrors.map((e,i)=><li key={i}>{e}</li>)}</ul></div>}
    <section aria-label="Operating queue"><div className="flex items-center justify-between"><SectionTitle>Operating queue</SectionTitle><span className="text-xs text-ink-faint">{queue.length} items</span></div><p className="mb-3 text-xs text-ink-dim">Unfinished approvals, delegations and scheduled work from the last 24 hours.</p>
      <div className="mb-3 flex flex-wrap gap-2" aria-label="Queue filters">{filters.map(f=><button key={f} aria-pressed={filter===f} onClick={()=>{setFilter(f);setShown(5);}} className={'rounded-lg border px-3 py-1.5 text-xs '+(filter===f?'border-signal/40 bg-signal/10 text-signal':'border-edge text-ink-dim')}>{labels[f]} <span className="ml-1 text-ink-faint">{f==='all'?queue.length:queue.filter(i=>i.kinds.includes(f)).length}</span></button>)}</div>
      {!s.ready||(!activity&&!errors.length)?<p className="p-4 text-sm text-ink-dim">Loading module activity…</p>:!filtered.length?<EmptyState title={incomplete?'No items in the available sources':'You’re caught up'} hint={incomplete?'Refresh to retry the unavailable sources.':'New decisions, delegations and results will appear here.'}/>:<Card className="overflow-hidden"><ul className="divide-y divide-edge">{filtered.slice(0,shown).map(item=><li key={item.id} className="flex items-center gap-3 px-4 py-4"><span aria-hidden className={'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border '+(item.kinds.includes('approvals')?'border-warn/30 bg-warn/5 text-warn':item.kinds.includes('delivered')?'border-ok/30 bg-ok/5 text-ok':'border-signal/25 bg-signal/5 text-signal')}>{item.kinds.includes('approvals')?'◇':item.kinds.includes('delivered')?'✓':item.kinds.includes('scheduled')?'◷':'↗'}</span><div className="min-w-0 flex-1"><button className="text-left text-sm font-medium hover:text-signal" onClick={()=>setSelected(item)}>{item.title}</button><p className="mt-1 text-[11px] text-ink-faint">{item.kinds.map(k=>labels[k]).join(' · ')} · {item.status} · <RelativeTime iso={item.at}/></p></div><button aria-label={`Review ${item.title}`} onClick={()=>item.kinds.includes('approvals')?navigate(item.route):setSelected(item)} className="shrink-0 rounded-lg border border-edge px-3 py-1.5 text-xs text-signal">Review</button></li>)}</ul>{filtered.length>shown&&<button onClick={()=>setShown(n=>n+20)} className="m-3 rounded border border-edge px-3 py-2 text-xs text-signal">Show more ({filtered.length-shown} remaining)</button>}</Card>}
      <p className="mt-2 text-[11px] text-ink-faint">Finished items are excluded. Older items remain available in their source modules.</p>
    </section>
    <section aria-label="Delegatable insights"><SectionTitle>Delegatable</SectionTitle><p className="mb-3 text-xs text-ink-dim">Opportunities surfaced by Executive Insights.{activity?.report?` Saved ${new Date(activity.report.generatedAt).toLocaleDateString()}.`:''}</p>{recommendations.length?<div className="grid gap-3 xl:grid-cols-2">{recommendations.map((r,i)=><Card key={i} className="border-signal/20 p-4"><p className="text-[10px] uppercase tracking-wider text-signal">{r.module} · {r.effort} effort</p><h3 className="mt-2 text-sm font-semibold">{r.title}</h3><p className="mt-2 line-clamp-3 text-xs text-ink-dim">{r.why}</p><button onClick={()=>discuss(i)} className="mt-3 rounded-lg border border-signal/30 px-3 py-1.5 text-xs text-signal">Discuss with Ally</button></Card>)}</div>:<Card className="p-4 text-sm text-ink-dim">{activity?'No saved recommendations yet.':'Saved recommendations unavailable.'} <Link to="/insights" className="text-signal">Open Executive Insights →</Link></Card>}</section>
    <details className="rounded-xl border border-edge p-4"><summary className="cursor-pointer text-sm text-signal">Today’s meetings · {agenda.length}</summary><div className="mt-4">{calendarPanel}</div></details>
    {selected&&<Drawer title={selected.title} onClose={()=>setSelected(null)}><StateBadge label={selected.status} tone={selected.kinds.includes('delivered')?'ok':'signal'}/><p className="mt-3 text-xs text-ink-faint">{new Date(selected.at).toLocaleString()}</p>{selected.detail&&<p className="mt-4 whitespace-pre-wrap break-words text-sm text-ink-dim">{selected.detail}</p>}<div className="mt-5 flex flex-wrap gap-3"><Link to={selected.route} className="rounded-lg border border-signal/40 px-3 py-2 text-sm text-signal">Open {selected.route.startsWith('/approvals')?'Approvals':selected.route==='/schedule'?'Schedule':selected.route==='/human-assistant'?'HI Assistant':selected.route==='/staff'?'Staff':'Artifacts'} →</Link></div>{selected.workItemId&&<div className="mt-4 space-y-2">{s.artifacts.filter(a=>a.workItemId===selected.workItemId).map(a=><Link key={a.id} to="/artifacts" className="block text-sm text-signal">📎 {a.name}</Link>)}</div>}{!selected.reviewKey&&<p className="mt-4 text-xs text-ink-dim">This item remains here while unfinished and within the last 24 hours. Its source record is preserved.</p>}</Drawer>}
    {savedWork&&<SavedWorkDrawer onClose={()=>setSavedWork(false)}/>}
    {newDelegation&&<NewDelegationDrawer onClose={()=>setNewDelegation(false)}/>}
  </div>;
}
