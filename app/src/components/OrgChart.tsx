/**
 * OrgChart (W3 → "AI Office" orbital redesign) — Ally's brain hub at the
 * center, staff agents on concentric dashed orbital rings that slowly
 * revolve (hand-rolled CSS only: ring wrapper rotates, each node
 * counter-rotates so labels stay upright; mirrors the allygnment.com
 * ai-office hero). NO new dependencies. Nodes are real buttons
 * (keyboard-accessible); status stays truthful — working agents glow/pulse,
 * failed/offline dim (decoration only; semantics stay with
 * AgentStatusBadge, D5). prefers-reduced-motion stops the orbit; the
 * static ring layout remains.
 *
 * Layout is flat-hierarchy radial: every staff agent reports to Ally in
 * the current data model, so orbital rings around the hub are the honest
 * shape.
 */
import type { Agent } from '../domain/types';
import { AgentStatusBadge } from './ui';
import { BrainGlyph } from './BrainGlyph';

/** Ring geometry: inset (% of the square stage) per ring. ≤5 staff orbit on
 * one ring; more split across two concentric rings. */
const ONE_RING_INSETS = [10];
const TWO_RING_INSETS = [25, 6];
const RING_DURATIONS = ['48s', '72s'];

/** Distribute staff across 1–2 orbital rings (inner ring gets the extra node). */
export function distributeIntoRings<T>(items: T[]): T[][] {
  if (items.length <= 5) return [items];
  const inner = Math.ceil(items.length / 2);
  return [items.slice(0, inner), items.slice(inner)];
}

function initials(name: string) {
  return name
    .split(/\s+/)
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
}

function HubNode({ agent, selected, onSelect }: { agent: Agent; selected: boolean; onSelect: (a: Agent) => void }) {
  const working = agent.status === 'working';
  return (
    <button
      onClick={() => onSelect(agent)}
      aria-label={`${agent.name}, ${agent.status.replace(/_/g, ' ')}`}
      aria-pressed={selected}
      className="group absolute left-1/2 top-1/2 z-10 flex w-36 -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-1.5"
    >
      <span className="relative flex items-center justify-center">
        {working && <span aria-hidden className="absolute inline-flex h-full w-full animate-ping rounded-full bg-signal/30" />}
        <span
          className={`eaios-hub relative flex h-28 w-28 items-center justify-center rounded-full border-2 transition-shadow ${
            selected ? 'border-signal shadow-[0_0_22px_3px_rgba(50,197,255,0.5)]' : 'border-signal/40'
          }`}
          style={{ background: 'radial-gradient(circle at 35% 35%, rgba(50,197,255,0.22), rgba(5,9,20,0.95))' }}
        >
          <BrainGlyph className="h-14 w-14" />
        </span>
      </span>
      <span className={`text-center text-sm leading-tight ${selected ? 'font-medium text-signal' : 'text-ink'}`}>{agent.name}</span>
      <span className="-mt-1 text-center text-[10px] font-semibold uppercase tracking-wider text-signal/80">Orchestrator Agent</span>
      <AgentStatusBadge status={agent.status} />
    </button>
  );
}

function Node({ agent, selected, onSelect }: { agent: Agent; selected: boolean; onSelect: (a: Agent) => void }) {
  const working = agent.status === 'working';
  const dimmed = agent.status === 'failed' || agent.status === 'offline';
  return (
    <button
      onClick={() => onSelect(agent)}
      aria-label={`${agent.name}, ${agent.status.replace(/_/g, ' ')}`}
      aria-pressed={selected}
      className={`group flex w-20 flex-col items-center gap-1.5 ${dimmed ? 'opacity-50' : ''}`}
    >
      <span className="relative flex items-center justify-center">
        {working && <span aria-hidden className="absolute inline-flex h-full w-full animate-ping rounded-full bg-signal/30" />}
        <span
          className={`relative flex h-11 w-11 items-center justify-center rounded-full border text-xs font-semibold transition-shadow ${
            selected
              ? 'border-signal bg-signal/25 text-signal shadow-[0_0_18px_2px_rgba(50,197,255,0.45)]'
              : working
                ? 'border-signal/60 bg-signal/15 text-signal shadow-[0_0_14px_1px_rgba(50,197,255,0.35)]'
                : 'border-edge bg-canvas-raised text-ink-dim group-hover:border-signal/40'
          }`}
        >
          {initials(agent.name)}
        </span>
      </span>
      <span className={`text-center text-[11px] leading-tight ${selected ? 'font-medium text-signal' : 'text-ink'}`}>{agent.name}</span>
      <AgentStatusBadge status={agent.status} />
    </button>
  );
}

export function OrgChart({ agents, selectedId, onSelect }: { agents: Agent[]; selectedId?: string | null; onSelect: (a: Agent) => void }) {
  // Hub = the agent nobody reports to (Ally); fallback: first agent.
  const hub = agents.find((a) => !a.reportsToAgentId) ?? agents[0];
  const staff = agents.filter((a) => a.id !== hub?.id);
  if (!hub) return null;

  const rings = distributeIntoRings(staff);
  const insets = rings.length === 1 ? ONE_RING_INSETS : TWO_RING_INSETS;

  return (
    <div role="group" aria-label="Org chart" className="eaios-orgchart relative h-[26rem] w-full overflow-hidden rounded-xl border border-edge bg-canvas-raised">
      {/* Square stage centered in the panel — rings stay circular regardless of panel aspect. */}
      <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2" style={{ width: 'min(88%, 24rem)', aspectRatio: '1' }}>
        {rings.map((ring, ri) => {
          if (ring.length === 0) return null;
          const duration = RING_DURATIONS[ri] ?? RING_DURATIONS[0];
          const direction = ri % 2 === 1 ? 'reverse' : 'normal';
          return [
            // static dashed track
            <div
              key={`track-${ri}`}
              aria-hidden
              data-orbit-track
              className="absolute rounded-full border border-dashed"
              style={{ inset: `${insets[ri]}%`, borderColor: 'rgba(50,197,255,0.15)' }}
            />,
            // revolving wrapper — nodes ride the rotation and counter-rotate to stay upright
            <div key={`ring-${ri}`} className="eaios-orbit-ring" style={{ inset: `${insets[ri]}%`, animationDuration: duration, animationDirection: direction }}>
              {ring.map((agent, i) => {
                const theta = -Math.PI / 2 + (2 * Math.PI * i) / ring.length;
                const x = 50 + 50 * Math.cos(theta);
                const y = 50 + 50 * Math.sin(theta);
                return (
                  <div key={agent.id} className="absolute -translate-x-1/2 -translate-y-1/2" style={{ left: `${x}%`, top: `${y}%` }}>
                    <div className="eaios-orbit-counter" style={{ animationDuration: duration, animationDirection: direction }}>
                      <Node agent={agent} selected={selectedId === agent.id} onSelect={onSelect} />
                    </div>
                  </div>
                );
              })}
            </div>,
          ];
        })}
      </div>
      <HubNode agent={hub} selected={selectedId === hub.id} onSelect={onSelect} />
    </div>
  );
}
