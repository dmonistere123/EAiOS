/** My Assistant — chat with Ally (the ONLY chat target, D-B1) + per-agent
 * channel views: selecting an agent switches the CONTEXT (delegated work +
 * Ally↔agent chat, read-only), never the chat. Rail = the selected profile's
 * full conversation history (D-B2): Ally's sessions resume into the chat,
 * other agents' sessions open read-only in a drawer. */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AssistantSessionRef, ChatMessage } from '../domain/types';
import { hermes } from '../adapters';
import { Card, Drawer, SectionTitle, StateBadge, AgentStatusBadge, IndeterminateBar } from '../components/ui';
import { ChunkDrawer } from '../components/ChunkDrawer';
import { AgentChannel } from '../components/AgentChannel';
import { useRuntime, agentName, selectPendingApprovals, toast } from '../state/runtime';
import { usePageRail } from '../state/rail';
import type { RailSectionDef } from '../state/rail';

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

/** Read-only transcript of another agent's session (drawer — never a chat target, D-B1). */
function SessionTranscriptDrawer({ session, profile, agentName: speakerName, onClose }: { session: AssistantSessionRef; profile?: string; agentName: string; onClose: () => void }) {
  const [messages, setMessages] = useState<ChatMessage[] | null>(null);
  useEffect(() => {
    let stale = false;
    void hermes.getSessionTranscript(profile, session.id).then((rows) => {
      if (!stale) setMessages(rows);
    });
    return () => {
      stale = true;
    };
  }, [profile, session.id]);

  return (
    <Drawer title={session.title} onClose={onClose} width={480}>
      <p className="mb-3 flex items-center gap-2 text-[11px] text-ink-faint">
        <span className="rounded-full border border-edge px-2 py-0.5 font-medium uppercase tracking-wider">read-only</span>
        <span className="capitalize">{session.source}</span> · {session.messageCount} messages · Ally is the only agent you chat with
      </p>
      {messages === null ? (
        <p className="text-xs text-ink-faint">Loading transcript…</p>
      ) : messages.length === 0 ? (
        <p className="text-xs text-ink-dim">No conversation text in this session.</p>
      ) : (
        <ul className="space-y-2.5">
          {messages.map((m) => (
            <li key={m.id} className="rounded-lg bg-canvas px-3 py-2 text-xs">
              <div className="mb-0.5 text-[10px] font-semibold uppercase tracking-wider text-ink-faint">{m.role === 'you' ? 'User' : speakerName}</div>
              <div className="whitespace-pre-wrap text-ink-dim">{m.text}</div>
            </li>
          ))}
        </ul>
      )}
    </Drawer>
  );
}

