/**
 * Dogfood fixes (2026-08-29) — regression suites:
 * 1. connectApp must NEVER reuse another toolkit's auth config (Composio
 *    ignores ?toolkit= — LinkedIn reused Gmail's config, 3 duplicate
 *    connections). Asserts toolkit_slug param + toolkit-match guard.
 * 2. Connections cards expose Disconnect (two-step confirm).
 * 3. Agent properties drawer edits SOUL.md (version-checked) + role.
 * 4. Telegram bot binding: mock contract + Add Agent bind-at-creation.
 */
import { describe, expect, it, beforeAll, afterEach, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import Connections from '../pages/Connections';
import Staff from '../pages/Staff';
import { startRuntime, refreshAgents } from '../state/runtime';
import { composio, hermes, live } from '../adapters';

/** adapters/index composio IS the LiveComposioAdapter singleton (self-falls-back to mock). */
const liveComposio = composio as unknown as { useMock?: boolean; connectApp: (slug: string) => Promise<{ flowId: string; authUrl?: string; note?: string }> };

beforeAll(() => {
  startRuntime();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  liveComposio.useMock = undefined; // reset the live-ok latch between tests
});

// ---------- 1. connectApp auth-config selection (the 3× Gmail bug) ----------

describe('connectApp never reuses another toolkit’s auth config', () => {
  it('LinkedIn connect creates its OWN config even when the API returns Gmail’s', async () => {
    const calls: { url: string; method: string; body?: unknown }[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        calls.push({ url, method: init?.method ?? 'GET', body: init?.body ? JSON.parse(String(init.body)) : undefined });
        const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status });
        if (url.includes('/connected_accounts?limit=1')) return json({ items: [] }); // liveOk
        if (url.includes('/api/v3/toolkits')) {
          return json({ items: [{ name: 'LinkedIn', slug: 'linkedin', composio_managed_auth_schemes: ['OAUTH2'], meta: { description: 'd', tools_count: 10 } }] });
        }
        if (url.includes('/api/v3/auth_configs?') && !calls.some((c) => c.method === 'POST' && c.url.includes('/auth_configs'))) {
          // THE BUG: API returns Gmail's config regardless of the requested toolkit
          return json({ items: [{ id: 'ac_gmail_existing', is_composio_managed: true, toolkit: { slug: 'gmail' } }] });
        }
        if (url.includes('/api/v3/auth_configs') && init?.method === 'POST') {
          return json({ toolkit: { slug: 'linkedin' }, auth_config: { id: 'ac_linkedin_new', is_composio_managed: true } }, 201);
        }
        if (url.includes('/connected_accounts/link')) {
          return json({ link_token: 'lk_1', redirect_url: 'https://connect.composio.dev/link/lk_1' }, 201);
        }
        return json({}, 404);
      }),
    );
    (liveComposio as unknown as { useMock?: boolean }).useMock = undefined; // reset the fallback latch

    const flow = await liveComposio.connectApp('linkedin');

    expect(flow.authUrl).toBe('https://connect.composio.dev/link/lk_1');
    // the filter param is the working one
    expect(calls.find((c) => c.url.includes('/api/v3/auth_configs?'))?.url).toContain('toolkit_slug=linkedin');
    // a NEW config was created for linkedin — Gmail's id was NOT reused
    const create = calls.find((c) => c.method === 'POST' && c.url.endsWith('/api/v3/auth_configs'));
    expect(create).toBeTruthy();
    expect(JSON.stringify(create!.body)).toContain('linkedin');
    // and the link was minted against the NEW config, never ac_gmail_existing
    const link = calls.find((c) => c.url.includes('/connected_accounts/link'));
    expect(JSON.stringify(link?.body)).toContain('ac_linkedin_new');
    expect(JSON.stringify(link?.body)).not.toContain('ac_gmail_existing');
  });

  it('a matching managed config IS reused (no duplicate configs)', async () => {
    const calls: { url: string; method: string; body?: unknown }[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        calls.push({ url, method: init?.method ?? 'GET', body: init?.body ? JSON.parse(String(init.body)) : undefined });
        const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status });
        if (url.includes('/connected_accounts?limit=1')) return json({ items: [] });
        if (url.includes('/api/v3/toolkits')) return json({ items: [{ name: 'Gmail', slug: 'gmail', composio_managed_auth_schemes: ['OAUTH2'], meta: {} }] });
        if (url.includes('/api/v3/auth_configs?')) return json({ items: [{ id: 'ac_gmail_existing', is_composio_managed: true, toolkit: { slug: 'gmail' } }] });
        if (url.includes('/connected_accounts/link')) return json({ link_token: 'lk_2', redirect_url: 'https://connect.composio.dev/link/lk_2' }, 201);
        return json({}, 404);
      }),
    );
    (liveComposio as unknown as { useMock?: boolean }).useMock = undefined;

    const flow = await liveComposio.connectApp('gmail');
    expect(flow.authUrl).toBe('https://connect.composio.dev/link/lk_2');
    expect(JSON.stringify(calls.find((c) => c.url.includes('/connected_accounts/link'))?.body)).toContain('ac_gmail_existing');
    expect(calls.some((c) => c.method === 'POST' && c.url.endsWith('/api/v3/auth_configs'))).toBe(false); // no duplicate created
  });
});

