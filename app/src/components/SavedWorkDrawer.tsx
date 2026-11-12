import { useState } from 'react';
import { HumanDelegationForm } from './HumanDelegationForm';
import { Drawer } from './ui';
import { hermes } from '../adapters';
import { useRuntime, agentName, toast } from '../state/runtime';
import type { WorkItem } from '../domain/types';
export function DelegateDialog({ item, onClose }: { item: WorkItem; onClose: () => void }) {
  const s = useRuntime();
  const preferredAgentId = s.agents.find((a) => a.id === 'default')?.id ?? s.agents.find((a) => a.id === 'ally')?.id ?? s.agents[0]?.id ?? 'default';
  const [kind,setKind]=useState<'agent'|'human'>('agent');
  const [pickedAgentId, setPickedAgentId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const staff = s.agents;
  const agentId = pickedAgentId && staff.some((a) => a.id === pickedAgentId) ? pickedAgentId : preferredAgentId;

  const confirm = async () => {
    setBusy(true);
    const res = await hermes.delegateWork(item.id, { agentId });
    setBusy(false);
    if (res.ok) {
      toast('ok', `Delegated “${item.title}” to ${agentName(s, agentId)}.`);
      onClose();
    } else {
      toast('error', res.error?.safeMessage ?? 'Delegation failed.');
    }
  };

  return (
    <Drawer title="Delegate work" onClose={onClose}>
      <p className="text-sm text-ink-dim">Choose an AI agent or prepare an email draft for a human assistant.</p>
      <div className="mt-4 rounded-lg border border-edge bg-canvas p-4">
        <div className="text-sm font-medium text-ink">{item.title}</div>
        {item.summary && <div className="mt-1 text-xs text-ink-dim">{item.summary}</div>}
      </div>
      <div className="mt-4 flex gap-3"><button onClick={()=>setKind('agent')} aria-pressed={kind==='agent'} className="rounded border border-edge p-2 text-sm">AI agent</button><button onClick={()=>setKind('human')} aria-pressed={kind==='human'} className="rounded border border-edge p-2 text-sm">Human assistant</button></div>
      {kind==='human'?<HumanDelegationForm workItemId={item.id}/>:<>
      <label className="mt-4 block text-xs font-medium uppercase tracking-wider text-ink-faint" htmlFor="agent-pick">Assign to</label>
      <select
        id="agent-pick"
        value={agentId}
        onChange={(e) => setPickedAgentId(e.target.value)}
        className="mt-1 w-full rounded-lg border border-edge bg-canvas px-3 py-2 text-sm text-ink"
      >
        {staff.map((a) => (
          <option key={a.id} value={a.id}>{a.name} — {a.role}</option>
        ))}
      </select>
      <button
        onClick={confirm}
        disabled={busy}
        className="mt-6 w-full rounded-lg bg-signal px-4 py-2.5 text-sm font-semibold text-canvas hover:bg-signal/90 disabled:opacity-50"
      >
        {busy ? 'Delegating…' : 'Confirm delegation'}
      </button>
      </>}
    </Drawer>
  );
}


/** Keep the general backlog accessible without treating every saved task as a priority. */
export function SavedWorkDrawer({onClose}:{onClose:()=>void}) {
  const s=useRuntime();const [selected,setSelected]=useState<WorkItem|null>(null),[shown,setShown]=useState(30);
  if(selected)return <DelegateDialog item={selected} onClose={()=>setSelected(null)}/>;
  const tasks=s.work.filter(w=>w.ownerType==='executive'&&!['complete','cancelled'].includes(w.state));
  return <Drawer title="Saved unassigned tasks" onClose={onClose}>
    <p className="text-sm text-ink-dim">These saved tasks are outside your operating queue. Assign one when you are ready to move it forward.</p>
    {s.degraded.includes('work')?<p role="alert" className="mt-4 text-sm text-warn">Saved tasks unavailable. Please refresh.</p>:<><ul className="mt-4 divide-y divide-edge">{tasks.slice(0,shown).map(w=><li key={w.id} className="flex items-center gap-3 py-3"><span className="min-w-0 flex-1 text-sm">{w.title}</span><button onClick={()=>setSelected(w)} className="rounded border border-signal/40 px-3 py-1.5 text-xs text-signal">Delegate</button></li>)}</ul>{!tasks.length&&<p className="mt-4 text-sm text-ink-dim">No unassigned tasks.</p>}{tasks.length>shown&&<button onClick={()=>setShown(n=>n+30)} className="mt-3 text-xs text-signal">Show more saved tasks</button>}</>}
  </Drawer>;
}
