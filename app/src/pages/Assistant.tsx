/** My Assistant — chat with Ally (the ONLY chat target, D-B1) + per-agent
 * channel views: selecting an agent switches the CONTEXT (delegated work +
 * Ally↔agent chat, read-only), never the chat. Rail = the selected profile's
 * full conversation history (D-B2): Ally's sessions resume into the chat,
 * other agents' sessions open read-only in a drawer. */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AssistantSessionRef, ChatMessage, DelegatedRun } from '../domain/types';
import { hermes } from '../adapters';
import type { AssistantAttachment } from '../adapters/interfaces';
import { Card, Drawer, SectionTitle, StateBadge, AgentStatusBadge } from '../components/ui';
import { useVoice } from '../hooks/useVoice';
import { ChunkDrawer } from '../components/ChunkDrawer';
import { AgentChannel } from '../components/AgentChannel';
import { DelegatedRunDrawer } from '../components/DelegatedRunDrawer';
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
  const draftRef = useRef(draft);
  useEffect(() => {
    draftRef.current = draft;
  }, [draft]);
  const [sending, setSending] = useState(false);
  const [attachments, setAttachments] = useState<AssistantAttachment[]>([]);
  const [attachBusy, setAttachBusy] = useState(false);
  const [openChunk, setOpenChunk] = useState<string | null>(null);
  const [openSession, setOpenSession] = useState<AssistantSessionRef | null>(null);
  const [sessions, setSessions] = useState<AssistantSessionRef[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);

  const voice = useVoice((text) => {
    setDraft(text);
    draftRef.current = text;
    // Auto-send after a short delay so the user sees the transcribed text.
    setTimeout(() => {
      if (draftRef.current.trim()) {
        void send();
      }
    }, 300);
  });

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

  // Delegated runs (Don 2026-08-29): every executed task appears as a
  // read-only session in the rail — Ally context sees all staff runs, an
  // agent context sees only its own.
  const [runs, setRuns] = useState<DelegatedRun[]>([]);
  const [openRun, setOpenRun] = useState<DelegatedRun | null>(null);
  useEffect(() => {
    let stale = false;
    void hermes.listDelegatedRuns().then((rows) => {
      if (!stale) setRuns(rows);
    });
    return () => {
      stale = true;
    };
  }, []);
  const contextRuns = useMemo(() => {
    const allyIds = new Set(['default', 'ally', allyId]);
    return runs.filter((r) => (contextIsAlly ? true : r.assignee === contextId || (allyIds.has(r.assignee) && allyIds.has(contextId))));
  }, [runs, contextId, contextIsAlly, allyId]);

  // Don 2026-08-29: worker sessions ARE Ally (or agent) sessions — they
  // belong in Conversations alongside Desktop/Telegram/Cron, not only in
  // the separate runs section. The gateway deny-lists kanban sources from
  // session.list, so merge them client-side from the runs read.
  const allSessions = useMemo(() => {
    const runSessions: AssistantSessionRef[] = contextRuns
      .filter((r) => r.workerSessionId)
      .map((r) => ({
        id: r.workerSessionId!,
        title: r.title,
        preview: (r.result ?? '').slice(0, 80),
        startedAt: r.createdAt,
        messageCount: r.workerMessageCount ?? 0,
        source: 'kanban',
      }));
    const seen = new Set(sessions.map((s) => s.id));
    return [...sessions, ...runSessions.filter((r) => !seen.has(r.id))].sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  }, [sessions, contextRuns]);

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
  const openKanbanRun = useCallback(
    (sess: AssistantSessionRef) => {
      const run = contextRuns.find((r) => r.workerSessionId === sess.id);
      setOpenRun(
        run ?? {
          taskId: sess.id,
          title: sess.title,
          assignee: contextId,
          status: 'done',
          createdAt: sess.startedAt,
          workerSessionId: sess.id,
          workerMessageCount: sess.messageCount,
        },
      );
    },
    [contextRuns, contextId],
  );
  const railSections = useMemo<RailSectionDef[]>(
    () => [
      {
        key: 'conversations',
        title: `Conversations — ${contextName}`,
        count: allSessions.length,
        node: (
          <ul className="space-y-1.5">
            {allSessions.map((sess) => (
              <li key={sess.id}>
                <button
                  onClick={() => (sess.source === 'kanban' ? openKanbanRun(sess) : contextIsAlly ? void resumeSession(sess.id) : setOpenSession(sess))}
                  className="w-full rounded-lg px-2 py-1.5 text-left hover:bg-canvas-overlay"
                  title={sess.source === 'kanban' ? 'Delegated run — view result + transcript (read-only)' : contextIsAlly ? 'Resume this conversation in the chat' : 'View transcript (read-only)'}
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
            {allSessions.length === 0 && <li className="px-2 text-xs text-ink-faint">No conversations yet.</li>}
          </ul>
        ),
      },
      {
        key: 'delegated-runs',
        title: 'Delegated runs',
        count: contextRuns.length,
        node: (
          <ul className="space-y-1.5">
            {contextRuns.slice(0, 15).map((run) => (
              <li key={run.taskId}>
                <button
                  onClick={() => setOpenRun(run)}
                  className="w-full rounded-lg px-2 py-1.5 text-left hover:bg-canvas-overlay"
                  title="View result + worker transcript (read-only)"
                >
                  <div className="truncate text-xs font-medium text-ink">{run.title}</div>
                  <div className="mt-0.5 flex items-center justify-between text-[11px] text-ink-faint">
                    <span className="capitalize">{run.status}</span>
                    <span>{run.workerMessageCount != null ? `${run.workerMessageCount} msg` : '—'}</span>
                  </div>
                </button>
              </li>
            ))}
            {contextRuns.length === 0 && <li className="px-2 text-xs text-ink-faint">No delegated runs yet — assign a task and it shows up here.</li>}
          </ul>
        ),
      },
    ],
    [allSessions, contextRuns, contextName, contextIsAlly, resumeSession, openKanbanRun],
  );
  usePageRail(railSections);

  const send = async () => {
    const text = draftRef.current.trim();
    if ((!text && attachments.length === 0) || sending || streaming !== null) return;
    setSending(true);
    setDraft('');
    draftRef.current = '';
    const displayText = text || `[${attachments.length} attachment${attachments.length === 1 ? '' : 's'}]`;
    const optimistic: ChatMessage = { id: `opt-${Date.now()}`, role: 'you', text: displayText, at: new Date().toISOString() };
    setThread((t) => [...t, optimistic]);
    const toSend = attachments;
    setAttachments([]);
    const res = await hermes.sendAssistantMessage(text, { attachments: toSend });
    setSending(false);
    if (!res.ok) {
      setThread((t) => t.filter((m) => m.id !== optimistic.id)); // never pretend it sent
      toast('error', res.error?.safeMessage ?? 'Message failed to send.');
    }
  };

  const handleFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    setAttachBusy(true);
    const textish = /^(text\/|application\/(json|csv|pdf|msword|vnd\.openxmlformats-officedocument\.wordprocessingml\.document)|message\/rfc822)/;
    const loaded: AssistantAttachment[] = [];
    for (const file of Array.from(files)) {
      if (file.size > 2_000_000) {
        toast('error', `${file.name} is too large (2 MB max for chat upload).`);
        continue;
      }
      const isText = textish.test(file.type);
      const content = await new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result ?? ''));
        reader.readAsText(file);
      });
      if (isText && content.length > 0) {
        loaded.push({ name: file.name, mimeType: file.type || 'text/plain', content, encoding: 'text' });
      } else {
        const b64 = await new Promise<string>((resolve) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result ?? '').split(',')[1] ?? '');
          reader.readAsDataURL(file);
        });
        loaded.push({ name: file.name, mimeType: file.type || 'application/octet-stream', content: b64, encoding: 'base64' });
      }
    }
    setAttachments((prev) => [...prev, ...loaded]);
    setAttachBusy(false);
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
                <div className="mb-0.5 flex items-center justify-between gap-2">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-ink-faint">{m.role === 'you' ? 'You' : 'Ally'}</span>
                  {m.role === 'ally' && voice.supported && (
                    <button
                      type="button"
                      onClick={() => voice.speak(m.text)}
                      title="Read aloud"
                      aria-label="Read aloud"
                      className="text-[10px] text-ink-faint hover:text-signal"
                    >
                      {voice.speaking ? '■' : '🔊'}
                    </button>
                  )}
                </div>
                <div className="whitespace-pre-wrap">{m.text}</div>
                {m.role === 'ally' && <CitationChips text={m.text} onOpen={setOpenChunk} />}
              </div>
            ))}
            {(streaming !== null || sending) && (
              <div className="max-w-[85%] rounded-xl bg-canvas-overlay px-4 py-2.5 text-sm text-ink">
                <div className="mb-0.5 text-[10px] font-semibold uppercase tracking-wider text-ink-faint">Ally</div>
                {streaming ? (
                  <div className="whitespace-pre-wrap">{streaming}</div>
                ) : (
                  /* visible proof of life between send and first streamed token (dogfood ask 2026-08-29) */
                  <div className="flex items-center gap-1.5 py-1" role="status" aria-label="Ally is working">
                    <span className="eaios-typing-dot" />
                    <span className="eaios-typing-dot" />
                    <span className="eaios-typing-dot" />
                  </div>
                )}
              </div>
            )}
          </div>
          <form
            className="mt-4 space-y-2"
            onSubmit={(e) => {
              e.preventDefault();
              void send();
            }}
          >
            {attachments.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {attachments.map((a) => (
                  <span key={a.name} className="inline-flex items-center gap-1 rounded-md border border-edge bg-canvas-overlay px-2 py-0.5 text-[11px] text-ink-dim">
                    📎 {a.name}
                    <button type="button" onClick={() => setAttachments((prev) => prev.filter((x) => x !== a))} className="text-ink-faint hover:text-risk">&times;</button>
                  </span>
                ))}
              </div>
            )}
            <div className="flex gap-2">
              <input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder={busy ? 'Ally is responding…' : voice.listening ? 'Listening…' : 'Message Ally…'}
                aria-label="Message Ally"
                className="flex-1 rounded-lg border border-edge bg-canvas px-3 py-2 text-sm text-ink placeholder:text-ink-faint"
              />
              <button
                type="button"
                onClick={() => (voice.listening ? voice.stopListening() : voice.startListening())}
                disabled={busy || !voice.supported}
                aria-label={voice.supported ? (voice.listening ? 'Stop listening' : 'Speak to Ally') : 'Voice not supported in this browser'}
                className={`rounded-lg border px-3 py-2 text-sm disabled:opacity-50 ${voice.listening ? 'border-risk/40 bg-risk/10 text-risk' : 'border-edge bg-canvas text-ink hover:bg-canvas-overlay'}`}
              >
                {voice.listening ? '⏹' : '🎤'}
              </button>
              <label className="cursor-pointer rounded-lg border border-edge bg-canvas px-3 py-2 text-sm text-ink hover:bg-canvas-overlay disabled:opacity-50">
                {attachBusy ? '…' : '📎'}
                <input type="file" multiple className="hidden" onChange={(e) => void handleFiles(e.target.files)} disabled={busy || attachBusy} />
              </label>
              <button type="submit" disabled={busy || (!draft.trim() && attachments.length === 0)} className="rounded-lg bg-signal px-4 py-2 text-sm font-semibold text-canvas hover:bg-signal/90 disabled:opacity-50">
                Send
              </button>
            </div>
            {voice.error && <p className="text-[10px] text-risk">{voice.error}</p>}
            <p className="text-[10px] text-ink-faint">Text files are read inline; binary files are sent as base64 (2 MB max each).</p>
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
      {openRun && <DelegatedRunDrawer run={openRun} onClose={() => setOpenRun(null)} />}
    </div>
  );
}