// ---------- 5. kanban write commands: text output on success (the JSON.parse bug) ----------

describe('kanban<T> tolerates human-text success output', () => {
  /** Swap the live adapter's private rpc with a stub that mimics cli.exec. */
  function stubRpc(behavior: (argv: string[]) => { code: number; output: string }) {
    const calls: string[][] = [];
    (live as unknown as { rpc: { call: (m: string, p: { argv: string[] }) => Promise<unknown> } }).rpc = {
      call: vi.fn(async (_method: string, params: { argv: string[] }) => {
        calls.push(params.argv);
        return behavior(params.argv);
      }),
    };
    return calls;
  }

  it('delegateWork: `assign` prints text and exits 0 → ok:true, not a JSON.parse error', async () => {
    stubRpc(() => ({ code: 0, output: '✔ t_810c8eff assigned to quill\n' }));
    const res = await live.delegateWork('t_810c8eff', { agentId: 'quill' });
    expect(res.ok).toBe(true);
  });

  it('decideApproval approve: ASSIGNS to the envelope requester so the dispatcher executes (not complete)', async () => {
    const calls = stubRpc((argv) =>
      argv.includes('--json')
        ? { code: 0, output: JSON.stringify([{ id: 't_810c8eff', title: 'Send email', status: 'ready', body: '{"eaios":"approval","actionType":"send","targetSystem":"outlook","risk":"medium","requestedBy":"quill"}', created_at: 1787900000 }]) }
        : { code: 0, output: '✔ t_810c8eff assigned to quill\n' },
    );
    (live as unknown as { tasksCache?: unknown }).tasksCache = undefined;
    const res = await live.decideApproval('t_810c8eff', { decision: 'approved' });
    expect(res.ok).toBe(true);
    const assign = calls.find((a) => a[1] === 'assign'); // argv = ['kanban', ...]
    expect(assign).toBeTruthy();
    expect(assign![2]).toBe('t_810c8eff');
    expect(assign![3]).toBe('quill'); // requester from the envelope, not 'default'
    expect(calls.some((a) => a[1] === 'complete')).toBe(false); // never close without execution
  });

  it('updateApprovalPayload PUTs a new envelope body to /api/kanban', async () => {
    const envelope = { eaios: 'approval', actionType: 'send', targetSystem: 'outlook', risk: 'medium' as const, requestedBy: 'quill', payload: 'Original body' };
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === '/api/kanban' && (init?.method ?? 'GET') === 'GET') {
        return new Response(JSON.stringify({ tasks: [{ id: 't_810c8eff', title: 'Send email', status: 'ready', body: JSON.stringify(envelope), created_at: 1787900000 }] }), { status: 200 });
      }
      if (url === '/api/kanban' && init?.method === 'PUT') {
        const body = JSON.parse(String(init.body)) as { id: string; body: string };
        expect(body.id).toBe('t_810c8eff');
        const parsed = JSON.parse(body.body) as { payload: string };
        expect(parsed.payload).toBe('Edited body');
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }
      return new Response(JSON.stringify({ error: 'unexpected' }), { status: 404 });
    });
    vi.stubGlobal('fetch', fetchMock);
    (live as unknown as { tasksCache?: unknown }).tasksCache = undefined;
    const res = await live.updateApprovalPayload('t_810c8eff', 'Edited body');
    expect(res.ok).toBe(true);
    expect(fetchMock.mock.calls.some((c) => (c[1] as RequestInit | undefined)?.method === 'PUT')).toBe(true);
  });

  it('reads still parse --json output', async () => {
    stubRpc((argv) =>
      argv.includes('--json')
        ? { code: 0, output: JSON.stringify([{ id: 't_1', title: 'Real task', status: 'ready', created_at: 1787900000 }]) }
        : { code: 0, output: 'ok' },
    );
    (live as unknown as { tasksCache?: unknown }).tasksCache = undefined;
    const rows = await live.listWorkItems();
    expect(rows.some((w) => w.id === 't_1' && w.title === 'Real task')).toBe(true);
  });

  it('CLI failures surface the CLI message, not a parse error', async () => {
    stubRpc(() => ({ code: 1, output: 'no such task: w-04\n' }));
    const res = await live.delegateWork('w-04', { agentId: 'quill' });
    expect(res.ok).toBe(false);
    expect(res.error?.safeMessage).toContain('no such task');
  });
});

