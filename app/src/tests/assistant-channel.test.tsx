/**
 * W1+W2 tests — Assistant channel views (D-B1) + contextual rail (D-B4).
 * Mock: New chat reset, selector-keeps-Ally, channel read-only states,
 * rail conversations (D-B2 all sources), Ally resume, other-agent read-only
 * drawer, default-rail fallback on undeclared routes. Live unit (stubbed
 * RPC): session.list profile scoping, Bot Chat title lookup + resolved_id
 * history, resume stored-id discipline, new-chat session.create.
 */
import { describe, expect, it, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import Assistant from '../pages/Assistant';
import AppShell from '../app/AppShell';
import { startRuntime } from '../state/runtime';
import { hermes, live } from '../adapters';
import type { AssistantEvent } from '../domain/types';

beforeAll(() => {
  startRuntime();
});

function renderAt(route: string) {
  return render(
    <MemoryRouter initialEntries={[route]}>
      <Routes>
        <Route path="/" element={<AppShell />}>
          <Route path="assistant" element={<Assistant />} />
          <Route path="today" element={<div>Today stub</div>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

// ---------- W1: channel views (D-B1) ----------

describe('channel views (D-B1)', () => {
  it('selecting an agent shows its read-only channel; the chat stays with Ally', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <Assistant />
      </MemoryRouter>,
    );
    const picker = await screen.findByLabelText('Channel context');
    await screen.findByRole('option', { name: 'Quill' }); // agents slice hydrates async
    await user.selectOptions(picker, 'quill');
    expect(screen.getByLabelText('Message Ally')).toBeInTheDocument(); // chat target unchanged
    expect(await screen.findByText('Customer newsletter — September')).toBeInTheDocument(); // delegated work
    expect(await screen.findByText(/Draft is up \(work item w-05\)/)).toBeInTheDocument(); // Ally↔quill chat
    expect(screen.getByText('read-only')).toBeInTheDocument();
  });

  it('New chat resets the Ally conversation to a fresh greeting', async () => {
    await hermes.startNewAssistantChat(); // normalize the singleton mock thread
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <Assistant />
      </MemoryRouter>,
    );
    // greeting bubble fragment unique from the header copy ("…your chief of staff.")
    await screen.findByText(/Ask me to draft something/);
    // seed an exchange at the adapter level; the page rides its own subscription
    const events: AssistantEvent[] = [];
    const unsub = hermes.subscribeAssistant((e) => events.push(e));
    await hermes.sendAssistantMessage('hello there friend');
    await vi.waitFor(() => expect(events.some((e) => e.kind === 'complete')).toBe(true), { timeout: 5000 });
    unsub();
    expect(await screen.findByText('hello there friend')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'New chat' }));
    await vi.waitFor(() => expect(screen.queryByText('hello there friend')).not.toBeInTheDocument(), { timeout: 4000 });
    expect(await screen.findByText(/Ask me to draft something/)).toBeInTheDocument();
  }, 15000);
});

// ---------- W2 + D-B2: contextual rail ----------

describe('contextual rail (W2, D-B2)', () => {
  it('Assistant declares a Conversations rail (all sources); the default watchtower is replaced', async () => {
    renderAt('/assistant');
    expect(await screen.findByText('Conversations — Ally')).toBeInTheDocument();
    expect(screen.queryByText('Operational Watchtower')).not.toBeInTheDocument();
    // D-B2: every source appears — the telegram session, not just EAiOS ones
    expect(await screen.findByRole('button', { name: /Morning review/ })).toBeInTheDocument();
  });

  it('a route without a declaration keeps the default watchtower', async () => {
    renderAt('/today');
    expect(await screen.findByText('Operational Watchtower')).toBeInTheDocument();
    expect(screen.queryByText(/Conversations —/)).not.toBeInTheDocument();
  });

  it('clicking an Ally session resumes it into the chat', async () => {
    await hermes.startNewAssistantChat(); // normalize the singleton mock thread
    const user = userEvent.setup();
    renderAt('/assistant');
    await screen.findByText(/Ask me to draft something/);
    await user.click(await screen.findByRole('button', { name: /Morning review/ }));
    expect(await screen.findByText(/Three things: the partnership approval/)).toBeInTheDocument();
    expect(screen.queryByText(/Ask me to draft something/)).not.toBeInTheDocument(); // thread actually swapped
  });

  it("clicking another agent's session opens a read-only transcript drawer (never a chat target)", async () => {
    const user = userEvent.setup();
    renderAt('/assistant');
    const picker = await screen.findByLabelText('Channel context');
    await screen.findByRole('option', { name: 'Quill' });
    await user.selectOptions(picker, 'quill');
    await user.click(await screen.findByRole('button', { name: /Newsletter second draft/ }));
    const dialog = await screen.findByRole('dialog');
    expect(await within(dialog).findByText(/Tightened the opener per your note/)).toBeInTheDocument();
    expect(within(dialog).getByText(/read-only/)).toBeInTheDocument();
    expect(screen.getByLabelText('Message Ally')).toBeInTheDocument(); // chat target unchanged
    await user.keyboard('{Escape}');
  });
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
});

