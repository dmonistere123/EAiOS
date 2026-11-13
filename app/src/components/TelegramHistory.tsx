import { useEffect, useRef, useState } from 'react';
import { hermes } from '../adapters';
import type { AssistantConversation } from '../domain/assistantRequest';
import type { ChatMessage } from '../domain/types';
import { AGENT_NAME } from '../config';

/** Reading a Telegram thread must never activate its runtime or deliver a reply. */
export function TelegramHistory({ conversation, onClose }: { conversation: AssistantConversation; onClose: () => void }) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const viewport = useRef<HTMLDivElement>(null);
  const following = useRef(true);
  useEffect(() => {
    let stale = false;
    setMessages([]); setError(''); setLoading(true); following.current = true;
    const refresh = async () => {
      try {
        const rows = await hermes.getSessionTranscript(conversation.profile, conversation.id);
        if (!stale) { setMessages(rows); setError(''); }
      } catch { if (!stale) setError('Telegram history could not refresh. Retrying automatically.'); }
      finally { if (!stale) setLoading(false); }
    };
    void refresh();
    const timer = setInterval(() => void refresh(), 10000);
    return () => { stale = true; clearInterval(timer); };
  }, [conversation.id, conversation.profile]);
  useEffect(() => {
    if (following.current && viewport.current) viewport.current.scrollTop = viewport.current.scrollHeight;
  }, [messages]);
  return <section className="flex min-h-0 flex-1 flex-col gap-3" aria-label="Telegram conversation history">
    <header className="flex items-center justify-between gap-3">
      <div><span className="text-xs font-semibold text-signal">Telegram · Read-only</span><h2 className="text-lg font-semibold">{conversation.title}</h2></div>
      <button className="text-xs text-signal" onClick={onClose}>Back to 2EP chat</button>
    </header>
    <p className="text-xs text-ink-dim">Telegram messages for this day, in chronological order. Refreshes automatically; reading it sends no messages. Reply in Telegram for now.</p>
    {error && <p role="status" className="text-xs text-warn">{error}</p>}
    <div ref={viewport} className="min-h-0 flex-1 space-y-3 overflow-y-auto" onScroll={() => {
      const el = viewport.current; if (el) following.current = el.scrollHeight-el.scrollTop-el.clientHeight < 60;
    }}>
      {loading ? <p>Loading history…</p> : !messages.length && !error ? <p>No saved messages.</p> : messages.map(m =>
        <article key={m.id} className="rounded-lg bg-canvas p-3"><div className="text-xs text-ink-faint">{m.role === 'you' ? 'You' : AGENT_NAME} · {new Date(m.at).toLocaleString()}</div><p className="mt-1 whitespace-pre-wrap text-sm">{m.text}</p></article>)}
    </div>
  </section>;
}
