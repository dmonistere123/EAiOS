/**
 * ConciergeWidget (F26, Don 2026-08-30) — floating navigation helper for new
 * users. BrainGlyph FAB bottom-right → overlay panel docked right; minimizable
 * to a pill. Chat = Ally's 'concierge' LANE: a second session on the DEFAULT
 * profile (D-B1 untouched — still Ally), persistent per browser via the 6.4
 * lane machinery, hydrated lazily on first open (no session litter for users
 * who never open it). The first message of a fresh concierge session carries
 * a compact navigation brief + current page inside [concierge-context v1]
 * markers; later messages carry just the page line; markers are stripped for
 * display. Stacking: drawers (z-40) and toasts (z-50) outrank it (z-30).
 */
import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import type { ChatMessage } from '../domain/types';
import { hermes } from '../adapters';
import { toast } from '../state/runtime';
import { BrainGlyph } from './BrainGlyph';

const LANE = 'concierge';
const CTX_OPEN = '[concierge-context v1]';
const CTX_CLOSE = '[/concierge-context]';

/** Product knowledge the concierge needs to answer navigation questions
 * accurately — compact on purpose (rides the prompt cache once in context). */
const NAV_BRIEF = `You are the EAiOS navigation concierge — Ally's helper lane dedicated to orienting users in the EAiOS console. Answer in 2-4 sentences, name the exact page and section, and when the ask is really an ACTION (send an email, post something, delete, schedule), explain it goes through a delegated task plus an approval — not this chat. Page map:
- Today: executive summary, pending approvals, recommendations, delegated-work snapshot.
- My Assistant: full chat with Ally; right rail lists conversations and delegated runs (read-only transcripts).
- Staff: orbital org chart (Ally hub + agents); add agents, edit SOUL/model/telegram bot, per-agent channel view.
- Connections: Composio apps — connected apps and the available-to-connect catalog with connect/disconnect.
- Approvals: pending external-write approvals; approving EXECUTES the prepared action shown in the envelope.
- Schedule: top card creates cron jobs and one-off delegated tasks; day cards show calendar + cron; Work in flight lists active tasks (pause/resume/defer/done/stop/reclaim) and completed-24h (click for result + transcript).
- Knowledge: RAG sources — add files/URLs, reindex, try retrieval, citation drill-down.
- Skills & Playbooks: skill library and playbook editor; run playbooks with one click.
- Artifacts: deliverables from completed work — preview, download, governed share.
- Usage: token/cost usage and the monthly budget editor.
- Settings: agent env files (SOUL.md per agent).`;

const PAGE_NAMES: Record<string, string> = {
  '/today': 'Today',
  '/assistant': 'My Assistant',
  '/staff': 'Staff',
  '/connections': 'Connections',
  '/approvals': 'Approvals',
  '/schedule': 'Schedule',
  '/knowledge': 'Knowledge',
  '/skills': 'Skills & Playbooks',
  '/artifacts': 'Artifacts',
  '/usage': 'Usage',
  '/settings': 'Settings',
};

const EXAMPLE_PROMPTS = ['How do approvals work?', 'How do I put an agent to work?', 'Where do I find a deliverable?'];

/** Hide the concierge-context envelope the model needs but the user shouldn't read. */
export function stripConciergeContext(text: string): string {
  return text.replace(/\[concierge-context v1][\s\S]*?\[\/concierge-context]\s*/g, '').trim();
}

type Mode = 'fab' | 'open' | 'min';

