/**
 * DelegatedRunDrawer (Don 2026-08-29) — read one delegated run: the result
 * up top, the worker's REAL transcript below (resume+history via the
 * deny-listed kanban session — read-only, never a chat target, D-B1).
 * Shared by the Assistant rail's "Delegated runs" section and Schedule's
 * completed-24h rows.
 */
import { useEffect, useState } from 'react';
import type { ChatMessage, DelegatedRun } from '../domain/types';
import { hermes } from '../adapters';
import { Drawer, StateBadge } from './ui';
import { agentName, useRuntime } from '../state/runtime';

export function DelegatedRunDrawer({ run, onClose }: { run: DelegatedRun; onClose: () => void }) {
  const s = useRuntime();
  const [messages, setMessages] = useState<ChatMessage[] | null>(null);
  const speaker = agentName(s, run.assignee);
  // 'default' profile reads take no profile param; specialists read their own.
  const profile = run.assignee === 'default' || run.assignee === 'ally' ? undefined : run.assignee;

  useEffect(() => {
    if (!run.workerSessionId) return;
    let stale = false;
    void hermes.getSessionTranscript(profile, run.workerSessionId).then((rows) => {
      if (!stale) setMessages(rows);
    });
    return () => {
      stale = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run.taskId]);

  return (
    <Drawer title={run.title} onClose={onClose} width={520}>
      <p className="mb-3 flex flex-wrap items-center gap-2 text-[11px] text-ink-faint">
        <span className="rounded-full border border-edge px-2 py-0.5 font-medium uppercase tracking-wider">read-only</span>
        <StateBadge label={run.status} tone={run.status === 'done' ? 'ok' : run.status === 'running' ? 'signal' : 'neutral'} />
        <span>{speaker}</span>
        {run.workerMessageCount != null && <span>· {run.workerMessageCount} messages</span>}
      </p>

      {run.result && (
        <div className="mb-4 rounded-lg border border-ok/30 bg-ok/5 p-3">
          <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-ok/80">Result</div>
          <p className="whitespace-pre-wrap text-xs text-ink">{run.result}</p>
        </div>
      )}

      {run.workerSessionId ? (
        messages === null ? (
          <p className="text-xs text-ink-faint">Loading transcript…</p>
        ) : messages.length === 0 ? (
          <p className="text-xs text-ink-dim">No transcript recorded for this run.</p>
        ) : (
          <>
            <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-ink-faint">Worker transcript</div>
            <ul className="space-y-2.5">
              {messages.map((m) => (
                <li key={m.id} className="rounded-lg bg-canvas px-3 py-2 text-xs">
                  <div className="mb-0.5 text-[10px] font-semibold uppercase tracking-wider text-ink-faint">{m.role === 'you' ? 'Dispatch' : speaker}</div>
                  <div className="whitespace-pre-wrap text-ink-dim">{m.text}</div>
                </li>
              ))}
            </ul>
          </>
        )
      ) : (
        <p className="text-xs text-ink-dim">
          {run.status === 'running' || run.status === 'ready' ? 'This run is still in flight — the transcript appears when the worker session is recorded.' : 'No worker session was recorded for this task.'}
        </p>
      )}
    </Drawer>
  );
}
