/**
 * Assistant chat tests — Phase 6.4a (spec §8.2). Mock contract (seeded
 * greeting, streamed canned reply); live unit with stubbed RPC: session
 * create/resume lifecycle, stale-sid recreate-and-retry-once, strict
 * session filter (other sessions' events NEVER render); page renders the
 * thread from the adapter and the orchestration panel from REAL work items.
 */
import { describe, expect, it, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import Assistant, { parseCitations } from '../pages/Assistant';
import { startRuntime } from '../state/runtime';
import { hermes, live } from '../adapters';
import type { AssistantEvent } from '../domain/types';

beforeAll(() => {
  startRuntime();
});

// ---------- live unit: stubbed RPC ----------

type NotifyFn = (method: string, params: Record<string, unknown>) => void;
const holder = live as unknown as {
  rpc: { call: (m: string, p?: Record<string, unknown>) => Promise<unknown>; onNotify: (fn: NotifyFn) => void };
  assistantLanes?: Map<string, { sid?: string }>;
  assistantSidToAgent?: Map<string, string>;
  assistantWired: boolean;
};
const realRpc = holder.rpc;

function stubRpc(handler: (method: string, params: Record<string, unknown>) => Promise<unknown>) {
  const calls: { method: string; params: Record<string, unknown> }[] = [];
  const notify: NotifyFn[] = [];
  holder.rpc = {
    call: (method: string, params: Record<string, unknown> = {}) => {
      calls.push({ method, params });
      return handler(method, params);
    },
    onNotify: (fn: NotifyFn) => notify.push(fn),
  };
  return { calls, emit: (method: string, params: Record<string, unknown>) => notify.forEach((f) => f(method, params)) };
}

beforeEach(() => {
  localStorage.clear();
  holder.assistantLanes?.clear();
  holder.assistantSidToAgent?.clear();
  holder.assistantWired = false;
  (live as unknown as { __clearBridgeMessages?: () => void }).__clearBridgeMessages?.();
  // Clear sticky RPC notify handlers from any prior test that wiredAssistant.
  (holder.rpc as unknown as { notifyHandlers?: Set<unknown> }).notifyHandlers?.clear();
});

afterEach(() => {
  holder.rpc = realRpc;
});

describe('live assistant session lifecycle', () => {
  it('creates a session when no stored id, persists the stored id, maps history', async () => {
    const { calls } = stubRpc(async (m) => {
      if (m === 'session.create') return { session_id: 'rt-1', stored_session_id: 'stored-1' };
      if (m === 'session.history') {
        return {
          messages: [
            { role: 'user', text: 'hi', timestamp: 1787824279, row_id: 1 },
            { role: 'assistant', text: 'hello', timestamp: 1787824280, row_id: 2 },
            { role: 'tool', text: 'noise', timestamp: 1787824281, row_id: 3 },
          ],
        };
      }
      throw new Error(`unexpected ${m}`);
    });
    // concierge lane still uses WS RPC for history (unlike default lane which is bridge-only)
    const history = await live.getAssistantHistory('concierge');
    expect(calls[0].method).toBe('session.create');
    expect(calls[0].params.title).toBe('EAiOS — Concierge');
    expect(localStorage.getItem('eaios.assistant.storedSessionId.concierge')).toBe('stored-1');
    expect(history.map((m) => m.role)).toEqual(['you', 'ally']); // tool rows dropped
    expect(history[1].text).toBe('hello');
  });

  it('resumes by stored id when present', async () => {
    localStorage.setItem('eaios.assistant.storedSessionId.concierge', 'stored-9');
    const { calls } = stubRpc(async (m) => {
      if (m === 'session.resume') return { session_id: 'rt-9' };
      if (m === 'session.history') return { messages: [] };
      throw new Error(`unexpected ${m}`);
    });
    await live.getAssistantHistory('concierge');
    expect(calls[0]).toEqual({ method: 'session.resume', params: { session_id: 'stored-9' } });
    expect(calls.some((c) => c.method === 'session.create')).toBe(false);
  });

  it('stale runtime sid on submit → recreate + retry ONCE, message not lost', async () => {
    let submits = 0;
    const { calls } = stubRpc(async (m) => {
      if (m === 'session.create') return { session_id: 'rt-old', stored_session_id: 'stored-1' };
      if (m === 'session.resume') return { session_id: 'rt-new' };
      if (m === 'prompt.submit') {
        submits++;
        if (submits === 1) throw new Error('session not found (4001)');
        return { status: 'streaming' };
      }
      throw new Error(`unexpected ${m}`);
    });
    const res = await live.sendAssistantMessage('are you there?');
    expect(res.ok).toBe(true);
    expect(submits).toBe(2);
    const resume = calls.find((c) => c.method === 'session.resume');
    expect(resume?.params.session_id).toBe('stored-1'); // continuity via stored id
  });

  it('non-stale submit errors surface honestly, no retry', async () => {
    stubRpc(async (m) => {
      if (m === 'session.create') return { session_id: 'rt-1' };
      if (m === 'prompt.submit') throw new Error('provider overloaded');
      throw new Error(`unexpected ${m}`);
    });
    const res = await live.sendAssistantMessage('hello');
    expect(res.ok).toBe(false);
    expect(res.error?.safeMessage).toContain('provider overloaded');
  });

  it('routes agent chat to the selected Hermes profile', async () => {
    const { calls } = stubRpc(async (m) => {
      if (m === 'session.create') return { session_id: 'rt-quill', stored_session_id: 'stored-quill' };
      if (m === 'prompt.submit') return { status: 'streaming' };
      throw new Error(`unexpected ${m}`);
    });
    const res = await live.sendAssistantMessage('hello quill', { agentId: 'quill' });
    expect(res.ok).toBe(true);
    expect(calls[0]).toEqual({ method: 'session.create', params: { title: 'EAiOS — quill', profile: 'quill' } });
    expect(localStorage.getItem('eaios.assistant.storedSessionId.quill')).toBe('stored-quill');
    expect(calls[1]).toEqual({ method: 'prompt.submit', params: { session_id: 'rt-quill', text: 'hello quill' } });
  });

  it('default lane: REST bridge stores exchange, persists to localStorage, and clears on new chat', async () => {
    const fetchCalls: { url: string; body: unknown }[] = [];
    vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
      fetchCalls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      return {
        ok: true,
        status: 200,
        json: async () => ({ text: `Bridge reply to ${(init?.body ? JSON.parse(String(init.body)) : {}).text}`, finishReason: 'complete' }),
      } as Response;
    });
    // startNewAssistantChat still opens a fresh WS session for the lane, even
    // though the default send path uses the REST bridge.
    stubRpc(async (m) => {
      if (m === 'session.create') return { session_id: 'rt-new', stored_session_id: 'stored-new' };
      if (m === 'session.history') return { messages: [] };
      throw new Error(`unexpected ${m}`);
    });

    const events: AssistantEvent[] = [];
    // Skip wiring the real RPC onNotify — the bridge emits directly via
    // lane handlers; we don't want a stale handler on the gateway socket.
    holder.assistantWired = true;
    const unsub = live.subscribeAssistant((e) => events.push(e));

    const res = await live.sendAssistantMessage('hello bridge');
    expect(res.ok).toBe(true);
    expect(events.map((e) => e.kind)).toEqual(['start', 'delta', 'complete']);

    // History must include both the user message and the bridge reply so the UI
    // does not replace the exchange with an empty WS session.
    const history = await live.getAssistantHistory();
    expect(history.map((m) => ({ role: m.role, text: m.text }))).toEqual([
      { role: 'you', text: 'hello bridge' },
      { role: 'ally', text: 'Bridge reply to hello bridge' },
    ]);

    // Persistence: a fresh adapter instance would reload the same messages.
    expect(localStorage.getItem('eaios.assistant.bridgeMessages')).toContain('hello bridge');

    // New chat must wipe the bridge history.
    const newChat = await live.startNewAssistantChat();
    expect(newChat.ok).toBe(true);
    expect((await live.getAssistantHistory()).length).toBe(0);
    expect(localStorage.getItem('eaios.assistant.bridgeMessages')).toBeNull();

    unsub();
    vi.unstubAllGlobals();
  });
});