afterEach(() => {
  holder.rpc = realRpc;
});

describe('live sessions + channel (stubbed RPC)', () => {
  it('listSessionsFor scopes by profile and maps the probed row shape', async () => {
    const { calls } = stubRpc(async (m) => {
      if (m === 'session.list') {
        return { sessions: [{ id: 's1', title: 'Newsletter', preview: 'draft…', started_at: 1787824279, message_count: 4, source: 'desktop' }] };
      }
      throw new Error(`unexpected ${m}`);
    });
    const rows = await live.listSessionsFor('quill');
    expect(calls[0]).toEqual({ method: 'session.list', params: { limit: 50, profile: 'quill' } });
    expect(rows[0]).toMatchObject({ id: 's1', title: 'Newsletter', messageCount: 4, source: 'desktop' });
    expect(rows[0].startedAt).toBe(new Date(1787824279 * 1000).toISOString());
  });

  it('listSessionsFor omits the profile param for Ally (default profile)', async () => {
    const { calls } = stubRpc(async (m) => {
      if (m === 'session.list') return { sessions: [] };
      throw new Error(`unexpected ${m}`);
    });
    await live.listSessionsFor();
    expect(calls[0].params).toEqual({ limit: 50 });
  });

  it('getChannelFor reads the canonical Bot Chat via title lookup + resolved_id, profile-scoped history', async () => {
    const { calls } = stubRpc(async (m) => {
      if (m === 'session.list') return { sessions: [{ id: 'bot-1', resolved_id: 'bot-1-tip', title: 'Bot Chat' }] };
      if (m === 'session.history') {
        return {
          messages: [
            { role: 'user', text: 'Quill — draft the newsletter', timestamp: 1787824279, row_id: 1 },
            { role: 'assistant', text: 'Draft is up', timestamp: 1787824280, row_id: 2 },
            { role: 'tool', text: 'noise', timestamp: 1787824281, row_id: 3 },
          ],
        };
      }
      throw new Error(`unexpected ${m}`); // listWorkItems → mock fallback for delegations
    });
    const channel = await live.getChannelFor('quill');
    const lookup = calls.find((c) => c.method === 'session.list');
    expect(lookup?.params).toEqual({ profile: 'quill', title: 'Bot Chat', include_hidden: true });
    const hist = calls.find((c) => c.method === 'session.history');
    expect(hist?.params).toEqual({ session_id: 'bot-1-tip', profile: 'quill' });
    expect(channel.agentChat?.map((m) => m.text)).toEqual(['Quill — draft the newsletter', 'Draft is up']);
  });

  it('getChannelFor returns agentChat null when the agent has no Bot Chat (honest absence)', async () => {
    stubRpc(async (m) => {
      if (m === 'session.list') return { sessions: [] };
      throw new Error(`unexpected ${m}`);
    });
    const channel = await live.getChannelFor('scout');
    expect(channel.agentChat).toBeNull();
  });

  it('resumeAssistantSession overwrites the stored id ONLY on gateway success', async () => {
    localStorage.setItem('eaios.assistant.storedSessionId', 'old-stored');
    const { calls } = stubRpc(async (m) => {
      if (m === 'session.resume') return { session_id: 'rt-resumed' };
      throw new Error(`unexpected ${m}`);
    });
    const res = await live.resumeAssistantSession('sess-new');
    expect(res.ok).toBe(true);
    expect(calls[0]).toEqual({ method: 'session.resume', params: { session_id: 'sess-new' } });
    expect(localStorage.getItem('eaios.assistant.storedSessionId')).toBe('sess-new');
  });

  it('resumeAssistantSession failure leaves the previous stored id untouched', async () => {
    localStorage.setItem('eaios.assistant.storedSessionId', 'old-stored');
    stubRpc(async () => {
      throw new Error('session not found (4023)');
    });
    const res = await live.resumeAssistantSession('sess-gone');
    expect(res.ok).toBe(false);
    expect(localStorage.getItem('eaios.assistant.storedSessionId')).toBe('old-stored');
  });

  it('startNewAssistantChat creates a fresh default-profile session and replaces the stored id', async () => {
    localStorage.setItem('eaios.assistant.storedSessionId', 'old-stored');
    const { calls } = stubRpc(async (m) => {
      if (m === 'session.create') return { session_id: 'rt-new', stored_session_id: 'st-new' };
      throw new Error(`unexpected ${m}`);
    });
    const res = await live.startNewAssistantChat();
    expect(res.ok).toBe(true);
    expect(calls[0]).toEqual({ method: 'session.create', params: { title: 'EAiOS — My Assistant' } });
    expect(localStorage.getItem('eaios.assistant.storedSessionId')).toBe('st-new');
  });
});
