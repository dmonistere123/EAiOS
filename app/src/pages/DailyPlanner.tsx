import { AGENT_NAME } from '../config';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useOutletContext, useSearchParams } from 'react-router-dom';
import { plannerPreviewEnabled, planner, PlannerRequestError } from '../adapters/planner';
import { dayRatings, laneLabels, lanes, localDay, quickHits, repeatLabels, shareableTaskCsv, shiftDay, validPlannerDate } from '../domain/planner';
import type { DayPlan, Journal, Lane, PreviewDelegation, Task, TimeEntry } from '../domain/planner';
import { usePageRail } from '../state/rail';
const noRail:never[]=[];
const button='rounded-lg border border-edge px-3 py-2 text-xs hover:border-signal/50 disabled:opacity-50';
const primary=button+' bg-signal/10 text-signal font-semibold';
const input='w-full rounded-lg border border-edge bg-canvas px-3 py-2 text-sm text-ink';
const card='rounded-xl border border-edge bg-surface p-4';
const statusLabels={not_started:'Not started',in_progress:'In progress',blocked:'Blocked',done:'Done'} as const;
type Command=(a:Record<string,unknown>)=>Promise<boolean>;
type Edit='edit'|'place'|'follow'|'history'|'delegate';
const err=(e:unknown)=>e instanceof Error?e.message:'Daily Planner is unavailable.';
const hours=(seconds:number)=>{const h=Math.floor(seconds/3600),m=Math.floor(seconds%3600/60),s=seconds%60;return h+'h '+m+'m'+(s?' '+s+'s':'');};

