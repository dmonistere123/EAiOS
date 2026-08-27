/** My Assistant — Ally: live conversation + visible orchestration (spec §8.2). */
import { useEffect, useRef, useState } from 'react';
import type { ChatMessage } from '../domain/types';
import { hermes } from '../adapters';
import { Card, SectionTitle, StateBadge, AgentStatusBadge, IndeterminateBar } from '../components/ui';
import { ChunkDrawer } from '../components/ChunkDrawer';
import { useRuntime, agentName, selectPendingApprovals, toast } from '../state/runtime';

/** 6.4b: citation refs Ally emits per the Phase 5 contract (`eaios://chunk/<id>`). */
export function parseCitations(text: string): string[] {
  const ids = new Set<string>();
  for (const m of text.matchAll(/eaios:\/\/chunk\/([A-Za-z0-9_-]+)/g)) ids.add(m[1]);
  return [...ids];
}

function CitationChips({ text, onOpen }: { text: string; onOpen: (chunkId: string) => void }) {
  const ids = parseCitations(text);
  if (!ids.length) return null;
  return (
    <div className="mt-1.5 flex flex-wrap gap-1.5">
      {ids.map((id, i) => (
        <button
          key={id}
          onClick={() => onOpen(id)}
          title={`Open source chunk ${id}`}
          className="rounded-md border border-signal/30 bg-signal/10 px-2 py-0.5 text-[10px] font-medium text-signal hover:bg-signal/20"
        >
          ⧉ source {i + 1}
        </button>
      ))}
    </div>
  );
}

