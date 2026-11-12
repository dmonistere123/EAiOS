import { useState } from 'react';
import type { HumanDelegation, HumanChecklistItem } from '../domain/humanDelegation';
type Task = Pick<HumanDelegation,'id'|'revision'|'status'|'checklist'|'completionNote'|'completionFeedback'>;
const field='mt-1 w-full rounded-lg border border-edge bg-canvas px-3 py-2 text-sm text-ink';
export function HumanChecklist<T extends Task>({task,onChange,save,submit}:{task:T;onChange:(task:T)=>void;save:(items:HumanChecklistItem[])=>Promise<T>;submit:(note:string)=>Promise<T>}) {
  const [items,setItems]=useState(task.checklist??[]),[note,setNote]=useState(task.completionNote??''),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const editable=['awaiting_acceptance','accepted','in_progress','blocked','no_response'].includes(task.status);
  async function run(action:()=>Promise<T>){setBusy(true);setError('');try{onChange(await action());}catch(e){setError(e instanceof Error?e.message:'Could not save checklist.');}finally{setBusy(false);}}
  function patch(id:string,value:Partial<HumanChecklistItem>){setItems(old=>old.map(i=>i.id===id?{...i,...value}:i));}
  return <div className="mt-4 space-y-4">
    {task.completionFeedback&&<p className="rounded-lg border border-warn/40 p-3 text-sm text-warn">Executive feedback: {task.completionFeedback}</p>}
    <h3 className="text-sm font-semibold">Booking checklist</h3>
    {items.map((item,index)=><fieldset key={item.id} disabled={!editable||busy} className="space-y-2 rounded-lg border border-edge p-4">
      <label className="flex items-start gap-3 text-sm font-medium"><input className="mt-1 accent-signal" type="checkbox" checked={item.done} onChange={e=>patch(item.id,{done:e.target.checked})}/>{item.title}</label>
      <div className="grid gap-3 sm:grid-cols-2"><label className="text-xs text-ink-dim">Confirmation reference<input aria-label={`Confirmation reference ${index+1}`} className={field} maxLength={120} value={item.reference??''} onChange={e=>patch(item.id,{reference:e.target.value})}/></label>
      <label className="text-xs text-ink-dim">Final cost and currency<input aria-label={`Final cost ${index+1}`} className={field} maxLength={100} placeholder="USD 350.00" value={item.cost??''} onChange={e=>patch(item.id,{cost:e.target.value})}/></label></div>
      <label className="block text-xs text-ink-dim">Confirmation / outcome notes<textarea aria-label={`Outcome notes ${index+1}`} className={field} rows={2} maxLength={4000} value={item.notes??''} onChange={e=>patch(item.id,{notes:e.target.value})}/></label>
    </fieldset>)}
    {editable?<><button disabled={busy} className="rounded-lg border border-signal/50 px-4 py-2 text-sm text-signal disabled:opacity-50" onClick={()=>void run(()=>save(items))}>Save progress</button>
      <label className="block text-sm">Completion note<textarea className={field} rows={2} maxLength={4000} value={note} onChange={e=>setNote(e.target.value)}/></label>
      <button disabled={busy||!task.checklist?.length||task.checklist.some(i=>!i.done)||JSON.stringify(items)!==JSON.stringify(task.checklist)} className="rounded-lg bg-signal px-4 py-2 text-sm font-semibold text-canvas disabled:opacity-50" onClick={()=>void run(()=>submit(note))}>Submit for completion approval</button>
      <p className="text-xs text-ink-dim">Save each completed item with a reference or outcome note. Only the executive can approve closure.</p>
    </>:<p role="status" className="text-sm text-ink-dim">{task.status==='awaiting_completion'?'Awaiting executive sign-off. This task remains open.':task.status==='completed'?'Completion approved. This task is archived; its history is retained.':`Checklist is ${task.status.replaceAll('_',' ')}.`}</p>}
    {error&&<p role="alert" className="text-sm text-risk">{error}</p>}
  </div>;
}