describe('live assistant event filter (every session shares the socket)', () => {
  it('only our session events reach subscribers; turn.error tolerated via sid key', async () => {
    const { emit } = stubRpc(async (m) => {
      if (m === 'session.create') return { session_id: 'rt-mine', stored_session_id: 's-1' };
      if (m === 'session.history') return { messages: [] };
      throw new Error(`unexpected ${m}`);
    });
    // Non-default lanes (concierge) still use WS RPC for history, so
    // getAssistantHistory sets up the SID→agent binding for event routing.
    await live.getAssistantHistory('concierge'); // assistantSid = rt-mine, agentId = concierge
    const seen: AssistantEvent[] = [];
    live.subscribeAssistant((e) => seen.push(e), 'concierge'); // subscribe to concierge lane
    emit('event', { type: 'message.delta', session_id: 'rt-other', payload: { text: 'LEAK' } });
    emit('event', { type: 'message.delta', session_id: 'rt-mine', payload: { text: 'he' } });
    emit('event', { type: 'message.delta', session_id: 'rt-mine', payload: { text: 'llo' } });
    emit('event', { type: 'message.complete', session_id: 'rt-mine', payload: { text: 'hello' } });
    emit('event', { type: 'turn.error', sid: 'rt-mine', message: 'boom' });
    expect(seen).toEqual([
      { kind: 'delta', text: 'he' },
      { kind: 'delta', text: 'llo' },
      { kind: 'complete', text: 'hello' },
      { kind: 'error', message: 'boom' },
    ]);
    expect(JSON.stringify(seen)).not.toContain('LEAK');
  });
});

