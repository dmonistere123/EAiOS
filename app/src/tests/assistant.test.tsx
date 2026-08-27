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
  assistantSid?: string;
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
  holder.assistantSid = undefined;
  holder.assistantWired = false;
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
    const history = await live.getAssistantHistory();
    expect(calls[0].method).toBe('session.create');
    expect(calls[0].params.title).toBe('EAiOS — My Assistant');
    expect(localStorage.getItem('eaios.assistant.storedSessionId')).toBe('stored-1');
    expect(history.map((m) => m.role)).toEqual(['you', 'ally']); // tool rows dropped
    expect(history[1].text).toBe('hello');
  });

  it('resumes by stored id when present', async () => {
    localStorage.setItem('eaios.assistant.storedSessionId', 'stored-9');
    const { calls } = stubRpc(async (m) => {
      if (m === 'session.resume') return { session_id: 'rt-9' };
      if (m === 'session.history') return { messages: [] };
      throw new Error(`unexpected ${m}`);
    });
    await live.getAssistantHistory();
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
});

describe('live assistant event filter (every session shares the socket)', () => {
  it('only our session events reach subscribers; turn.error tolerated via sid key', async () => {
    const { emit } = stubRpc(async (m) => {
      if (m === 'session.create') return { session_id: 'rt-mine', stored_session_id: 's-1' };
      if (m === 'session.history') return { messages: [] };
      throw new Error(`unexpected ${m}`);
    });
    await live.getAssistantHistory(); // assistantSid = rt-mine
    const seen: AssistantEvent[] = [];
    live.subscribeAssistant((e) => seen.push(e)); // first subscribe wires onNotify to this stub
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
});
