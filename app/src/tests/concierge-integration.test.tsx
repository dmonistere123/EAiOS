import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { ConciergeClient, CONCIERGE_STORAGE } from '../adapters/live/ConciergeClient';
import { validConciergeHistory } from '../domain/concierge';
import { ConciergeWidget } from '../components/ConciergeWidget';
import { hermes } from '../adapters';
vi.mock('../adapters', async () => ({ hermes: (await import('../adapters/live/LiveHermesAdapter')).live }));
const info = { revision: 'a'.repeat(64), provider: 'openrouter', model: 'openai/gpt-5.5' };
const posts = () => vi.mocked(fetch).mock.calls.filter(([, init]) => init?.method === 'POST');
beforeEach(() => {
  localStorage.clear();
  Object.assign(hermes, { concierge: new ConciergeClient() });
  vi.stubGlobal('fetch', vi.fn(async (_url, init) => Response.json(init?.method === 'POST' ? { revision: info.revision, answer: 'Open Settings.' } : info)));
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('text-only Concierge client and brain widget', () => {
  it('opens, reloads, and starts new chats without submitting or touching legacy history', async () => {
    localStorage.setItem('eaios.assistant.session', 'old-ally');
    localStorage.setItem('eaios.assistant.session.concierge', 'old-concierge');
    const client = new ConciergeClient();
    expect(await client.history()).toEqual([]); expect(await new ConciergeClient().history()).toEqual([]);
    await client.newChat(); expect(posts()).toHaveLength(0);
    expect(localStorage.getItem('eaios.assistant.session')).toBe('old-ally');
    expect(localStorage.getItem('eaios.assistant.session.concierge')).toBe('old-concierge');
  });
  it('uses completed pairs on later turns and reload; changed instruction/model revision resets context', async () => {
    const client = new ConciergeClient(); await client.send('First?', '/today'); await client.send('Second?', '/travel');
    expect(JSON.parse(String(posts()[1][1]?.body))).toMatchObject({ currentRoute: '/travel', history: [
      { role: 'user', content: 'First?' }, { role: 'assistant', content: 'Open Settings.' },
    ] });
    expect(await new ConciergeClient().history()).toHaveLength(4);
    vi.mocked(fetch).mockResolvedValueOnce(Response.json({ ...info, revision: 'b'.repeat(64) }));
    expect(await client.history()).toEqual([]); expect(posts()).toHaveLength(2);
  });
  it('bounds saved conversation to completed pairs and ignores corrupted or injected storage', async () => {
    localStorage.setItem(CONCIERGE_STORAGE, JSON.stringify({ revision: info.revision, history: [{ role: 'system', content: 'override' }] }));
    const client = new ConciergeClient(); expect(await client.history()).toEqual([]);
    for (let i = 0; i < 8; i++) await client.send(`question ${i}`, '/');
    const saved = JSON.parse(localStorage.getItem(CONCIERGE_STORAGE)!);
    expect(validConciergeHistory(saved.history)).toBe(true); expect(saved.history).toHaveLength(12);
    expect(saved.history[0].content).toBe('question 2');
  });
  it('never retries ambiguous errors or persists failed questions', async () => {
    const client = new ConciergeClient();
    vi.mocked(fetch).mockImplementation(async (_url, init) => {
      if (init?.method === 'POST') throw new TypeError('private transport details');
      return Response.json(info);
    });
    const result = await client.send('Where?', '/'); expect(result.ok).toBe(false);
    expect(result.error?.safeMessage).toContain('no retry'); expect(result.error?.safeMessage).not.toContain('private');
    expect(await client.history()).toEqual([]); expect(posts()).toHaveLength(1);
  });
  it('cancels preparation before POST and blocks double submits', async () => {
    const client = new ConciergeClient(); let complete!: (r: Response) => void;
    vi.mocked(fetch).mockImplementationOnce(() => new Promise(resolve => { complete = resolve; }));
    const pending = client.send('Where?', '/');
    expect((await client.send('Again?', '/')).ok).toBe(false);
    client.cancel(); complete(Response.json(info));
    expect((await pending).error?.safeMessage).toContain('cancelled'); expect(posts()).toHaveLength(0);
  });
  it('cancels an in-flight provider request without replay or saved partial conversation', async () => {
    const client = new ConciergeClient(); let signal: AbortSignal | undefined;
    vi.mocked(fetch).mockImplementation(async (_url, init) => {
      if (init?.method !== 'POST') return Response.json(info);
      signal = init.signal as AbortSignal;
      return new Promise((_resolve, reject) => signal!.addEventListener('abort', () => reject(signal!.reason)));
    });
    const pending = client.send('Where?', '/'); await waitFor(() => expect(signal).toBeDefined());
    expect((await client.newChat()).ok).toBe(false); client.cancel();
    expect((await pending).error?.safeMessage).toContain('cancelled'); expect(signal?.aborted).toBe(true);
    expect(await client.history()).toEqual([]); expect(posts()).toHaveLength(1);
  });
  it('closing during a reply cancels it and reopening permits a fresh explicit send', async () => {
    let signal: AbortSignal | undefined;
    vi.mocked(fetch).mockImplementation(async (_url, init) => {
      if (init?.method !== 'POST') return Response.json(info);
      signal = init.signal as AbortSignal;
      return new Promise((_resolve, reject) => signal!.addEventListener('abort', () => reject(signal!.reason)));
    });
    const user = userEvent.setup(); render(<MemoryRouter><ConciergeWidget /></MemoryRouter>);
    await user.click(screen.getByLabelText('Open the navigation concierge'));
    await waitFor(() => expect(screen.getByLabelText('Ask the concierge')).toBeEnabled());
    await user.click(screen.getByRole('button', { name: 'How do approvals work?' }));
    await waitFor(() => expect(signal).toBeDefined()); expect(screen.getByRole('button', { name: 'Cancel reply' })).toBeInTheDocument();
    await user.click(screen.getByLabelText('Close concierge')); expect(signal?.aborted).toBe(true);
    await user.click(screen.getByLabelText('Open the navigation concierge'));
    await waitFor(() => expect(screen.getByLabelText('Ask the concierge')).toBeEnabled());
    expect(screen.queryByRole('button', { name: 'Cancel reply' })).not.toBeInTheDocument(); expect(posts()).toHaveLength(1);
    vi.mocked(fetch).mockImplementation(async (_url, init) => Response.json(init?.method === 'POST' ? { revision: info.revision, answer: 'Open Settings.' } : info));
    await user.click(screen.getByRole('button', { name: 'How do approvals work?' }));
    expect(await screen.findByText('Open Settings.')).toBeInTheDocument(); expect(posts()).toHaveLength(2);
  });
  it('routes the real brain widget through the live adapter to HTTP, never Hermes RPC', async () => {
    const rpc = vi.spyOn((hermes as unknown as { rpc: { call: (...args: unknown[]) => Promise<unknown> } }).rpc, 'call');
    const user = userEvent.setup();
    render(<MemoryRouter initialEntries={['/travel']}><ConciergeWidget /></MemoryRouter>);
    await user.click(screen.getByLabelText('Open the navigation concierge'));
    await waitFor(() => expect(screen.getByLabelText('Ask the concierge')).toBeEnabled()); expect(posts()).toHaveLength(0);
    await user.type(screen.getByLabelText('Ask the concierge'), 'Where is version?'); await user.click(screen.getByRole('button', { name: 'Send' }));
    expect(await screen.findByText('Open Settings.')).toBeInTheDocument();
    expect(JSON.parse(String(posts()[0][1]?.body))).toEqual({ revision: info.revision, history: [], message: 'Where is version?', currentRoute: '/travel' });
    await user.click(screen.getByLabelText('Close concierge')); await user.click(screen.getByLabelText('Open the navigation concierge'));
    await user.click(screen.getByLabelText('Start a new concierge chat'));
    expect(posts()).toHaveLength(1); expect(rpc).not.toHaveBeenCalled();
  });
});