// ---------- mock contract ----------

describe('mock assistant contract', () => {
  it('seeds a greeting and streams a canned reply on send', async () => {
    const before = await hermes.getAssistantHistory();
    expect(before.length).toBeGreaterThan(0);
    expect(before[0].role).toBe('ally');

    const events: AssistantEvent[] = [];
    const unsub = hermes.subscribeAssistant((e) => events.push(e));
    const res = await hermes.sendAssistantMessage('draft the update');
    expect(res.ok).toBe(true);

    await vi.waitFor(() => expect(events.some((e) => e.kind === 'complete')).toBe(true), { timeout: 5000 });
    expect(events[0].kind).toBe('start');
    const after = await hermes.getAssistantHistory();
    expect(after.at(-1)?.role).toBe('ally');
    expect(after.at(-1)?.text).toContain('draft the update');
    unsub();
  });

  it('send with attachments appends an attachment note to the user message', async () => {
    const events: AssistantEvent[] = [];
    const unsub = hermes.subscribeAssistant((e) => events.push(e));
    const res = await hermes.sendAssistantMessage('summarize this', {
      attachments: [{ name: 'note.txt', mimeType: 'text/plain', content: 'hello world', encoding: 'text' }],
    });
    expect(res.ok).toBe(true);
    await vi.waitFor(() => expect(events.some((e) => e.kind === 'complete')).toBe(true), { timeout: 5000 });
    const after = await hermes.getAssistantHistory();
    const lastUser = after.filter((m) => m.role === 'you').pop();
    expect(lastUser?.text).toContain('Attached: note.txt (text)');
    unsub();
  });
});

// ---------- 6.4b citations ----------

describe('citations (6.4b, F8)', () => {
  it('parseCitations extracts unique chunk ids in order', () => {
    expect(parseCitations('see eaios://chunk/k-01-0 and eaios://chunk/k-02-3, plus eaios://chunk/k-01-0 again')).toEqual(['k-01-0', 'k-02-3']);
    expect(parseCitations('no citations here')).toEqual([]);
  });

  it('citation chip on an Ally reply opens the chunk drill-down drawer', async () => {
    const user = userEvent.setup();
    // Seed a COMPLETED, cited reply at the adapter level first — no page
    // involved, so no streaming race. (The UI send/stream path itself is
    // covered by the page test below; this test is about the chip + drawer.)
    const events: AssistantEvent[] = [];
    const unsub = hermes.subscribeAssistant((e) => events.push(e));
    await hermes.sendAssistantMessage('cite the board deck');
    await vi.waitFor(() => expect(events.some((e) => e.kind === 'complete')).toBe(true), { timeout: 5000 });
    unsub();

    render(
      <MemoryRouter>
        <Assistant />
      </MemoryRouter>,
    );
    const chips = await screen.findAllByRole('button', { name: /⧉ source 1/ }, { timeout: 4000 });
    await user.click(chips[chips.length - 1]); // the just-seeded reply's chip
    // drawer resolves the mock chunk (source k-01 = Q3 board deck)
    const dialog = await screen.findByRole('dialog', undefined, { timeout: 4000 });
    expect(await within(dialog).findByText('Q3 board deck (working).pptx')).toBeInTheDocument();
    expect(within(dialog).getByText(/eaios:\/\/chunk\/k-01-0/)).toBeInTheDocument(); // "Cite as" line
    await user.keyboard('{Escape}');
  }, 15000); // stream takes ~1.4s; suite-load can stretch the full flow past 5s
});

// ---------- page ----------