function LaneSelect({value,onChange,label='Lane'}:{value:Lane;onChange:(value:Lane)=>void;label?:string}){
 return <label className="text-xs text-ink-dim">{label}<select aria-label={label} className={input} value={value} onChange={e=>onChange(e.target.value as Lane)}>{lanes.map(l=><option value={l} key={l}>{laneLabels[l]}</option>)}</select></label>;
}
function ReplaceSelect({tasks,lane,exclude,value,onChange}:{tasks:Task[];lane:Lane;exclude?:string;value:string;onChange:(s:string)=>void}){
 const eligible=tasks.filter(t=>t.lane===lane&&t.state!=='done'&&t.id!==exclude);
 if(lane==='backlog'||!eligible.length)return null;
 return <label className="text-xs text-ink-dim">If the lane is full<select value={value} className={input} onChange={e=>onChange(e.target.value)}><option value="">Do not replace</option>{eligible.map(t=><option value={t.id} key={t.id}>Move “{t.title}” to Backlog</option>)}</select></label>;
}
function Capture({on,tasks,send,source}:{on:string;tasks:Task[];send:Command;source?:{contactId:string;noteId:string;title:string}}){
 const [title,setTitle]=useState(''),[day,setDay]=useState(on),[ln,setLane]=useState<Lane>('backlog'),[replacement,setReplacement]=useState('');
 async function save(e:FormEvent){e.preventDefault();if(await send({op:source?'crm':'create',...(source??{}),title:source?.title??title,day,lane:ln,replacement}))setTitle('');}
 return <form className="flex flex-wrap items-end gap-3" onSubmit={save}>
  {!source&&<label className="min-w-48 flex-1 text-xs text-ink-dim">Task title<input className={input} value={title} onChange={e=>setTitle(e.target.value)} required maxLength={180} placeholder="What do you want to accomplish?"/></label>}
  <label className="text-xs text-ink-dim">Plan date<input type="date" className={input} required value={day} onChange={e=>{setDay(e.target.value);setReplacement('');}}/></label>
  <LaneSelect value={ln} onChange={v=>{setLane(v);setReplacement('');}}/>
  {day===on&&<ReplaceSelect tasks={tasks} lane={ln} value={replacement} onChange={setReplacement}/>}
  <button className={primary}>{source?'Add to My Plan':'Add task'}</button>
 </form>;
}
function DelegateForm({title,files,submit,cancel}:{title:string;files:DayPlan['files'][string];submit:Command;cancel:()=>void}){
 const [recipient,setRecipient]=useState('ally'),[objective,setObjective]=useState(''),[expected,setExpected]=useState('');
 const [shareTaskNotes,setShare]=useState(false),[selected,setSelected]=useState<string[]>([]);
 return <form className="mt-3 grid gap-2 rounded-lg border border-edge p-3" onSubmit={async e=>{e.preventDefault();if(await submit({op:'delegate',recipient,objective,expected,shareTaskNotes,files:selected}))cancel();}}>
  <p className="text-xs text-ink-dim">Preview only. No message will be sent and no agent will run.</p>
  <label className="text-xs">Recipient<select className={input} value={recipient} onChange={e=>setRecipient(e.target.value)}><option value="ally">{AGENT_NAME} (simulated)</option><option value="human">Sample human assignee (simulated)</option></select></label>
  <label className="text-xs">Objective<input className={input} value={objective} onChange={e=>setObjective(e.target.value)} required maxLength={1200}/></label>
  <label className="text-xs">Expected result<input className={input} value={expected} onChange={e=>setExpected(e.target.value)} required maxLength={1200}/></label>
  <p className="text-xs">Included: task title “{title}”. Only check the additional context you want to include in the simulation.</p>
  <label className="text-xs"><input type="checkbox" checked={shareTaskNotes} onChange={e=>setShare(e.target.checked)}/> Include task notes</label>
  {files?.map(f=><label className="text-xs" key={f.id}><input type="checkbox" checked={selected.includes(f.id)} onChange={e=>setSelected(e.target.checked?[...selected,f.id]:selected.filter(id=>id!==f.id))}/> Include {f.name}</label>)}
  <div className="flex gap-2"><button className={primary}>Create preview handoff</button><button type="button" className={button} onClick={cancel}>Cancel</button></div>
 </form>;
}
function TaskRow({t,tasks,files,work,send,reload,fail}:{t:Task;tasks:Task[];files:DayPlan['files'][string];work?:PreviewDelegation;send:Command;reload:()=>void;fail:(e:unknown)=>void}){
 const [mode,setMode]=useState<Edit|null>(null),[title,setTitle]=useState(t.title),[detail,setDetail]=useState(t.detail),[due,setDue]=useState(t.due);
 const [to,setTo]=useState(t.day),[ln,setLane]=useState<Lane>(t.lane),[replacement,setReplacement]=useState('');
 const [completion,setCompletion]=useState<string|null>(null);
 const [shareable,setShareable]=useState(Boolean(t.shareable)),[repeat,setRepeat]=useState<keyof typeof repeatLabels>(t.repeat?.kind??'none');
 const [starts,setStarts]=useState(t.repeat?.startsOn??shiftDay(t.day,1)),[ends,setEnds]=useState(t.repeat?.endsOn??'');
 const [events,setEvents]=useState<{at:string;event:string;task:Task}[]>([]);
 const act=(a:Record<string,unknown>)=>send({id:t.id,revision:t.revision,...a});
 function open(next:Edit){
  setTitle(t.title);setDetail(t.detail);setDue(t.due);setTo(next==='follow'?shiftDay(t.day,1):t.day);setLane(next==='follow'?'backlog':t.lane);setReplacement('');setMode(next);
  if(next==='edit'){setShareable(Boolean(t.shareable));setRepeat(t.repeat?.kind??'none');setStarts(t.repeat?.startsOn??shiftDay(t.day,1));setEnds(t.repeat?.endsOn??'');}
  if(next==='history')void planner.history<typeof events>(t.id).then(setEvents).catch(fail);
 }
 async function save(e:FormEvent){
  e.preventDefault();
  const a=mode==='edit'?{op:'edit',title,detail,due,shareable,repeatKind:repeat,repeatStartsOn:starts,repeatEndsOn:ends}:{op:mode,day:to,lane:ln,replacement};
  if(await act(a))setMode(null);
 }
 return <li className="border-t border-edge py-3 first:border-t-0">
  <div className="flex items-start gap-2">
   <input type="checkbox" aria-label={'Mark '+t.title+' '+(t.state==='done'?'open':'done')} checked={t.state==='done'} onChange={()=>{if(t.state==='done')void act({op:'state',state:'not_started'});else setCompletion('');}} className="mt-1 accent-signal"/>
   <div className="min-w-0 flex-1"><p className={'break-words text-sm font-medium '+(t.state==='done'?'text-ink-dim line-through':'')}>{t.title}</p>
    <p className="text-xs text-ink-faint">{[t.parentId?'Follow-up':'',t.occurrence?'Recurring task':t.repeat?'Repeats '+repeatLabels[t.repeat.kind].toLowerCase():'',t.shareable?'Shareable':'',t.carryAge?'Carried '+t.carryAge+'×':'',t.due?'Due '+t.due:'',statusLabels[t.state]].filter(Boolean).join(' · ')}</p>
    {t.detail&&<p className="my-2 whitespace-pre-wrap break-words text-xs text-ink-dim">{t.detail}</p>}
    {t.source&&<Link className="text-xs text-signal" to={'/erm?'+new URLSearchParams({contact:t.source.contactId,note:t.source.noteId})}>Open E-CRM source note</Link>}
    {!!files?.length&&<ul className="my-2 space-y-1">{files.map(f=><li key={f.id}><a className="text-xs text-signal" href={planner.attachment(f.id)} download={f.name}>{f.name} ({Math.ceil(f.size/1024)} KB)</a></li>)}</ul>}
   </div>
  </div>
  {completion!==null&&<form aria-label="Complete task" className="ml-6 mt-2 grid gap-2 rounded-lg border border-edge p-3" onSubmit={async e=>{
   e.preventDefault();if(await act(completion?{op:'follow',day:completion,lane:'backlog'}:{op:'state',state:'done'}))setCompletion(null);
  }}>
   <p className="text-sm">Mark “{t.title}” done?</p>
   <label className="text-xs text-ink-dim">Follow-up date (optional)<input className={input} type="date" min={shiftDay(t.day>localDay()?t.day:localDay(),1)} value={completion} onChange={e=>setCompletion(e.target.value)}/></label>
   <p className="text-xs text-ink-dim">Leave the date blank to finish now. A dated follow-up returns in Backlog.</p>
   <div className="flex flex-wrap gap-2"><button className={primary}>{completion?'Done & schedule follow-up':'Mark done'}</button><button type="button" className={button} onClick={()=>setCompletion(null)}>Cancel</button></div>
  </form>}
  {plannerPreviewEnabled&&work&&<div className="ml-6 mt-2 space-y-2 rounded border border-signal/25 p-2 text-xs">
   <p>{work.recipient==='ally'?AGENT_NAME:'Sample human assignee'} · {work.state==='review'?'Result ready for review':work.state} · synthetic</p>
   {!!work.result&&<p>{work.result}</p>}
   {work.state==='pending'&&<button className={button} onClick={()=>void act({op:'mock-deliver',workId:work.id})}>Simulate result</button>}
   {work.state==='review'&&<div className="flex gap-2"><button className={primary} onClick={()=>void act({op:'delegate-decide',workId:work.id,accept:true})}>Accept and complete task</button><button className={button} onClick={()=>void act({op:'delegate-decide',workId:work.id,accept:false})}>Reject result</button></div>}
  </div>}
  <details className="ml-6 mt-2"><summary className="cursor-pointer text-xs text-ink-dim">Task actions</summary>
   <div className="mt-2 flex flex-wrap items-center gap-1.5">
    <button className={button} onClick={()=>open('edit')}>Edit</button>
    <button className={button} onClick={()=>open('place')}>Move or schedule</button>
    {t.state!=='done'&&<button className={button} onClick={()=>open('follow')}>Done + follow-up</button>}
    <button className={button} onClick={()=>open('history')}>Task history</button>
    {plannerPreviewEnabled&&t.state!=='done'&&(!work||work.state==='rejected')&&<button className={button} onClick={()=>open('delegate')}>Delegate · preview</button>}
    <button className={button} onClick={()=>void act({op:'order',direction:'up'})} aria-label="Move up">↑</button>
    <button className={button} onClick={()=>void act({op:'order',direction:'down'})} aria-label="Move down">↓</button>
    <button className={button} onClick={()=>void act({op:'archive'})}>Archive</button>
    <label className="text-xs text-ink-dim">Status<select className={input} aria-label={'Status for '+t.title} value={t.state} onChange={e=>{if(e.target.value==='done'&&t.state!=='done')setCompletion('');else void act({op:'state',state:e.target.value});}}>{Object.entries(statusLabels).map(([k,v])=><option value={k} key={k}>{v}</option>)}</select></label>
    <label className="text-xs text-ink-dim">Attach file <input type="file" aria-label={'Attach file to '+t.title} className="block max-w-48 text-xs" accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.png,.jpg,.jpeg" onChange={e=>{const f=e.target.files?.[0];e.target.value='';if(f)void planner.upload(t.id,f).then(reload).catch(fail);}}/></label>
   </div>
   {mode==='delegate'?<DelegateForm title={t.title} files={files} submit={act} cancel={()=>setMode(null)}/>:mode==='history'?<div className="mt-3 text-xs"><button className={button} onClick={()=>setMode(null)}>Close history</button><ul className="my-2 space-y-1">{events.map((e,i)=><li key={i}>{e.event} · {e.task.day} · {laneLabels[e.task.lane]} · {new Date(e.at).toLocaleString()}</li>)}</ul></div>:mode&&<form onSubmit={save} className="mt-3 grid gap-2">
    {mode==='edit'?<><label className="text-xs">Title<input className={input} value={title} onChange={e=>setTitle(e.target.value)} required maxLength={180}/></label><label className="text-xs">Task notes<textarea className={input} value={detail} onChange={e=>setDetail(e.target.value)} maxLength={8000}/></label><label className="text-xs">Due date (optional)<input type="date" className={input} value={due} onChange={e=>setDue(e.target.value)}/></label>
     <label className="text-xs"><input type="checkbox" checked={shareable} onChange={e=>setShareable(e.target.checked)}/> Shareable in CSV export</label>
     {!t.occurrence&&<><label className="text-xs">Repeat<select className={input} value={repeat} onChange={e=>setRepeat(e.target.value as keyof typeof repeatLabels)}>{Object.entries(repeatLabels).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label>
     {repeat!=='none'&&<><label className="text-xs">Repeat starts<input type="date" className={input} min={shiftDay(t.day,1)} required value={starts} onChange={e=>setStarts(e.target.value)}/></label><label className="text-xs">Repeat ends (optional)<input type="date" className={input} min={starts} value={ends} onChange={e=>setEnds(e.target.value)}/></label></>}</>}
     </>:<>
     <label className="text-xs">{mode==='follow'?'Follow-up date':'Plan date'}<input type="date" className={input} value={to} onChange={e=>{setTo(e.target.value);setReplacement('');}} required/></label>
     <LaneSelect value={ln} onChange={v=>{setLane(v);setReplacement('');}}/>
     {to===t.day&&<ReplaceSelect tasks={tasks} lane={ln} exclude={t.id} value={replacement} onChange={setReplacement}/>}
     {mode==='follow'&&<p className="text-xs text-ink-dim">Completes this task and creates one new linked task. Files remain on the original.</p>}
    </>}
    <div className="flex gap-2"><button className={primary}>{mode==='follow'?'Complete and schedule':'Save task'}</button><button className={button} type="button" onClick={()=>setMode(null)}>Cancel</button></div>
   </form>}
  </details>
 </li>;
}
const journalFields=['notes','gratitude','reflection','legacy','hits','rating'] as const;
type SaveJournal=(day:string,patch:Record<string,unknown>,baseline:Record<string,unknown>)=>Promise<Journal>;
function JournalPanel({journal,day,saveJournal}:{journal:Journal;day:string;saveJournal:SaveJournal}){
 const [draft,setDraft]=useState(journal),[saved,setSaved]=useState(journal);
 const [saving,setSaving]=useState(false),[saveError,setSaveError]=useState('');
 const inFlight=useRef(false);
 // Keep draft edits when a task or a timestamped note reloads the day.
 const effective=journal.revision>saved.revision?journal:saved;
 const dirty=journalFields.filter(k=>JSON.stringify(draft[k])!==JSON.stringify(saved[k]));
 const persist=useCallback(async ()=>{
  if(inFlight.current)return true;
  const changed=journalFields.filter(k=>JSON.stringify(draft[k])!==JSON.stringify(saved[k]));
  if(!changed.length)return true;
  inFlight.current=true;setSaving(true);setSaveError('');
  try{
   const updated=await saveJournal(day,Object.fromEntries(changed.map(k=>[k,draft[k]])),Object.fromEntries(changed.map(k=>[k,saved[k]])));
   setSaved(updated);
   setDraft(current=>{
    const next={...updated};
    for(const k of journalFields)if(JSON.stringify(current[k])!==JSON.stringify(draft[k]))Object.assign(next,{[k]:current[k]});
    return next;
   });
   return true;
  }catch(e){setSaveError(err(e));return false;}
  finally{inFlight.current=false;setSaving(false);}
 },[draft,saved,day,saveJournal]);
 useEffect(()=>{
  if(!dirty.length||saveError||saving)return;
  const timer=window.setTimeout(()=>void persist(),500);
  return ()=>window.clearTimeout(timer);
 },[dirty.length,persist,saving,saveError]);
 function field(k:'notes'|'gratitude'|'reflection'|'legacy',label:string,rows=3){
  return <label className="block text-xs text-ink-dim">{label}<textarea aria-label={label} className={input+' mt-1 resize-y'} value={dirty.includes(k)?draft[k]:effective[k]} onChange={e=>setDraft(old=>({...old,[k]:e.target.value}))} onBlur={()=>{if(!saveError)void persist();}} maxLength={k==='gratitude'||k==='legacy'?4000:12000} rows={rows}/></label>;
 }
 const hits=dirty.includes('hits')?draft.hits:effective.hits;
 const rating=dirty.includes('rating')?draft.rating:effective.rating;
 return <section aria-label="Journal for selected day" className="min-w-0 space-y-4">
  <p className="text-xs text-ink-dim">Private · {day}</p>
  <form className="grid gap-4" onSubmit={e=>{e.preventDefault();void persist();}}>
   {field('gratitude','Gratitude')}
   <fieldset><legend className="mb-2 text-xs font-semibold text-signal">Quick Hits</legend><div className="grid grid-cols-2 gap-2">{quickHits.map(h=><label key={h} className="text-xs"><input className="accent-signal" type="checkbox" checked={hits.includes(h)} onChange={e=>setDraft({...draft,hits:e.target.checked?[...hits,h]:hits.filter(v=>v!==h)})}/> {h}</label>)}</div></fieldset>
   {field('legacy','Record Legacy Impression',4)}
   <fieldset><legend className="mb-2 text-xs font-semibold text-signal">How was the day?</legend><div className="flex flex-wrap gap-1">{Object.entries(dayRatings).map(([v,label])=><button key={v} type="button" aria-pressed={rating===v} className={rating===v?primary:button} onClick={()=>setDraft({...draft,rating:rating===v?null:v as keyof typeof dayRatings})}>{label}</button>)}</div>{typeof rating==='number'&&<p className="mt-1 text-xs text-ink-dim">Previous preview rating: {rating}/5</p>}</fieldset>
   {field('reflection','Reflection')}
   {field('notes','Notes for the Day')}
   <div className="flex flex-wrap items-center gap-2"><button type="submit" className={primary} disabled={saving||!dirty.length}>Save journal</button><span role="status" className="text-xs text-ink-dim">{saving?'Saving…':dirty.length?'Unsaved edits':'Journal saved'}</span></div>
   {saveError&&<p role="alert" className="text-xs text-warn">{saveError}</p>}
  </form>
 </section>;
}
function TimestampedNotes({day,entries,send}:{day:string;entries:Journal['entries'];send:Command}){
 const [entry,setEntry]=useState('');
 return <section aria-labelledby="planner-timestamped-notes" className={card+' space-y-3'}>
  <div><h2 id="planner-timestamped-notes" className="text-base font-semibold">Timestamped Notes</h2><p className="mt-1 text-xs text-ink-dim">Record a decision, reminder, or useful detail without overwriting earlier notes.</p></div>
  <form className="grid gap-2" onSubmit={async e=>{e.preventDefault();if(await send({op:'journal-add',day,text:entry}))setEntry('');}}>
   <label className="text-xs text-ink-dim">Timestamped note<textarea aria-label="Timestamped note" className={input+' mt-1'} required rows={2} value={entry} placeholder="Add a note from this moment…" onChange={e=>setEntry(e.target.value)} maxLength={8000}/></label>
   <div><button className={button} disabled={!entry.trim()}>Add timestamped note</button></div>
  </form>
  {entries.length?<ul className="space-y-2" aria-label="Timestamped notes for this day">{entries.map(e=><li className="flex flex-wrap items-start justify-between gap-2 border-t border-edge pt-2 text-xs" key={e.id}><div className="min-w-0 flex-1"><time className="text-ink-faint" dateTime={e.at}>{new Date(e.at).toLocaleString()}</time><p className="whitespace-pre-wrap break-words">{e.text}</p></div><button className={button} onClick={()=>{if(window.confirm('Remove this timestamped note from this day?'))void send({op:'journal-remove',day,id:e.id});}}>Remove note</button></li>)}</ul>:<p className="text-xs text-ink-dim">No timestamped notes yet.</p>}
 </section>;
}
function TimePanel({plan,day,send}:{plan:DayPlan;day:string;send:Command}){
 const [clientId,setClient]=useState(''),[name,setName]=useState(''),[start,setStart]=useState(''),[end,setEnd]=useState(''),[notes,setNotes]=useState('');
 const [rename,setRename]=useState(false);
 return <section className={card}><h2 className="text-base font-semibold">Private time entries</h2><p className="text-xs text-ink-dim">{hours(plan.time.reduce((n,e)=>n+e.seconds,0))} logged for this day.</p>
  <form className="mt-3 flex flex-wrap items-end gap-2" onSubmit={async e=>{e.preventDefault();if(await send({op:'time',day,clientId,started:start,ended:end,notes,timezone:Intl.DateTimeFormat().resolvedOptions().timeZone})){setStart('');setEnd('');setNotes('');}}}>
   <label className="text-xs">Client<select required aria-label="Client" className={input} value={clientId} onChange={e=>setClient(e.target.value)}><option value="">Choose a client</option>{plan.clients.map(c=><option value={c.id} key={c.id}>{c.name}</option>)}</select></label>
   <label className="text-xs">Start<input className={input} type="time" required value={start} onChange={e=>setStart(e.target.value)}/></label>
   <label className="text-xs">End<input className={input} type="time" required value={end} onChange={e=>setEnd(e.target.value)}/></label>
   <label className="min-w-36 flex-1 text-xs">Time entry notes<input className={input} value={notes} onChange={e=>setNotes(e.target.value)}/></label><button className={primary}>Log time</button>
  </form>
  <form className="mt-2 flex items-end gap-2" onSubmit={async e=>{e.preventDefault();if(await send({op:'client',name,...(rename?{id:clientId}:{})})){setName('');setRename(false);}}}>
   <label className="text-xs">{rename?'Rename selected client':'New client name'}<input className={input} required value={name} onChange={e=>setName(e.target.value)} maxLength={140}/></label>
   <button className={button}>{rename?'Rename':'Create client'}</button>
   {clientId&&<button className={button} type="button" onClick={()=>{setRename(!rename);setName('');}}>{rename?'Cancel':'Rename selected client'}</button>}
  </form>
  <ul className="mt-3 space-y-2">{plan.time.map(e=><li className="border-t border-edge pt-2 text-xs" key={e.id}>{e.clientName} · {e.started}–{e.ended} · {hours(e.seconds)}{e.notes?' · '+e.notes:''}</li>)}</ul>
 </section>;
}
const viewNames={day:'Day plan',upcoming:'Upcoming',history:'Past days',archive:'Archived tasks','archived-days':'Archived days',time:'Monthly time'} as const;
type View=keyof typeof viewNames;
type Crm={contactId:string;noteId:string;title:string};
export default function DailyPlanner(){
 const {isNarrow=false}=useOutletContext<{isNarrow?:boolean}>()??{};
 const [params]=useSearchParams();
 const crmContact=params.get('contact'),crmNote=params.get('note');
 const [day,setDay]=useState(()=>validPlannerDate(params.get('on'))?params.get('on')!:localDay()),[view,setView]=useState<View>('day');
 const [session,setSession]=useState<string|null|undefined>(undefined),[pass,setPass]=useState('');
 const [loaded,setLoaded]=useState<{day:string;plan:DayPlan}|null>(null),[rows,setRows]=useState<(Task|string|TimeEntry)[]>([]);
 const [crm,setCrm]=useState<Crm|null>(null),[error,setError]=useState(''),[message,setMessage]=useState(''),[loading,setLoading]=useState(false),[refresh,setRefresh]=useState(0);
 const plan=loaded?.day===day?loaded.plan:null;
 const [busy,setBusy]=useState(false);
 const [pending,setPending]=useState<{encoded:string;key:string}|null>(null);
 const fail=useCallback((e:unknown)=>{setError(err(e));if(e instanceof PlannerRequestError&&e.status===401)setSession(null);},[]);
 const reload=useCallback(()=>setRefresh(n=>n+1),[]);
 useEffect(()=>{let alive=true;void planner.session().then(s=>{if(alive)setSession(s.owner);}).catch(e=>{if(alive){setSession(null);fail(e);}});return()=>{alive=false;};},[fail]);
 useEffect(()=>{
  if(!session){setLoaded(null);setRows([]);setCrm(null);return;}
  let alive=true;setLoading(true);
  const op=view==='day'?planner.day(day).then(p=>{if(alive)setLoaded(current=>({day,plan:current?.day===day&&current.plan.journal.revision>p.journal.revision?{...p,journal:current.plan.journal}:p}));}):planner.agenda<typeof rows>(view==='upcoming'?localDay():day,view).then(r=>{if(alive)setRows(r);});
  void op.catch(e=>{if(alive)fail(e);}).finally(()=>{if(alive)setLoading(false);});
  if(plannerPreviewEnabled||(crmContact&&crmNote))void planner.crm(crmContact??undefined,crmNote??undefined).then(v=>{if(alive)setCrm(v);}).catch(()=>{if(alive)setCrm(null);});
  return()=>{alive=false;};
 },[session,day,view,refresh,fail,crmContact,crmNote]);
 const send:Command=useCallback(async a=>{
  if(busy)return false;
  setBusy(true);setError('');setMessage('');
  const encoded=JSON.stringify(a),key=pending?.encoded===encoded?pending.key:crypto.randomUUID();
  setPending({encoded,key});
  try{
   const result=await planner.action<{moved?:number;backlog?:number;id?:string;day?:string}>(a,key);
   setPending(null);reload();
   setMessage(a.op==='carry'?('Moved '+result.moved+' unfinished tasks'+(result.backlog?', '+result.backlog+' to Backlog.':'.')):a.op==='crm'?'E-CRM follow-up is linked to the existing plan item.':a.op==='archive-year'?'Prior-year plans were archived. No records were deleted.':'Saved.');
   if(a.op==='crm'&&result.day){setDay(result.day);setView('day');}
   return true;
  }catch(e){if(e instanceof PlannerRequestError&&e.status<500)setPending(null);fail(e);return false;}finally{setBusy(false);}
 },[busy,pending,reload,fail]);
 const saveJournal=useCallback(async (date:string,patch:Record<string,unknown>,baseline:Record<string,unknown>)=>{
  const saved=await planner.action<Journal>({op:'journal-patch',day:date,patch,baseline},crypto.randomUUID());
  setLoaded(current=>current?.day===date&&current.plan.journal.revision<=saved.revision?{day:date,plan:{...current.plan,journal:saved}}:current);
  return saved;
 },[]);
 const journal=isNarrow||view!=='day'||!session?null:plan?.journal;
 const rail=useMemo(()=>session&&view==='day'&&!isNarrow?[{key:'daily-journal',title:'Daily Journal',node:journal?<JournalPanel key={day} journal={journal} day={day} saveJournal={saveJournal}/>:<p className="text-xs text-ink-dim">Loading this day’s journal…</p>}]:noRail,[session,view,isNarrow,journal,day,saveJournal]);
 usePageRail(rail);
 async function signIn(e:FormEvent){
  e.preventDefault();setError('');setBusy(true);
  try{const s=await planner.signIn(pass);setPass('');setSession(s.owner);}catch(e){fail(e);}finally{setBusy(false);}
 }
 function selectDay(value:string){if(validPlannerDate(value)){setDay(value);setError('');setMessage('');}}
 function exportShareable(){
  if(!plan?.tasks.some(t=>t.shareable&&!t.archived)){setMessage('No tasks for this day are marked Shareable.');return;}
  const url=URL.createObjectURL(new Blob(['\uFEFF',shareableTaskCsv(day,plan.tasks)],{type:'text/csv;charset=utf-8'}));
  const link=document.createElement('a');link.href=url;link.download='daily-planner-'+day+'.csv';link.click();
  window.setTimeout(()=>URL.revokeObjectURL(url),1000);
  setMessage('Shareable tasks exported. Journal, task notes, and files were excluded.');
 }
 const today=localDay(),monthly=rows.filter((e):e is TimeEntry=>typeof e==='object'&&'seconds' in e);
 const grouped=new Map<string,{name:string;seconds:number}>();
 for(const e of monthly){const row=grouped.get(e.clientId);grouped.set(e.clientId,{name:row?.name??e.clientName,seconds:(row?.seconds??0)+e.seconds});}
 return <div className="max-w-6xl space-y-5 pb-7">
  <header className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs uppercase tracking-widest text-signal">{plannerPreviewEnabled?'Private preview · test data only':'Your daily plan'}</p><h1 className="mt-1 text-2xl font-semibold">Daily Planner</h1><p className="mt-1 text-sm text-ink-dim">What am I choosing to accomplish?</p></div>{plannerPreviewEnabled&&session&&<button className={button} onClick={()=>void planner.signOut().then(()=>{setSession(null);setPending(null);setMessage('');setError('');}).catch(fail)}>Sign out of Planner</button>}</header>
  {error&&<p role="alert" className="rounded-lg border border-warn/40 p-3 text-sm text-warn">{error}</p>}
  {message&&<p role="status" className="text-sm text-signal">{message}</p>}
  {session===undefined?<p>Checking your session…</p>:!session&&!plannerPreviewEnabled?<p>Daily Planner is unavailable. Reload this page to try again.</p>:!session?<form className={card+' flex max-w-lg flex-col gap-3'} onSubmit={signIn}><h2>Sign in to the preview</h2><label className="text-xs">Preview access code<input type="password" autoComplete="off" required className={input} value={pass} onChange={e=>setPass(e.target.value)}/></label><div><button className={primary} disabled={busy}>Sign in</button></div><p className="text-xs text-ink-dim">Use a synthetic account code. Do not enter your 2EP or ECP-Engage password.</p></form>:<>
   <div className="flex flex-wrap items-center gap-2"><button className={button} onClick={()=>selectDay(shiftDay(day,-1))} aria-label="Previous day">←</button><input className={input+' !w-auto'} aria-label="Viewing date" type="date" value={day} onChange={e=>selectDay(e.target.value)}/><button className={button} onClick={()=>selectDay(shiftDay(day,1))} aria-label="Next day">→</button><button className={button} onClick={()=>{selectDay(today);setView('day');}}>Today</button><button className={button} onClick={reload}>Refresh plan</button></div>
   <nav className="flex flex-wrap gap-2" aria-label="Planner views">{Object.entries(viewNames).map(([key,name])=><button className={view===key?primary:button} key={key} aria-pressed={view===key} onClick={()=>{setView(key as View);setRows([]);setMessage('');}}>{name}</button>)}</nav>
   <fieldset disabled={busy} className="min-w-0 space-y-4">
   {loading?<p className="text-sm text-ink-dim">Loading private plan…</p>:view==='day'?plan&&<>
    <section className={card}><h2 className="mb-3 text-base font-semibold">Quick capture</h2><Capture key={day} on={day} tasks={plan.tasks} send={send}/></section>
    {crm&&<details className={card} open={params.get('source')==='sample-crm'}><summary className="cursor-pointer text-sm text-signal">{plannerPreviewEnabled?'Add a sample E-CRM follow-up':'Add this E-CRM follow-up'}</summary><div className="mt-3"><p className="mb-2 text-xs text-ink-dim">{crm.title} · {plannerPreviewEnabled?'synthetic source':'linked to the saved E-CRM note'}.</p><Capture key={day+'-crm'} on={day} tasks={plan.tasks} send={send} source={crm}/></div></details>}
    <section className="flex flex-wrap items-center gap-2" aria-label="Plan actions">
     <button className={button} onClick={exportShareable}>Export Shareable Tasks</button>
     <button className={button} onClick={async()=>{const next=shiftDay(day,1);if(await send({op:'carry',from:day,to:next}))setDay(next);}}>Plan Tomorrow</button>
     {plan.previousOpen&&<button className={button} onClick={()=>void send({op:'carry',from:plan.previousOpen?.day,to:day})}>Bring forward open tasks from {plan.previousOpen.day} ({plan.previousOpen.count})</button>}
    </section>
    <div className="grid grid-cols-1 gap-4" aria-label="Task lanes">{lanes.map(l=>{
     const tasks=plan.tasks.filter(t=>t.lane===l);
     return <section key={l} className={card+(l==='one'?' border-signal/50 bg-signal/5':'')}><h2 className={l==='one'?'text-lg font-semibold text-signal':'text-base font-semibold'}>{laneLabels[l]}</h2><p className="text-xs text-ink-dim">{tasks.length?tasks.filter(t=>t.state==='done').length+' of '+tasks.length+' done':l==='one'?'Choose your most important result.':'No tasks here.'}</p><ul className="mt-2">{tasks.map(t=><TaskRow key={t.id} t={t} tasks={plan.tasks} files={plan.files[t.id]} work={plan.delegations[t.id]} send={send} reload={reload} fail={fail}/>)}</ul></section>;
    })}</div>
    <TimestampedNotes key={day} day={day} entries={plan.journal.entries} send={send}/>
    {!!plan.previouslyPlaced.length&&<section className={card}><h2 className="font-semibold">Previously planned here</h2><ul className="mt-2 space-y-1">{plan.previouslyPlaced.map(t=><li key={t.id} className="text-xs">{t.title} · {laneLabels[t.lane]} · moved to a different day</li>)}</ul></section>}
    {isNarrow&&<details className={card}><summary className="cursor-pointer font-semibold">Daily Journal</summary><div className="mt-4"><JournalPanel key={day} journal={plan.journal} day={day} saveJournal={saveJournal}/></div></details>}
    <TimePanel key={day+"-time"} plan={plan} day={day} send={send}/>
    {!!plan.scheduled?.length&&<section className={card}><h2 className="font-semibold">Scheduled</h2><ul className="mt-2 space-y-2">{plan.scheduled.map(t=><li key={t.id} className="flex flex-wrap items-center gap-2 text-xs"><span>{t.day} · {t.title} · {laneLabels[t.lane]}{t.parentId?' · Follow-up':''}</span><button className={button} onClick={()=>selectDay(t.day)}>Open day</button></li>)}</ul></section>}
   </>:<section className={card}><h2 className="text-base font-semibold">{viewNames[view]}{view==='time'?' · '+day.slice(0,7):''}</h2>
    {view==='time'&&<><p className="text-sm text-signal">{hours(monthly.reduce((s,e)=>s+e.seconds,0))} total</p><ul className="my-3 space-y-1">{[...grouped.values()].map((c,i)=><li className="text-sm" key={i}>{c.name}: {hours(c.seconds)}</li>)}</ul></>}
    {view==='history'&&<button className={button+' mt-2'} onClick={()=>{const year=Number(today.slice(0,4))-1;if(window.confirm('Archive daily plans for '+year+'? Nothing will be deleted.'))void send({op:'archive-year',year});}}>Archive prior year</button>}
    {!rows.length&&<p className="mt-2 text-xs text-ink-dim">No records in this view.</p>}
    <ul className="mt-2 space-y-2">{rows.map(r=>typeof r==='string'?<li key={r}><button className={button} onClick={()=>{selectDay(r);setView('day');}}>{r}</button></li>:'seconds' in r?<li className="border-t border-edge pt-2 text-sm" key={r.id}>{r.day} · {r.clientName} · {r.started}–{r.ended} · {hours(r.seconds)}{r.notes?' · '+r.notes:''}</li>:<li className="flex flex-wrap items-center gap-2 border-t border-edge pt-2 text-sm" key={r.id}><span>{r.day} · {r.title} · {laneLabels[r.lane]}{r.parentId?' · Follow-up':''}</span>{view==='archive'?<button className={button} onClick={()=>void send({op:'restore',id:r.id,revision:r.revision,lane:'backlog'})}>Restore to Backlog</button>:<button className={button} onClick={()=>{selectDay(r.day);setView('day');}}>Open day</button>}</li>)}</ul>
   </section>}
   </fieldset>
  </>}
 </div>;
}
