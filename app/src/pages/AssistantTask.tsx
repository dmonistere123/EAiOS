import { useEffect,useState } from 'react';
import { HumanChecklist } from '../components/HumanChecklist';
import { assistantTask } from '../adapters';
import type { AssistantTaskView } from '../adapters/travelHandoff';
export default function AssistantTask() {
  const [token]=useState(()=>window.location.hash.slice(1));
  const [task,setTask]=useState<AssistantTaskView>(),[error,setError]=useState('');
  useEffect(()=>{window.history.replaceState(null,'',window.location.pathname);void assistantTask.load(token).then(setTask).catch(e=>setError(e.message));},[token]);
  return <main className="mx-auto max-w-3xl space-y-5 p-6">
    <header><p className="text-xs uppercase tracking-widest text-warn">2EP · Private assistant workspace</p><h1 className="mt-3 text-2xl font-semibold">{task?.title||'Your assigned work'}</h1></header>
    {import.meta.env.VITE_TRAVEL_HANDOFF==='1'&&<p className="rounded-lg border border-warn/30 p-3 text-sm text-warn">Staging · sample delegation. Changes stay in staging.</p>}
    {error&&<p role="alert" className="text-risk">{error}</p>}
    {task&&<section className="rounded-xl border border-edge bg-canvas-raised p-5"><p className="text-sm text-ink-dim">Assigned to {task.assistant} · {task.status.replaceAll('_',' ')}</p><p className="mt-3 whitespace-pre-wrap text-sm">{task.instructions}</p>
      <button className="mt-3 mr-4 text-sm text-signal" onClick={()=>void assistantTask.load(token).then(t=>{setTask(t);setError('');}).catch(e=>setError(e.message))}>Refresh task status</button>
      <a href="#" className="mt-3 inline-block text-sm text-signal" onClick={e=>{e.preventDefault();void assistantTask.itinerary(token).then(text=>{const blob=new Blob([text],{type:'text/plain'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='itinerary.txt';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}).catch(e=>setError(e.message));}}>Download assigned itinerary</a>
      <HumanChecklist key={task.revision} task={task} onChange={setTask} save={items=>assistantTask.save(token,task.revision,items)} submit={note=>assistantTask.submit(token,task.revision,note)}/>
    </section>}
    <p className="text-xs text-ink-dim">This view is limited to this assignment. Booking is handled by you. The executive reviews completion before the task is closed.</p>
  </main>;
}