export function ConciergeWidget() {
  const location = useLocation();
  const pageName = PAGE_NAMES[location.pathname] ?? 'EAiOS';
  const [mode, setMode] = useState<Mode>('fab');
  const [ready, setReady] = useState(false); // history loaded — sends stay gated until then (brief decision depends on real lane history)
  const [thread, setThread] = useState<ChatMessage[]>([]);
  const [streaming, setStreaming] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [draft, setDraft] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Subscribe + rehydrate whenever the panel is open/minimized; unsubscribe
  // when closed to the FAB. (First version gated on a `hydrated` flag in the
  // deps array — the flag's own state update cleaned up the effect and
  // killed the subscription instantly. Deps = [mode] only.)
  useEffect(() => {
    if (mode === 'fab') return;
    let stale = false;
    void hermes.getAssistantHistory(LANE).then((rows) => {
      if (stale) return;
      setThread(rows);
      setReady(true);
    });
    const unsub = hermes.subscribeAssistant((e) => {
      if (e.kind === 'start') {
        setSending(false);
        setStreaming('');
      } else if (e.kind === 'delta') {
        setStreaming((t) => (t ?? '') + e.text);
      } else if (e.kind === 'complete') {
        setStreaming(null);
        setSending(false);
        void hermes.getAssistantHistory(LANE).then((rows) => {
          if (!stale) setThread(rows); // authoritative, deduped by row_id
        });
      } else if (e.kind === 'error') {
        setStreaming(null);
        setSending(false);
        toast('error', e.message);
      }
    }, LANE);
    return () => {
      stale = true;
      unsub();
    };
  }, [mode]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [thread, streaming, sending, mode]);

  // Auto-grow the concierge input so longer navigation questions stay visible.
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 96)}px`;
  }, [draft]);

  /** Fresh concierge session — drops the old context entirely (new lane
   * session on the gateway) so the next question carries the full nav brief
   * again and the example prompts resurface. (Don 2026-08-30) */
  const newChat = async () => {
    if (sending || streaming !== null) return;
    const res = await hermes.startNewAssistantChat(LANE);
    if (!res.ok) {
      toast('error', res.error?.safeMessage ?? 'Could not start a new chat.');
      return;
    }
    setStreaming(null);
    setThread([]);
    void hermes.getAssistantHistory(LANE).then(setThread); // authoritative (empty for a fresh session)
  };

  const send = async (text: string) => {
    const q = text.trim();
    if (!q || sending) return;
    setDraft('');
    setSending(true);
    const ctx =
      thread.length === 0
        ? `${CTX_OPEN}\n${NAV_BRIEF}\nThe user is currently on the "${pageName}" page.\n${CTX_CLOSE}\n\n`
        : `${CTX_OPEN} The user is currently on the "${pageName}" page. ${CTX_CLOSE}\n\n`;
    // Optimistic bubble (display-stripped); history rehydration on complete is authoritative.
    setThread((t) => [...t, { id: `optimistic-${Date.now()}`, role: 'you', text: ctx + q, at: new Date().toISOString() }]);
    const res = await hermes.sendAssistantMessage(ctx + q, { agentId: LANE });
    setSending(false);
    textareaRef.current?.focus();
    if (!res.ok) {
      toast('error', res.error?.safeMessage ?? 'Message failed to send.');
    }
  };

  if (mode === 'fab') {
    return (
      <button
        onClick={() => setMode('open')}
        aria-label="Open the navigation concierge"
        title="New here? Ask the concierge how to get around"
        className="fixed bottom-6 right-6 z-30 flex h-14 w-14 items-center justify-center rounded-full border-2 border-signal/40 shadow-[0_0_18px_2px_rgba(50,197,255,0.35)] transition-shadow hover:border-signal hover:shadow-[0_0_22px_3px_rgba(50,197,255,0.5)]"
        style={{ background: 'radial-gradient(circle at 35% 35%, rgba(50,197,255,0.22), rgba(5,9,20,0.95))' }}
      >
        <BrainGlyph className="h-7 w-7" />
      </button>
    );
  }

  if (mode === 'min') {
    return (
      <button
        onClick={() => setMode('open')}
        aria-label="Expand the navigation concierge"
        className="fixed bottom-6 right-6 z-30 flex items-center gap-2 rounded-full border border-signal/40 bg-canvas-raised py-2 pl-3 pr-4 shadow-lg hover:border-signal"
      >
        <BrainGlyph className="h-5 w-5" />
        <span className="text-xs font-medium text-ink">Concierge</span>
        {sending || streaming !== null ? <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-signal" aria-label="Concierge is replying" /> : null}
      </button>
    );
  }

  return (
    <section
      aria-label="EAiOS navigation concierge"
      className="eaios-concierge-panel fixed bottom-6 right-6 z-30 flex h-[30rem] max-h-[calc(100vh-4rem)] w-96 max-w-[calc(100vw-3rem)] flex-col overflow-hidden rounded-xl border border-edge bg-canvas-raised shadow-2xl"
    >
      <header className="flex items-center gap-2.5 border-b border-edge px-4 py-3">
        <BrainGlyph className="h-6 w-6 shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold text-ink">Concierge</div>
          <div className="truncate text-[11px] text-ink-faint">Ally's Guide</div>
        </div>
        <button
          onClick={() => void newChat()}
          disabled={sending || streaming !== null}
          aria-label="Start a new concierge chat"
          title="New chat — clears this conversation's context"
          className="rounded border border-edge px-2 py-1 text-[11px] font-medium text-ink-dim hover:border-signal/40 hover:text-signal disabled:opacity-50"
        >
          New
        </button>
        <button onClick={() => setMode('min')} aria-label="Minimize concierge" title="Minimize" className="rounded px-2 py-1 text-xs text-ink-dim hover:bg-canvas-overlay">
          —
        </button>
        <button onClick={() => setMode('fab')} aria-label="Close concierge" title="Close" className="rounded px-2 py-1 text-xs text-ink-dim hover:bg-canvas-overlay">
          ✕
        </button>
      </header>

      <div ref={scrollRef} className="flex-1 space-y-2.5 overflow-y-auto px-4 py-3">
        <div className="rounded-lg border border-signal/20 bg-signal/5 px-3 py-2 text-xs text-ink-dim">
          New here? Ask me where anything lives or how to get something done — I know every page.
        </div>
        {ready && thread.length === 0 && (
          <div className="flex flex-wrap gap-1.5">
            {EXAMPLE_PROMPTS.map((p) => (
              <button key={p} onClick={() => void send(p)} className="rounded-full border border-edge px-2.5 py-1 text-[11px] text-ink-dim hover:border-signal/40 hover:text-signal">
                {p}
              </button>
            ))}
          </div>
        )}
        {thread.map((m) => (
          <div key={m.id} className={`rounded-lg px-3 py-2 text-xs ${m.role === 'you' ? 'ml-8 bg-signal/15 text-ink' : 'mr-8 bg-canvas text-ink-dim'}`}>
            <div className="mb-0.5 text-[10px] font-semibold uppercase tracking-wider text-ink-faint">{m.role === 'you' ? 'You' : 'Concierge'}</div>
            <div className="whitespace-pre-wrap">{m.role === 'you' ? stripConciergeContext(m.text) : m.text}</div>
          </div>
        ))}
        {sending && streaming === null && (
          <div className="mr-8 flex gap-1 rounded-lg bg-canvas px-3 py-2.5" aria-label="Concierge is thinking">
            {[0, 1, 2].map((i) => (
              <span key={i} className="h-1.5 w-1.5 animate-pulse rounded-full bg-signal/70" style={{ animationDelay: `${i * 150}ms` }} />
            ))}
          </div>
        )}
        {streaming !== null && (
          <div className="mr-8 rounded-lg bg-canvas px-3 py-2 text-xs text-ink-dim">
            <div className="mb-0.5 text-[10px] font-semibold uppercase tracking-wider text-ink-faint">Concierge</div>
            <div className="whitespace-pre-wrap">{streaming}</div>
          </div>
        )}
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void send(draft);
        }}
        className="flex items-start gap-2 border-t border-edge px-3 py-2.5"
      >
        <textarea
          ref={textareaRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void send(draft);
            }
          }}
          rows={1}
          placeholder="Ask how to get around…"
          aria-label="Ask the concierge"
          disabled={!ready}
          className="max-h-24 min-h-[2.25rem] min-w-0 flex-1 resize-none rounded-lg border border-edge bg-canvas px-3 py-2 text-xs text-ink placeholder:text-ink-faint"
        />
        <button type="submit" disabled={sending || !ready || !draft.trim()} className="rounded-lg bg-signal px-3.5 py-2 text-xs font-semibold text-canvas hover:bg-signal/90 disabled:opacity-50">
          Send
        </button>
      </form>
    </section>
  );
}
