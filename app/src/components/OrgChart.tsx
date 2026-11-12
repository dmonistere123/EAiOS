import { useEffect, useRef, useState } from 'react';
import type { Agent } from '../domain/types';
import { AgentStatusBadge } from './ui';
import { StaffAvatar, staffHub } from './StaffAvatar';

function AgentNode({ agent, hub, selected, onSelect }: { agent: Agent; hub?: boolean; selected: boolean; onSelect: (agent: Agent) => void }) {
  return <button type="button" className={`staff-orbit-node${hub ? ' staff-orbit-hub' : ''}`}
    data-agent-id={agent.id} data-status={agent.status} data-brain-hub={hub || undefined}
    aria-label={`${agent.name}, ${agent.status.replace(/_/g, ' ')}`} aria-pressed={selected} onClick={() => onSelect(agent)}>
    <span className="staff-orbit-avatar"><StaffAvatar agent={agent} hub={hub} /></span>
    <span className="staff-orbit-name">{agent.name}</span>
    {hub && <span className="staff-orbit-caption">Orchestrator Agent</span>}
    <AgentStatusBadge status={agent.status} />
  </button>;
}

/** Orbital movement is decorative. Only runtime status can light an agent as working. */
export function OrgChart({ agents, selectedId, onSelect }: { agents: Agent[]; selectedId?: string | null; onSelect: (agent: Agent) => void }) {
  const hub = staffHub(agents);
  const staff = agents.filter(a => a.id !== hub?.id);
  const [pageIndex, setPageIndex] = useState(0);
  const page = Math.min(pageIndex, Math.max(0, Math.ceil(staff.length / 6) - 1));
  const visible = staff.slice(page * 6, page * 6 + 6);
  const visibleKey = visible.map(a => a.id).join('\0');
  const stageRef = useRef<HTMLDivElement>(null);
  const angleRef = useRef(-Math.PI / 2);
  const [playing, setPlaying] = useState(true);
  const [reduced, setReduced] = useState(() => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false);
  useEffect(() => {
    const mq = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    const change = () => setReduced(mq?.matches ?? false);
    mq?.addEventListener('change', change);
    return () => mq?.removeEventListener('change', change);
  }, []);
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const nodes = [...stage.querySelectorAll<HTMLElement>('.staff-orbit-node:not(.staff-orbit-hub)')];
    let width = stage.getBoundingClientRect().width || 540;
    let frame = 0, last = 0, lastDraw = 0, hovered = false, focused = false, inView = true;
    function position() {
      stage!.dataset.compact = String(width < 440);
      nodes.forEach((node, i) => {
        const angle = angleRef.current + i * Math.PI * 2 / nodes.length;
        node.style.transform = `translate(${Math.cos(angle) * (width / 2 - 66)}px, ${Math.sin(angle) * 144}px)`;
      });
    }
    function running() { return playing && !reduced && width >= 440 && !hovered && !focused && inView && !document.hidden; }
    function tick(time: number) {
      frame = 0;
      if (!running()) return;
      if (last) angleRef.current += Math.min(time - last, 100) * Math.PI * 2 / 90000;
      last = time;
      if (time - lastDraw >= 32) { position(); lastDraw = time; }
      frame = requestAnimationFrame(tick);
    }
    function sync() { cancelAnimationFrame(frame); frame = 0; last = 0; if (running()) frame = requestAnimationFrame(tick); }
    const enter = () => { hovered = true; sync(); };
    const leave = () => { hovered = false; sync(); };
    const focus = () => { focused = true; sync(); };
    const blur = (e: FocusEvent) => { focused = stage!.contains(e.relatedTarget as Node); sync(); };
    stage.addEventListener('pointerenter', enter); stage.addEventListener('pointerleave', leave);
    stage.addEventListener('focusin', focus); stage.addEventListener('focusout', blur);
    document.addEventListener('visibilitychange', sync);
    const resize = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(entries => { width = entries[0].contentRect.width; position(); sync(); }) : null;
    resize?.observe(stage);
    const observer = typeof IntersectionObserver !== 'undefined' ? new IntersectionObserver(entries => { inView = entries[0].isIntersecting; sync(); }) : null;
    observer?.observe(stage);
    position(); sync();
    return () => {
      cancelAnimationFrame(frame); resize?.disconnect(); observer?.disconnect();
      stage.removeEventListener('pointerenter', enter); stage.removeEventListener('pointerleave', leave);
      stage.removeEventListener('focusin', focus); stage.removeEventListener('focusout', blur);
      document.removeEventListener('visibilitychange', sync);
    };
  }, [visibleKey, playing, reduced]);
  function select(agent: Agent) { setPlaying(false); onSelect(agent); }
  return <section role="group" aria-label="Org chart" className="staff-orbit-deck">
    <div className="staff-orbit-toolbar"><h2>AI team · Orbital view</h2>
      <button type="button" onClick={() => setPlaying(v => !v)} aria-pressed={playing && !reduced} disabled={reduced || !staff.length} className="staff-motion-control">
        {reduced ? 'Reduced motion' : playing ? 'Pause motion' : 'Rotate team'}
      </button>
    </div>
    <div className="staff-orbit-stage" ref={stageRef}>
      <div className="staff-orbit-track" aria-hidden="true"/><div className="staff-orbit-track inner" aria-hidden="true"/>
      <div className="staff-orbit-track outer" aria-hidden="true"/><div className="staff-crosshair" aria-hidden="true"/>
      {hub ? <AgentNode agent={hub} hub selected={selectedId === hub.id} onSelect={select} /> : <p className="staff-orbit-no-hub">Coordinator unavailable</p>}
      {visible.map(agent => <AgentNode key={agent.id} agent={agent} selected={selectedId === agent.id} onSelect={select} />)}
    </div>
    <div className="staff-orbit-legend"><span><i className="working"/>Working</span><span><i className="waiting"/>Awaiting approval</span><span><i/>Other states labeled on each agent</span></div>
    {!staff.length && <p className="px-4 pb-4 text-xs text-ink-dim">No specialist agents match this view.</p>}
    {staff.length > 6 && <div className="flex items-center justify-between gap-3 border-t border-edge px-4 py-3 text-xs text-ink-dim">
      <button type="button" disabled={page === 0} onClick={() => setPageIndex(page - 1)} className="text-signal disabled:opacity-40">Previous agents</button>
      <span>{page * 6 + 1}–{Math.min(staff.length, (page + 1) * 6)} of {staff.length}</span>
      <button type="button" disabled={(page + 1) * 6 >= staff.length} onClick={() => setPageIndex(page + 1)} className="text-signal disabled:opacity-40">Next agents</button>
    </div>}
  </section>;
}
