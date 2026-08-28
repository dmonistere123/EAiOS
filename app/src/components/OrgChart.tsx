/**
 * OrgChart (W3) — Ally at the hub, staff arranged radially, connectors drawn
 * as a hand-rolled SVG underlay. NO new dependencies. Nodes are real buttons
 * (keyboard-accessible); agents with status 'working' glow/pulse (decorative
 * only — status semantics stay with AgentStatusBadge, D5).
 *
 * Layout is flat-hierarchy radial: every staff agent reports to Ally in the
 * current data model, so an ellipse around the hub is the honest shape.
 */
import type { Agent } from '../domain/types';
import { AgentStatusBadge } from './ui';

const RX = 42; // ellipse radius, % of container width
const RY = 38; // ellipse radius, % of container height

function initials(name: string) {
  return name
    .split(/\s+/)
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
}

function Node({ agent, x, y, hub, selected, onSelect }: { agent: Agent; x: number; y: number; hub?: boolean; selected: boolean; onSelect: (a: Agent) => void }) {
  const working = agent.status === 'working';
  return (
    <button
      onClick={() => onSelect(agent)}
      aria-label={`${agent.name}, ${agent.status.replace(/_/g, ' ')}`}
      aria-pressed={selected}
      className={`group absolute z-10 flex -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-1.5 ${hub ? 'w-32' : 'w-24'}`}
      style={{ left: `${x}%`, top: `${y}%` }}
    >
      <span className="relative flex items-center justify-center">
        {working && <span aria-hidden className="absolute inline-flex h-full w-full animate-ping rounded-full bg-signal/30" />}
        <span
          className={`relative flex ${hub ? 'h-20 w-20 text-xl ring-2 ring-signal/40' : 'h-11 w-11 text-xs'} items-center justify-center rounded-full border font-semibold transition-shadow ${
            selected
              ? 'border-signal bg-signal/25 text-signal shadow-[0_0_18px_2px_rgba(50,197,255,0.45)]'
              : working
                ? 'border-signal/60 bg-signal/15 text-signal shadow-[0_0_14px_1px_rgba(50,197,255,0.35)]'
                : hub
                  ? 'border-signal/50 bg-signal/10 text-signal shadow-[0_0_16px_1px_rgba(50,197,255,0.25)]'
                  : 'border-edge bg-canvas-raised text-ink-dim group-hover:border-signal/40'
          }`}
        >
          {initials(agent.name)}
        </span>
      </span>
      <span className={`text-center leading-tight ${hub ? 'text-sm' : 'text-[11px]'} ${selected ? 'font-medium text-signal' : 'text-ink'}`}>{agent.name}</span>
      {hub && <span className="-mt-1 text-center text-[10px] font-semibold uppercase tracking-wider text-signal/80">Orchestrator Agent</span>}
      <AgentStatusBadge status={agent.status} />
    </button>
  );
}

export function OrgChart({ agents, selectedId, onSelect }: { agents: Agent[]; selectedId?: string | null; onSelect: (a: Agent) => void }) {
  // Hub = the agent nobody reports to (Ally); fallback: first agent.
  const hub = agents.find((a) => !a.reportsToAgentId) ?? agents[0];
  const staff = agents.filter((a) => a.id !== hub?.id);
  if (!hub) return null;

  // Evenly spaced around the ellipse, starting at the top.
  const positions = staff.map((a, i) => {
    const theta = -Math.PI / 2 + (2 * Math.PI * i) / Math.max(staff.length, 1);
    return { agent: a, x: 50 + RX * Math.cos(theta), y: 50 + RY * Math.sin(theta) };
  });

  return (
    <div role="group" aria-label="Org chart" className="relative h-[26rem] w-full rounded-xl border border-edge bg-canvas-raised">
      <svg aria-hidden className="absolute inset-0 h-full w-full" viewBox="0 0 100 100" preserveAspectRatio="none">
        {positions.map((p) => (
          <line
            key={p.agent.id}
            x1="50"
            y1="50"
            x2={p.x}
            y2={p.y}
            className="stroke-edge"
            strokeWidth="0.35"
            strokeDasharray={p.agent.status === 'working' ? undefined : '1.6 1.6'}
          />
        ))}
      </svg>
      <Node agent={hub} x={50} y={50} hub selected={selectedId === hub.id} onSelect={onSelect} />
      {positions.map((p) => (
        <Node key={p.agent.id} agent={p.agent} x={p.x} y={p.y} selected={selectedId === p.agent.id} onSelect={onSelect} />
      ))}
    </div>
  );
}
