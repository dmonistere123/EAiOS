/**
 * AgentChannel — read-only view of a staff agent's channel (D-B1): the work
 * Ally delegated to it plus the Ally↔agent chat (canonical "Bot Chat").
 * The user never chats with the agent directly. Shared by Assistant (W1)
 * and Staff (W3).
 */
import { useEffect, useState } from 'react';
import type { AgentChannel as AgentChannelData } from '../domain/types';
import { hermes } from '../adapters';
import { Card, SectionTitle, StateBadge } from './ui';

/** Shared data path for an agent's channel (W1) — used by the AgentChannel
 * card view (Assistant) and the Staff per-agent rail (W3). */
export function useAgentChannel(agentId: string | null): AgentChannelData | null {
  const [channel, setChannel] = useState<AgentChannelData | null>(null);

  useEffect(() => {
    if (!agentId) {
      setChannel(null);
      return;
    }
    let stale = false;
    setChannel(null);
    void hermes.getChannelFor(agentId).then((c) => {
      if (!stale) setChannel(c);
    });
    return () => {
      stale = true;
    };
  }, [agentId]);

  return channel;
}

export function AgentChannel({ agentId, agentName }: { agentId: string; agentName: string }) {
  const channel = useAgentChannel(agentId);

  if (!channel) return <p className="text-xs text-ink-faint">Loading {agentName}'s channel…</p>;

  return (
    <>
      <Card className="p-4">
        <SectionTitle>Delegated to {agentName}</SectionTitle>
        {channel.delegations.length === 0 ? (
          <p className="text-xs text-ink-dim">Nothing delegated to {agentName} right now.</p>
        ) : (
          <ul className="space-y-2">
            {channel.delegations.map((w) => (
              <li key={w.id} className="flex items-center justify-between gap-2 text-xs">
                <span className="truncate text-ink">{w.title}</span>
                <StateBadge label={w.state.replace('_', ' ')} tone={w.state === 'in_progress' ? 'signal' : w.state === 'waiting_approval' ? 'warn' : 'neutral'} />
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card className="p-4">
        <SectionTitle
          right={<span className="rounded-full border border-edge px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-ink-faint">read-only</span>}
        >
          Ally ↔ {agentName}
        </SectionTitle>
        {channel.agentChat === null ? (
          <p className="text-xs text-ink-dim">No Ally↔{agentName} chat yet — one appears here the first time Ally messages {agentName}.</p>
        ) : (
          <ul className="space-y-2.5">
            {channel.agentChat.map((m) => (
              <li key={m.id} className="rounded-lg bg-canvas px-3 py-2 text-xs">
                <div className="mb-0.5 text-[10px] font-semibold uppercase tracking-wider text-ink-faint">
                  {m.role === 'you' ? 'Ally' : agentName}
                </div>
                <div className="whitespace-pre-wrap text-ink-dim">{m.text}</div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
