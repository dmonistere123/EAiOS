import { useEffect, useState } from 'react';
import { toast } from '../state/runtime';
interface SharedCopy {id:string;artifactId:string;filename:string;status:string;url:string|null;error:string|null;updatedAt:number}
export function ArtifactShares({revision}:{revision:unknown}) {
  const [shares,setShares]=useState<SharedCopy[]>([]),[error,setError]=useState(''),[busy,setBusy]=useState<string|null>(null),[checkedAt,setCheckedAt]=useState(0);
  async function refresh(){
    try{const r=await fetch('/api/artifact-shares');if(!r.ok)throw new Error('Could not load shared links.');const data=await r.json();if(!Array.isArray(data.shares))throw new Error('Could not load shared links.');setShares(data.shares);setCheckedAt(Date.now()/1000);setError('');}
    catch(e){setError(e instanceof Error?e.message:'Could not load shared links.');}
  }
  // eslint-disable-next-line react/set-state-in-effect -- refresh synchronizes server publication status
  useEffect(()=>{void refresh();},[revision]);
  async function retry(id:string){
    setBusy(id);
    try{const r=await fetch(`/api/artifact-shares/${id}/retry`,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});const data=await r.json();if(!r.ok)throw new Error(data.error);toast('ok','Public link is ready.');}
    catch(e){toast('error',e instanceof Error?e.message:'Publication was not confirmed.');}
    finally{setBusy(null);void refresh();}
  }
  if(!shares.length&&!error)return null;
  return <section className="space-y-3 rounded-xl border border-edge bg-canvas-raised p-5" aria-label="Shared artifact links">
    <h2 className="text-sm font-semibold text-ink">Shared links</h2>
    <p className="text-xs text-ink-dim">Only approved copies are published. Anyone with a published link can access that copy. Deleting a local artifact does not remove its public copy.</p>
    {error&&<p role="alert" className="text-xs text-warn">{error}</p>}
    {shares.slice(0,50).map(s=><div key={s.id} className="space-y-2 border-t border-edge pt-3">
      <div className="flex items-center justify-between gap-3"><span className="truncate text-sm text-ink">{s.filename}</span><span className="text-xs text-ink-dim">{s.status==='pending'?'Awaiting approval':s.status==='published'?'Published':s.status==='uploading'?'Publishing…':s.status.replaceAll('_',' ')}</span></div>
      {s.status==='published'&&s.url&&<div className="flex gap-2"><input aria-label={`Public link for ${s.filename}`} readOnly value={s.url} onFocus={e=>e.target.select()} className="min-w-0 flex-1 rounded border border-edge bg-canvas p-2 text-xs text-ink-dim"/><button className="rounded border border-signal/40 px-3 text-xs text-signal" onClick={()=>void navigator.clipboard.writeText(s.url!).then(()=>toast('ok','Public link copied.'),()=>toast('error','Select and copy the link from the field.'))}>Copy public link</button></div>}
      {s.error&&<p className="text-xs text-warn">{s.error}</p>}
      {(s.status==='uncertain'||(s.status==='uploading'&&s.updatedAt<checkedAt-300))&&<button disabled={busy===s.id} onClick={()=>void retry(s.id)} className="rounded border border-edge px-3 py-2 text-xs text-signal">{busy===s.id?'Checking…':'Check / retry approved share'}</button>}
    </div>)}
  </section>;
}