describe('Disconnect (two-step confirm)', () => {
  it('Disconnect → Confirm disconnect flips the card to disconnected', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <Connections />
      </MemoryRouter>,
    );
    const card = (await screen.findByText('Mailchimp')).closest('div.rounded-xl') as HTMLElement;
    await user.click(within(card).getByRole('button', { name: 'Disconnect' }));
    await user.click(within(card).getByRole('button', { name: 'Confirm disconnect' }));
    expect(await within(card).findByText('disconnected', undefined, { timeout: 4000 })).toBeInTheDocument();
  });
});

// ---------- 3. SOUL.md + role editing ----------

describe('agent properties: SOUL.md and role editing', () => {
  it('loads, edits, and saves SOUL.md with the version check', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <Staff />
      </MemoryRouter>,
    );
    await user.click(await screen.findByRole('button', { name: 'Quill, waiting approval' }));
    const dialog = await screen.findByRole('dialog');
    const editor = await within(dialog).findByLabelText('SOUL.md — operating identity', undefined, { timeout: 4000 });
    await user.clear(editor);
    await user.type(editor, '# Quill\n\nYou write like the Economist on a deadline.');
    await user.click(within(dialog).getByRole('button', { name: 'Save SOUL.md (version-checked)' }));
    // persisted at the adapter level (toasts only render inside AppShell — assert the write, not the toast)
    await vi.waitFor(async () => expect((await hermes.readEnvironmentFile('soul-quill')).content).toContain('Economist'), { timeout: 5000 });
  });

  it('role edits write through updateAgentConfig', async () => {
    const res = await hermes.updateAgentConfig('quill', { description: 'Chief writing officer' });
    expect(res.ok).toBe(true);
    const quill = await hermes.getAgent('quill');
    expect(quill.role).toBe('Chief writing officer');
  });
});

// ---------- 4. Telegram bot binding ----------

describe('telegram bot binding', () => {
  it('mock contract: bind, existence check, default-profile refusal', async () => {
    expect((await hermes.getTelegramBotStatus('quill')).bound).toBe(false);
    const res = await hermes.setTelegramBotToken('quill', 'tok-123');
    expect(res.ok).toBe(true);
    expect((await hermes.getTelegramBotStatus('quill')).bound).toBe(true);
    const refused = await hermes.setTelegramBotToken('default', 'tok-123');
    expect(refused.ok).toBe(false);
    expect(refused.error?.code).toBe('invalid_profile');
  });

  it('Add Agent with a token binds at creation', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <Staff />
      </MemoryRouter>,
    );
    await user.click(await screen.findByRole('button', { name: '+ Add agent' }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText('Name'), 'bind-test');
    await screen.findByText('bind-test');
    await user.type(within(dialog).getByLabelText('Telegram bot token (optional)'), 'tok-bind-test');
    // the model catalog enables Create async — wait for it or the click is a no-op
    await vi.waitFor(() => expect(within(dialog).getByRole('button', { name: 'Create agent' })).toBeEnabled(), { timeout: 4000 });
    await user.click(within(dialog).getByRole('button', { name: 'Create agent' }));
    await vi.waitFor(async () => expect((await hermes.getTelegramBotStatus('bind-test')).bound).toBe(true), { timeout: 6000 });
    await refreshAgents();
  });
});
