import { CitationChips } from './CitationChips';
import { ChunkDrawer } from './ChunkDrawer';
import { AGENT_NAME } from '../config';
import { useVoice } from '../hooks/useVoice';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { hermes } from '../adapters';
import type { AssistantConversation, RequestView } from '../domain/assistantRequest';
import type { ChatMessage } from '../domain/types';
import type { AssistantAttachment } from '../adapters/interfaces';
const done = (r: RequestView) => ['completed', 'recovered', 'cancelled', 'interrupted'].includes(r.state);
export function AssistantRequests({ selection, onSelect, onRows }: { selection?: AssistantConversation | null; onSelect?: (value: AssistantConversation | null) => void; onRows?: (rows: RequestView[]) => void } = {}) {
  const [localSelection, setLocalSelection] = useState<AssistantConversation | null>(null);
  const conversation = selection === undefined ? localSelection : selection;
  const selectionKey = `${conversation?.profile ?? ''}:${conversation?.id ?? ''}`;
  const selectionKeyRef = useRef(selectionKey); selectionKeyRef.current = selectionKey;
  const select = (value: AssistantConversation | null) => { setLocalSelection(value); onSelect?.(value); };
  const [history, setHistory] = useState<ChatMessage[]>([]);
  const [historyError, setHistoryError] = useState('');
  const [historyLoading, setHistoryLoading] = useState(false);
  const [baselineIds, setBaselineIds] = useState<Set<string>>(new Set());
  const [pendingRequestId, setPendingRequestId] = useState<string | null>(null);
  const initialized = useRef(!!selection);
  const following = useRef(true);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [awayFromBottom, setAwayFromBottom] = useState(false);
  const [openChunk, setOpenChunk] = useState<string | null>(null);
  const [rows, setRows] = useState<RequestView[]>(() => hermes.cachedAssistantRequests?.() ?? []);
  const [draft, setDraft] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const promptRef = useRef<HTMLTextAreaElement>(null);
  const [sessionNotice, setSessionNotice] = useState('');
  const [attachments, setAttachments] = useState<AssistantAttachment[]>([]);
  const submittingRef = useRef(false);
  const [submitting, setSubmitting] = useState(false);
  const [loadingFiles, setLoadingFiles] = useState(false);
  const [connection, setConnection] = useState('');
  const [error, setError] = useState('');
  const [now, setNow] = useState(() => Date.now());
  const voice = useVoice(text => { setDraft(text); void send(text); }, setDraft);
  useEffect(() => {
    let active = true; let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try { const result = await hermes.listAssistantRequests!(); if (active) { setRows(result); setConnection(''); } }
      catch { if (active) setConnection('Connection lost — checking status. Accepted work may still be running.'); }
      finally { if (active) { setNow(Date.now()); timer = setTimeout(poll, 2000); } }
    };
    void poll();
    return () => { active = false; clearTimeout(timer); };
  }, []);
  async function send(text = draft) {
    if (submittingRef.current || loadingFiles || historyLoading || historyError || conversationBusy || (!text.trim() && !attachments.length)) return;
    voice.cancelListening(false);
    const sentFrom = selectionKey;
    submittingRef.current = true; setSubmitting(true); setError('');
    try {
      following.current = true; setAwayFromBottom(false);
      const row = await hermes.createAssistantRequest!(text.trim(), attachments, conversation ? { id: conversation.id, profile: conversation.profile } : undefined);
      setRows(current => [...current.filter(r => r.id !== row.id), row]);
      if (selectionKeyRef.current === sentFrom) {
        setPendingRequestId(row.id); initialized.current = true; setDraft(''); setAttachments([]);
      }
    } catch { if (selectionKeyRef.current === sentFrom) setError('Could not save a recovery receipt. Your prompt has not been sent.'); }
    finally { submittingRef.current = false; setSubmitting(false); }
  }
  const upload = async (files: FileList | null) => {
    if (!files) return;
    const uploadedFrom = selectionKey;
    setLoadingFiles(true); setError('');
    try {
      const selected = [...files];
      if (selected.length + attachments.length > 10 || selected.some(f => f.size > 2000000)) throw new Error('Use up to 10 files, no more than 2 MB each.');
      const added = await Promise.all(selected.map(async f => {
        const textish = /^(text\/|application\/(json|csv|pdf|msword|vnd\.openxmlformats-officedocument\.wordprocessingml\.document)|message\/rfc822)/;
        if (textish.test(f.type) || /\.(md|txt|csv|json)$/i.test(f.name)) return { name: f.name, mimeType: f.type || 'text/plain', content: await f.text(), encoding: 'text' as const };
        const content = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result ?? '').split(',')[1] ?? ''); reader.onerror = () => reject(new Error('Could not read file')); reader.readAsDataURL(f); });
        return { name: f.name, mimeType: f.type || 'application/octet-stream', content, encoding: 'base64' as const };
      }));
      if (JSON.stringify([...attachments, ...added]).length > 4000000) throw new Error('Combined attachments must be smaller than 4 MB.');
      if (selectionKeyRef.current === uploadedFrom) setAttachments(current => [...current, ...added]);
    } catch (e) { if (selectionKeyRef.current === uploadedFrom) setError(e instanceof Error ? e.message : 'Could not read attachment'); }
    finally { setLoadingFiles(false); }
  };
  const rowsRef = useRef(rows); rowsRef.current = rows;
  useEffect(() => { onRows?.(rows); }, [rows, onRows]);
  useEffect(() => {
    const pending = rows.find(r => r.id === pendingRequestId);
    const latest = pending ?? (!initialized.current ? [...rows].sort((a,b) => b.createdAt.localeCompare(a.createdAt))[0] : undefined);
    if (!latest) return;
    const id = latest.conversationId ?? latest.storedSessionId;
    if (id && !conversation) { initialized.current = true; select({ id, title: latest.text.slice(0, 80), profile: latest.profile }); }
    // Selection is controlled by explicit history clicks or the first saved turn.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, pendingRequestId, conversation?.id]);
  useEffect(() => {
    let cancelled = false;
    following.current = true; setAwayFromBottom(false); setHistory([]); setHistoryError('');
    setDraft(''); setAttachments([]); setPendingRequestId(null); setSessionNotice(''); setError('');
    voice.cancelListening(false); voice.stopSpeaking();
    if (!conversation || !hermes.getSessionTranscript) { setBaselineIds(new Set()); setHistoryLoading(false); return; }
    const snapshot = rowsRef.current.filter(r => (r.conversationId ?? r.storedSessionId) === conversation.id);
    setHistoryLoading(true);
    void hermes.getSessionTranscript(conversation.profile, conversation.id).then(messages => {
      if (cancelled) return;
      // Live receipt cards own incomplete turns; don't duplicate their user text
      // or partial answer from the read-only history snapshot.
      const active = snapshot.filter(r => !done(r));
      const start = messages.findLastIndex(m => m.role === 'you' && active.some(r => r.text === m.text && Date.parse(m.at) >= Date.parse(r.createdAt) - 1000));
      setHistory(start >= 0 ? messages.slice(0, start) : messages);
      setBaselineIds(new Set(snapshot.filter(done).map(r => r.id)));
    }).catch(() => { if (!cancelled) { if (!snapshot.some(r => !done(r))) setHistoryError('Could not load this conversation. Refresh before sending.'); setBaselineIds(new Set()); } })
      .finally(() => { if (!cancelled) setHistoryLoading(false); });
    return () => { cancelled = true; };
    // Selection changes alone load history; voice callbacks and polling rows must not restart it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversation?.id, conversation?.profile]);
  const visibleRows = rows.filter(row => !baselineIds.has(row.id) && (conversation
    ? (row.conversationId ?? row.storedSessionId) === conversation.id || row.id === pendingRequestId && !row.storedSessionId
    : row.id === pendingRequestId || !initialized.current));
  const conversationBusy = visibleRows.some(row => !done(row));
  useLayoutEffect(() => {
    if (following.current && scrollRef.current) scrollRef.current.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'instant' });
  }, [rows, history, conversation?.id]);
  function scrollToLatest() { following.current = true; setAwayFromBottom(false); scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' }); }
  function newSession() {
    if (submitting || loadingFiles) return;
    voice.cancelListening(false);
    voice.stopSpeaking();
    setDraft(''); setAttachments([]); setError(''); setOpenChunk(null);
    initialized.current = true; select(null); setPendingRequestId(null); setHistory([]); setBaselineIds(new Set()); following.current = true;
    setSessionNotice('New conversation ready. Your earlier conversations are saved in the Conversations sidebar.');
    promptRef.current?.focus();
  }
  return <section aria-label="Assistant requests" className="flex min-h-0 flex-1 flex-col gap-4">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h2 className="text-sm font-semibold">{conversation?.title || `Conversation with ${AGENT_NAME}`}</h2>
      <div className="flex flex-wrap gap-2">

        <button type="button" onClick={newSession} disabled={submitting || loadingFiles} title="Start a separate conversation. Earlier conversations and running work remain saved." className="rounded-lg border border-signal/50 bg-signal/10 px-3 py-2 text-sm font-semibold text-ink hover:bg-signal/20 focus-visible:outline-2 focus-visible:outline-signal disabled:opacity-50">New Session</button>
      </div>
    </div>
    {sessionNotice && <p role="status" className="text-xs text-ink-dim">{sessionNotice}</p>}
    <p className="text-xs text-ink-dim">Choose a saved conversation to continue it, or start a New Session.</p>
    {connection && <p role="status" className="text-sm text-warn">{connection}</p>}
    <div ref={scrollRef} aria-label="Conversation messages" onScroll={() => { const el = scrollRef.current; if (el) { const near = el.scrollHeight - el.scrollTop - el.clientHeight < 80; following.current = near; setAwayFromBottom(!near); } }} className="min-h-0 flex-1 space-y-4 overflow-y-auto">
      {historyLoading && <p role="status">Loading conversation…</p>}
      {historyError && <p role="alert" className="text-sm text-risk">{historyError}</p>}
      {history.filter(m => m.text.trim()).map(m => <div key={m.id} className={`max-w-[90%] whitespace-pre-wrap rounded-xl px-4 py-3 text-sm ${m.role === 'you' ? 'ml-auto bg-signal/15' : 'bg-canvas-overlay'}`}>{m.text}</div>)}
      {visibleRows.length === 0 && history.length === 0 && !historyLoading && <p className="text-sm text-ink-dim">Ask a question to start this conversation.</p>}
      {visibleRows.map(row => <article key={row.id} className="rounded-xl border border-edge p-4" aria-label={`Request ${row.id}`}>

        <p className="whitespace-pre-wrap text-sm">{row.text}</p>
        {(row.stale || connection) && <p className="text-xs text-warn">Cached state — current execution status is not confirmed.</p>}
        {row.cacheLimited && <p className="text-xs text-warn">Offline preview shortened; original request context is retained on the server.</p>}
        {row.responseLimited && <p className="text-xs text-warn">Local response display reached its limit. Inspect the original Hermes session for additional output; execution context was not shortened.</p>}
        {row.linkageLimited && <p className="text-xs text-warn">Showing a bounded subset of linked outputs. More may be available in Artifacts.</p>}
        {row.linkageUnavailable && <p className="text-xs text-warn">Artifact linkage is currently unavailable.</p>}
        {!!row.attachmentNames?.length && <p className="text-xs text-ink-dim">Attached: {row.attachmentNames.join(', ')}</p>}
        <div role="status" className="my-2 text-xs text-ink-dim">{row.progress}{!done(row) && ` · ${Math.max(0, Math.floor((now - Date.parse(row.createdAt)) / 1000))}s elapsed`}</div>

        {row.response && <><p className="mt-3 whitespace-pre-wrap text-sm">{row.response}</p><CitationChips text={row.response} onOpen={setOpenChunk}/>{voice.playbackSupported && <button type="button" aria-label="Read response aloud" className="mt-2 text-xs text-signal" onClick={() => voice.speaking ? voice.stopSpeaking() : voice.speak(row.response)}>{voice.speaking ? 'Stop reading' : 'Read aloud'}</button>}</>}
        {row.error && <p className="mt-2 text-xs text-warn">{row.error}</p>}
        {!!row.taskIds?.length && <p className="mt-2 text-xs">Linked tasks: {row.taskIds.join(', ')}</p>}
        {!!row.artifacts?.length && <ul className="mt-2 space-y-1">{row.artifacts.map(a => <li key={a.id}><a href={a.url} target="_blank" rel="noreferrer" className="text-sm text-signal underline">{a.name}</a></li>)}</ul>}
        {!done(row) && <button type="button" disabled={row.cancelRequested} className="mt-2 text-xs text-risk disabled:opacity-50" onClick={() => {
          void hermes.cancelAssistantRequest!(row.id).then(updated => setRows(current => current.map(r => r.id === row.id ? updated : r))).catch(() => setError('Cancellation not confirmed. Work may still be running.'));
        }}>{row.cancelRequested ? 'Waiting for cancellation' : 'Cancel this request'}</button>}
      </article>)}
    </div>
    {awayFromBottom && <button type="button" onClick={scrollToLatest} className="self-center rounded-full border border-edge px-4 py-2 text-xs text-signal">Jump to latest</button>}
    <form onSubmit={e => { e.preventDefault(); void send(); }} className="space-y-2">
      <textarea ref={promptRef} aria-label={`New prompt for ${AGENT_NAME}`} value={draft} onChange={e => setDraft(e.target.value)} onKeyDown={e => { if (e.key === 'Escape') { voice.cancelListening(); return; } if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(); } }} placeholder={conversation ? "Ask a follow-up…" : "Ask a question…"} className="w-full rounded-lg border border-edge bg-canvas p-3 text-sm" rows={3} />
      <div className="flex flex-wrap items-center gap-3">
        <input ref={inputRef} aria-label="Attach handoff or files" type="file" multiple className="hidden" disabled={loadingFiles || submitting} onChange={e => { void upload(e.target.files); e.target.value = ''; }} />
        <button type="button" aria-label="Attach files" title="Attach handoff.md or other files (up to 10 files, 2 MB each)" disabled={loadingFiles || submitting} onClick={() => inputRef.current?.click()} className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-edge bg-canvas px-3 py-2 text-sm text-ink hover:border-signal/50 hover:bg-canvas-overlay focus-visible:outline-2 focus-visible:outline-signal disabled:opacity-50">
          <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5"><path d="m21 11-8.5 8.5a6 6 0 0 1-8.5-8.5l9-9a4 4 0 0 1 5.7 5.7l-9 9a2 2 0 0 1-2.8-2.8L15 6" /></svg>
          {loadingFiles ? 'Reading files…' : 'Attach files'}
        </button>
        <button type="button" aria-label={`Speak to ${AGENT_NAME}`} disabled={!voice.supported || submitting} onClick={() => voice.listening ? voice.stopListening() : voice.startListening()} className="text-xs text-signal disabled:opacity-50">{voice.listening ? 'Stop listening' : 'Speak'}</button>
        {voice.listening && <button type="button" className="text-xs" onClick={() => voice.cancelListening()}>Cancel dictation</button>}
        <button type="submit" disabled={submitting || loadingFiles || historyLoading || !!historyError || conversationBusy || (!draft.trim() && !attachments.length)} className="rounded-lg bg-signal px-4 py-2 text-sm text-canvas disabled:opacity-50">{submitting ? 'Saving request…' : 'Send'}</button>
      </div>
      {attachments.map((a, i) => <button type="button" className="mr-2 text-xs" key={i} onClick={() => setAttachments(current => current.filter((_, n) => n !== i))}>{a.name} ×</button>)}
      {voice.error && <p className="text-xs text-risk">{voice.error}</p>}
      {error && <p role="alert" className="text-sm text-risk">{error}</p>}
    </form>
    {openChunk && <ChunkDrawer chunkId={openChunk} onClose={() => setOpenChunk(null)}/>}
  </section>;
}