export default function Assistant() {
  const s = useRuntime();
  // Ally = the default profile (id 'default' live, 'ally' in the mock fixture).
  const allyId = s.agents.find((a) => a.id === 'default')?.id ?? s.agents.find((a) => a.id === 'ally')?.id ?? s.agents[0]?.id ?? 'default';
  const [pickedAgentId, setPickedAgentId] = useState<string | null>(null);
  const contextId = pickedAgentId && s.agents.some((a) => a.id === pickedAgentId) ? pickedAgentId : allyId;
  const contextIsAlly = contextId === allyId;
  const contextAgent = s.agents.find((a) => a.id === contextId);
  const contextName = contextIsAlly ? 'Ally' : contextAgent?.name ?? contextId;

  const approvals = selectPendingApprovals(s);
  const [thread, setThread] = useState<ChatMessage[]>([]);
  const [streaming, setStreaming] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [openChunk, setOpenChunk] = useState<string | null>(null);
  const [openSession, setOpenSession] = useState<AssistantSessionRef | null>(null);
  const [sessions, setSessions] = useState<AssistantSessionRef[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Chat is ALWAYS Ally (D-B1): hydrate once, then ride streaming events.
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

  // D-B2: the selected profile's full conversation history (all sources).
  useEffect(() => {
    let stale = false;
    void hermes.listSessionsFor(contextIsAlly ? undefined : contextId).then((rows) => {
      if (!stale) setSessions(rows);
    });
    return () => {
      stale = true;
    };
  }, [contextId, contextIsAlly]);

  const resumeSession = useCallback(async (storedId: string) => {
    const res = await hermes.resumeAssistantSession(storedId);
    if (!res.ok) {
      toast('error', res.error?.safeMessage ?? 'Could not resume that conversation.');
      return;
    }
    toast('ok', 'Conversation resumed.');
    setStreaming(null);
    void hermes.getAssistantHistory().then(setThread);
  }, []);

  // W2: declare this page's rail — conversations for the selected profile.
  const railSections = useMemo<RailSectionDef[]>(
    () => [
      {
        key: 'conversations',
        title: `Conversations — ${contextName}`,
        count: sessions.length,
        node: (
          <ul className="space-y-1.5">
            {sessions.map((sess) => (
              <li key={sess.id}>
                <button
                  onClick={() => (contextIsAlly ? void resumeSession(sess.id) : setOpenSession(sess))}
                  className="w-full rounded-lg px-2 py-1.5 text-left hover:bg-canvas-overlay"
                  title={contextIsAlly ? 'Resume this conversation in the chat' : 'View transcript (read-only)'}
                >
                  <div className="truncate text-xs font-medium text-ink">{sess.title}</div>
                  {sess.preview && <div className="mt-0.5 truncate text-[11px] text-ink-faint">{sess.preview}</div>}
                  <div className="mt-0.5 flex items-center justify-between text-[11px] text-ink-faint">
                    <span className="capitalize">{sess.source}</span>
                    <span>{sess.messageCount} msg</span>
                  </div>
                </button>
              </li>
            ))}
            {sessions.length === 0 && <li className="px-2 text-xs text-ink-faint">No conversations yet.</li>}
          </ul>
        ),
      },
    ],
    [sessions, contextName, contextIsAlly, resumeSession],
  );
  usePageRail(railSections);

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

  const newChat = async () => {
    if (sending || streaming !== null) return;
    const res = await hermes.startNewAssistantChat();
    if (!res.ok) {
      toast('error', res.error?.safeMessage ?? 'Could not start a new chat.');
      return;
    }
    setStreaming(null);
    setThread([]);
    void hermes.getAssistantHistory().then(setThread);
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
      <header className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">My Assistant</h1>
          <p className="mt-1 text-sm text-ink-dim">Chat with Ally, your chief of staff. Pick an agent to see its channel — what Ally delegated and their Ally↔agent chat.</p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => void newChat()}
            disabled={busy}
            className="rounded-lg border border-edge bg-canvas px-3 py-2 text-sm text-ink hover:bg-canvas-overlay disabled:opacity-50"
          >
            New chat
          </button>
          <label className="text-xs font-medium uppercase tracking-wider text-ink-faint" htmlFor="assistant-agent">Context</label>
          <select
            id="assistant-agent"
            aria-label="Channel context"
            value={contextId}
            onChange={(e) => setPickedAgentId(e.target.value)}
            className="rounded-lg border border-edge bg-canvas px-3 py-2 text-sm text-ink"
          >
            {s.agents.map((a) => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
          </select>
          {contextAgent && <AgentStatusBadge status={contextAgent.status} />}
        </div>
      </header>

      <div className="grid gap-4 xl:grid-cols-5">
        {/* conversation — always Ally */}
        <Card className="flex flex-col p-4 xl:col-span-3">
          <SectionTitle>Conversation with Ally</SectionTitle>
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

        {/* context column — Ally: orchestration; staff agent: channel view */}
        <div className="space-y-4 xl:col-span-2">
          {contextIsAlly ? (
            <>
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
            </>
          ) : (
            <AgentChannel agentId={contextId} agentName={contextName} />
          )}
        </div>
      </div>

      {openChunk && <ChunkDrawer chunkId={openChunk} onClose={() => setOpenChunk(null)} />}
      {openSession && !contextIsAlly && (
        <SessionTranscriptDrawer session={openSession} profile={contextId} agentName={contextName} onClose={() => setOpenSession(null)} />
      )}
    </div>
  );
}
