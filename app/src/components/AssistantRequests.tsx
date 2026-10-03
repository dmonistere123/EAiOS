import { CitationChips } from './CitationChips';
import { ChunkDrawer } from './ChunkDrawer';
import { AGENT_NAME } from '../config';
import { useVoice } from '../hooks/useVoice';
import { useEffect, useRef, useState } from 'react';
import { hermes } from '../adapters';
import type { RequestView } from '../domain/assistantRequest';
import type { AssistantAttachment } from '../adapters/interfaces';
const done = (r: RequestView) => ['completed', 'recovered', 'cancelled', 'interrupted'].includes(r.state);
export function AssistantRequests() {
  const [openChunk, setOpenChunk] = useState<string | null>(null);
  const [rows, setRows] = useState<RequestView[]>(() => hermes.cachedAssistantRequests?.() ?? []);
  const [draft, setDraft] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const promptRef = useRef<HTMLTextAreaElement>(null);
  const [earlierIds, setEarlierIds] = useState<Set<string>>(() => new Set());
  const [showHistory, setShowHistory] = useState(false);
  const [sessionNotice, setSessionNotice] = useState('');
  const [attachments, setAttachments] = useState<AssistantAttachment[]>([]);
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
    if (submitting || loadingFiles || (!text.trim() && !attachments.length)) return;
    voice.cancelListening(false);
    setSubmitting(true); setError('');
    try {
      const row = await hermes.createAssistantRequest!(text.trim(), attachments);
      setRows(current => [...current.filter(r => r.id !== row.id), row]); setDraft(''); setAttachments([]);
    } catch { setError('Could not save a recovery receipt. Your prompt has not been sent.'); }
    finally { setSubmitting(false); }
  }
  const upload = async (files: FileList | null) => {
    if (!files) return;
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
      setAttachments(current => [...current, ...added]);
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not read attachment'); }
    finally { setLoadingFiles(false); }
  };
  const historyCount = rows.filter(row => earlierIds.has(row.id) && done(row)).length;
  const visibleRows = rows.filter(row => showHistory || !earlierIds.has(row.id) || !done(row));
  function newSession() {
    if (submitting || loadingFiles) return;
    voice.cancelListening(false);
    voice.stopSpeaking();
    setDraft(''); setAttachments([]); setError(''); setOpenChunk(null);
    setEarlierIds(new Set(rows.map(row => row.id))); setShowHistory(false);
    setSessionNotice('New session ready. Earlier requests are saved in History; running work stays visible. Reloading restores the full list.');
    promptRef.current?.focus();
  }
  return <section aria-label="Assistant requests" className="flex min-h-0 flex-1 flex-col gap-4">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h2 className="text-sm font-semibold">Conversation with {AGENT_NAME}</h2>
      <div className="flex flex-wrap gap-2">
        {historyCount > 0 && <button type="button" aria-expanded={showHistory} onClick={() => setShowHistory(value => !value)} className="rounded-lg border border-edge px-3 py-2 text-sm text-ink hover:bg-canvas-overlay focus-visible:outline-2 focus-visible:outline-signal">{showHistory ? 'Hide history' : `History (${historyCount})`}</button>}
        <button type="button" onClick={newSession} disabled={submitting || loadingFiles} title="Clear the draft and attachments and start a clean view. Saved requests and running work are preserved." className="rounded-lg border border-signal/50 bg-signal/10 px-3 py-2 text-sm font-semibold text-ink hover:bg-signal/20 focus-visible:outline-2 focus-visible:outline-signal disabled:opacity-50">New Session</button>
      </div>
    </div>
    {sessionNotice && <p role="status" className="text-xs text-ink-dim">{sessionNotice}</p>}
    <p className="text-xs text-ink-dim">Each prompt starts a fresh session. Upload handoff.md to carry context into a new request. Reconnecting preserves the original request.</p>
    {connection && <p role="status" className="text-sm text-warn">{connection}</p>}
    <div className="min-h-0 flex-1 space-y-4 overflow-y-auto">
      {visibleRows.length === 0 && <p className="text-sm text-ink-dim">Your requests and their progress will appear here.</p>}
      {visibleRows.map(row => <article key={row.id} className="rounded-xl border border-edge p-4" aria-label={`Request ${row.id}`}>
        {earlierIds.has(row.id) && <p className="mb-2 text-xs text-ink-dim">Earlier session{!done(row) ? " · work continues" : ""}</p>}
        <p className="whitespace-pre-wrap text-sm">{row.text}</p>
        {(row.stale || connection) && <p className="text-xs text-warn">Cached state — current execution status is not confirmed.</p>}
        {row.cacheLimited && <p className="text-xs text-warn">Offline preview shortened; original request context is retained on the server.</p>}
        {row.responseLimited && <p className="text-xs text-warn">Local response display reached its limit. Inspect the original Hermes session for additional output; execution context was not shortened.</p>}
        {row.linkageLimited && <p className="text-xs text-warn">Showing a bounded subset of linked outputs. More may be available in Artifacts.</p>}
        {row.linkageUnavailable && <p className="text-xs text-warn">Artifact linkage is currently unavailable.</p>}
        {!!row.attachmentNames?.length && <p className="text-xs text-ink-dim">Attached: {row.attachmentNames.join(', ')}</p>}
        <div role="status" className="my-2 text-xs text-ink-dim">{row.state} · {row.progress}{!done(row) && ` · ${Math.max(0, Math.floor((now - Date.parse(row.createdAt)) / 1000))}s elapsed`}</div>
        <p className="text-[10px] text-ink-faint">{!done(row) && row.lastActivityAt && `Last activity ${Math.max(0, Math.floor((now - Date.parse(row.lastActivityAt)) / 1000))}s ago · `}Request {row.id}{row.storedSessionId && ` · Session ${row.storedSessionId}`}</p>
        {row.response && <><p className="mt-3 whitespace-pre-wrap text-sm">{row.response}</p><CitationChips text={row.response} onOpen={setOpenChunk}/>{voice.playbackSupported && <button type="button" aria-label="Read response aloud" className="mt-2 text-xs text-signal" onClick={() => voice.speaking ? voice.stopSpeaking() : voice.speak(row.response)}>{voice.speaking ? 'Stop reading' : 'Read aloud'}</button>}</>}
        {row.error && <p className="mt-2 text-xs text-warn">{row.error}</p>}
        {!!row.taskIds?.length && <p className="mt-2 text-xs">Linked tasks: {row.taskIds.join(', ')}</p>}
        {!!row.artifacts?.length && <ul className="mt-2 space-y-1">{row.artifacts.map(a => <li key={a.id}><a href={a.url} target="_blank" rel="noreferrer" className="text-sm text-signal underline">{a.name}</a></li>)}</ul>}
        {!done(row) && <button type="button" disabled={row.cancelRequested} className="mt-2 text-xs text-risk disabled:opacity-50" onClick={() => {
          void hermes.cancelAssistantRequest!(row.id).then(updated => setRows(current => current.map(r => r.id === row.id ? updated : r))).catch(() => setError('Cancellation not confirmed. Work may still be running.'));
        }}>{row.cancelRequested ? 'Waiting for cancellation' : 'Cancel this request'}</button>}
      </article>)}
    </div>
    <form onSubmit={e => { e.preventDefault(); void send(); }} className="space-y-2">
      <textarea ref={promptRef} aria-label={`New prompt for ${AGENT_NAME}`} value={draft} onChange={e => setDraft(e.target.value)} onKeyDown={e => { if (e.key === 'Escape') { voice.cancelListening(); return; } if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(); } }} placeholder="Start a fresh request…" className="w-full rounded-lg border border-edge bg-canvas p-3 text-sm" rows={3} />
      <div className="flex flex-wrap items-center gap-3">
        <input ref={inputRef} aria-label="Attach handoff or files" type="file" multiple className="hidden" disabled={loadingFiles || submitting} onChange={e => { void upload(e.target.files); e.target.value = ''; }} />
        <button type="button" aria-label="Attach files" title="Attach handoff.md or other files (up to 10 files, 2 MB each)" disabled={loadingFiles || submitting} onClick={() => inputRef.current?.click()} className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-edge bg-canvas px-3 py-2 text-sm text-ink hover:border-signal/50 hover:bg-canvas-overlay focus-visible:outline-2 focus-visible:outline-signal disabled:opacity-50">
          <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5"><path d="m21 11-8.5 8.5a6 6 0 0 1-8.5-8.5l9-9a4 4 0 0 1 5.7 5.7l-9 9a2 2 0 0 1-2.8-2.8L15 6" /></svg>
          {loadingFiles ? 'Reading files…' : 'Attach files'}
        </button>
        <button type="button" aria-label={`Speak to ${AGENT_NAME}`} disabled={!voice.supported || submitting} onClick={() => voice.listening ? voice.stopListening() : voice.startListening()} className="text-xs text-signal disabled:opacity-50">{voice.listening ? 'Stop listening' : 'Speak'}</button>
        {voice.listening && <button type="button" className="text-xs" onClick={() => voice.cancelListening()}>Cancel dictation</button>}
        <button type="submit" disabled={submitting || loadingFiles || (!draft.trim() && !attachments.length)} className="rounded-lg bg-signal px-4 py-2 text-sm text-canvas disabled:opacity-50">{submitting ? 'Saving request…' : 'Send new prompt'}</button>
      </div>
      {attachments.map((a, i) => <button type="button" className="mr-2 text-xs" key={i} onClick={() => setAttachments(current => current.filter((_, n) => n !== i))}>{a.name} ×</button>)}
      {voice.error && <p className="text-xs text-risk">{voice.error}</p>}
      {error && <p role="alert" className="text-sm text-risk">{error}</p>}
    </form>
    {openChunk && <ChunkDrawer chunkId={openChunk} onClose={() => setOpenChunk(null)}/>}
  </section>;
}