export default function Assistant() {
  const s = useRuntime();
  const ally = s.agents.find((a) => a.id === 'ally' || a.id === 'default');
  const approvals = selectPendingApprovals(s);
  const [thread, setThread] = useState<ChatMessage[]>([]);
  const [streaming, setStreaming] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [openChunk, setOpenChunk] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Hydrate the authoritative history once, then ride streaming events.
  useEffect(() => {
    void hermes.getAssistantHistory().then(setThread);
    const unsub = hermes.subscribeAssistant((e) => {
      if (e.kind === 'start') setStreaming('');
      else if (e.kind === 'delta') setStreaming((t) => (t ?? '') + e.text);
      else if (e.kind === 'complete') {
        setStreaming(null);
        void hermes.getAssistantHistory().then(setThread); // authoritative, deduped by row_id
      } else if (e.kind === 'error') {
        setStreaming(null);
        toast('error', e.message);
      }
    });
    return unsub;
  }, []);

  // Keep the latest exchange in view.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [thread, streaming]);

  const send = async () => {
    const text = draft.trim();
    if (!text || sending || streaming !== null) return;
    setSending(true);
    setDraft('');
    const optimistic: ChatMessage = { id: `opt-${Date.now()}`, role: 'you', text, at: new Date().toISOString() };
    setThread((t) => [...t, optimistic]);
    const res = await hermes.sendAssistantMessage(text);
    setSending(false);
    if (!res.ok) {
      setThread((t) => t.filter((m) => m.id !== optimistic.id)); // never pretend it sent
      toast('error', res.error?.safeMessage ?? 'Message failed to send.');
    }
  };

  const busy = sending || streaming !== null;
  const activeWork = s.work
    .filter((w) => w.state === 'in_progress' || w.state === 'waiting_approval')
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, 5);
  const knowledgeReady = s.knowledge.filter((k) => k.indexingStatus === 'ready').length;
  const knowledgeIndexing = s.knowledge.filter((k) => k.indexingStatus === 'processing').length;

  return (
    <div className="space-y-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">My Assistant</h1>
          <p className="mt-1 text-sm text-ink-dim">Ally — chief of staff. Conversation plus what it's actually doing.</p>
        </div>
        {ally && <AgentStatusBadge status={ally.status} />}
      </header>

      <div className="grid gap-4 xl:grid-cols-5">
        {/* conversation */}
        <Card className="flex flex-col p-4 xl:col-span-3">
          <SectionTitle>Conversation</SectionTitle>
          <div ref={scrollRef} className="max-h-[52vh] flex-1 space-y-3 overflow-y-auto">
            {thread.length === 0 && streaming === null && (
              <p className="text-xs text-ink-faint">Starting a conversation with Ally…</p>
            )}
            {thread.map((m) => (
              <div key={m.id} className={`max-w-[85%] rounded-xl px-4 py-2.5 text-sm ${m.role === 'you' ? 'ml-auto bg-signal/15 text-ink' : 'bg-canvas-overlay text-ink'}`}>
                <div className="mb-0.5 text-[10px] font-semibold uppercase tracking-wider text-ink-faint">{m.role === 'you' ? 'You' : 'Ally'}</div>
                <div className="whitespace-pre-wrap">{m.text}</div>
                {m.role === 'ally' && <CitationChips text={m.text} onOpen={setOpenChunk} />}
              </div>
            ))}
            {streaming !== null && (
              <div className="max-w-[85%] rounded-xl bg-canvas-overlay px-4 py-2.5 text-sm text-ink">
                <div className="mb-0.5 text-[10px] font-semibold uppercase tracking-wider text-ink-faint">Ally</div>
                {streaming ? <div className="whitespace-pre-wrap">{streaming}</div> : <IndeterminateBar />}
              </div>
            )}
          </div>
          <form
            className="mt-4 flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void send();
            }}
          >
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder={busy ? 'Ally is responding…' : 'Message Ally…'}
              aria-label="Message Ally"
              className="flex-1 rounded-lg border border-edge bg-canvas px-3 py-2 text-sm text-ink placeholder:text-ink-faint"
            />
            <button type="submit" disabled={busy || !draft.trim()} className="rounded-lg bg-signal px-4 py-2 text-sm font-semibold text-canvas hover:bg-signal/90 disabled:opacity-50">
              Send
            </button>
          </form>
        </Card>

        {/* orchestration */}
        <div className="space-y-4 xl:col-span-2">
          <Card className="p-4">
            <SectionTitle>Current orchestration</SectionTitle>
            {activeWork.length === 0 ? (
              <p className="text-xs text-ink-dim">No active agent work right now.</p>
            ) : (
              <ol className="space-y-3">
                {activeWork.map((w, i) => (
                  <li key={w.id} className="flex items-start gap-3">
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-edge bg-canvas text-[11px] text-ink-dim">{i + 1}</span>
                    <div className="min-w-0 flex-1">
                      <div className="text-sm text-ink">{w.title}</div>
                      <div className="mt-0.5 flex items-center gap-2 text-xs text-ink-faint">
                        {w.ownerId ? agentName(s, w.ownerId) : 'Executive'} <StateBadge label={w.state.replace('_', ' ')} tone={w.state === 'in_progress' ? 'signal' : 'warn'} />
                      </div>
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </Card>

          <Card className="p-4">
            <SectionTitle>Context in scope</SectionTitle>
            <ul className="space-y-1.5 text-xs text-ink-dim">
              <li>Workspace: <span className="text-ink">EAiOS</span></li>
              <li>
                Knowledge: <span className="text-ink">{knowledgeReady} source{knowledgeReady === 1 ? '' : 's'} ready{knowledgeIndexing ? `, ${knowledgeIndexing} indexing` : ''}</span>
              </li>
            </ul>
          </Card>

          <Card className="border-warn/25 p-4">
            <SectionTitle>Approval forecast</SectionTitle>
            {approvals.length === 0 ? (
              <p className="text-xs text-ink-dim">No external actions expected to need approval.</p>
            ) : (
              <ul className="space-y-2">
                {approvals.map((a) => (
                  <li key={a.id} className="text-xs text-ink-dim">
                    <span className="text-ink">{a.targetObject ?? a.targetSystem}</span> — {a.actionType} via {a.targetSystem}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>

      {openChunk && <ChunkDrawer chunkId={openChunk} onClose={() => setOpenChunk(null)} />}
    </div>
  );
}