describe('Assistant page (mock mode)', () => {
  it('sends a message, streams the reply, and shows real work in the plan panel', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <Assistant />
      </MemoryRouter>,
    );
    // seeded greeting from the mock adapter
    expect(await screen.findByText(/chief of staff/, undefined, { timeout: 4000 })).toBeInTheDocument();
    // orchestration panel reads the REAL work slice, not a hardcoded plan
    expect(await screen.findByText('Prepare investor update email')).toBeInTheDocument();
    // knowledge counts are honest (fixture: 2 ready, 1 processing, 1 failed)
    expect(screen.getByText(/2 sources ready, 1 indexing/)).toBeInTheDocument();

    await user.type(screen.getByLabelText('Message Ally'), 'status on the investor update');
    await user.click(screen.getByRole('button', { name: 'Send' }));
    // optimistic user bubble
    expect(await screen.findByText('status on the investor update')).toBeInTheDocument();
    // streamed reply completes and history re-pulls
    expect(await screen.findByText(/On it — "status on the investor update"/, undefined, { timeout: 6000 })).toBeInTheDocument();
  });

  it('selector switches context only — the chat target stays Ally (D-B1)', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <Assistant />
      </MemoryRouter>,
    );
    const picker = await screen.findByLabelText('Channel context');
    await screen.findByRole('option', { name: 'Scout' });
    await user.selectOptions(picker, 'scout');
    // the chat target never changes…
    expect(screen.getByLabelText('Message Ally')).toBeInTheDocument();
    // …the context does: scout's delegated work + honest no-chat-yet state
    expect(await screen.findByText('Market scan: AI ops tooling')).toBeInTheDocument();
    expect(await screen.findByText(/No Ally↔Scout chat yet/)).toBeInTheDocument();
  });
});

// ---------- voice I/O (browser Web Speech API) ----------

describe('Assistant voice I/O', () => {
  class MockSpeechRecognition extends EventTarget {
    continuous = false;
    interimResults = false;
    lang = '';
    start = vi.fn();
    stop = vi.fn();
    abort = vi.fn();
  }

  let recognitionInstance: MockSpeechRecognition | null = null;

  function installVoiceStubs(supported: boolean) {
    recognitionInstance = null;
    if (supported) {
      Object.defineProperty(globalThis, 'SpeechRecognition', {
        value: vi.fn(function () {
          recognitionInstance = new MockSpeechRecognition();
          return recognitionInstance;
        }),
        configurable: true,
        writable: true,
      });
      Object.defineProperty(globalThis, 'webkitSpeechRecognition', {
        value: vi.fn(function () {
          recognitionInstance = new MockSpeechRecognition();
          return recognitionInstance;
        }),
        configurable: true,
        writable: true,
      });
      Object.defineProperty(globalThis, 'speechSynthesis', {
        value: {
          speak: vi.fn(),
          cancel: vi.fn(),
          getVoices: vi.fn(() => []),
          paused: false,
          pending: false,
          speaking: false,
          onvoiceschanged: null,
          addEventListener: vi.fn(),
          removeEventListener: vi.fn(),
        },
        configurable: true,
        writable: true,
      });
      Object.defineProperty(globalThis, 'SpeechSynthesisUtterance', {
        value: vi.fn(function (this: unknown, text: string) {
          (this as { text: string }).text = text;
        }),
        configurable: true,
        writable: true,
      });
    } else {
      Object.defineProperty(globalThis, 'SpeechRecognition', {
        value: undefined,
        configurable: true,
        writable: true,
      });
      Object.defineProperty(globalThis, 'webkitSpeechRecognition', {
        value: undefined,
        configurable: true,
        writable: true,
      });
      Object.defineProperty(globalThis, 'speechSynthesis', {
        value: undefined,
        configurable: true,
        writable: true,
      });
      Object.defineProperty(globalThis, 'SpeechSynthesisUtterance', {
        value: undefined,
        configurable: true,
        writable: true,
      });
    }
  }

  beforeEach(() => {
    installVoiceStubs(true);
  });

  afterEach(() => {
    installVoiceStubs(false);
  });

  it('mic button is available when voice is supported', async () => {
    render(
      <MemoryRouter>
        <Assistant />
      </MemoryRouter>,
    );
    expect(await screen.findByRole('button', { name: 'Speak to Ally' })).toBeInTheDocument();
  });

  it('read-aloud button on Ally messages calls speech synthesis', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <Assistant />
      </MemoryRouter>,
    );
    await screen.findByText(/chief of staff/);
    const speakButtons = await screen.findAllByRole('button', { name: 'Read aloud' });
    expect(speakButtons.length).toBeGreaterThan(0);
    await user.click(speakButtons[0]);
    expect(speechSynthesis.speak).toHaveBeenCalled();
  });

  it('voice unsupported hides the mic button', async () => {
    installVoiceStubs(false);
    render(
      <MemoryRouter>
        <Assistant />
      </MemoryRouter>,
    );
    await screen.findByText(/chief of staff/);
    expect(screen.queryByRole('button', { name: 'Speak to Ally' })).not.toBeInTheDocument();
  });
});
