import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { handleApiRequest } from '../../server/httpApi';
import { readConciergeContext } from '../../server/concierge';
import { live } from '../adapters/live/LiveHermesAdapter';
import { conciergeStorageKey } from '../adapters/live/ConciergeSession';
import { ConciergeWidget } from '../components/ConciergeWidget';
import type { IncomingMessage, ServerResponse } from 'node:http';
vi.mock('../adapters', () => ({ hermes: live }));

const holder = live as unknown as {
  rpc: { call: ReturnType<typeof vi.fn>; onNotify: ReturnType<typeof vi.fn> };
  concierge: { invalidate(): void };
  assistantLanes: Map<string, unknown>; assistantSidToAgent: Map<string, string>; assistantWired: boolean;
};
const originalRpc = holder.rpc;
let root: string;
let docRoot: string;
let profileRoot: string;
let creates: number;
let events: ((method: string, params: Record<string, unknown>) => void)[];
let history: { role: string; text: string }[];

async function contextRequest(url: string, init?: RequestInit) {
  expect(url).toBe('/api/concierge/context'); // no RAG, version, provider or update requests
  expect(init?.cache).toBe('no-store');
  let status = 200; const headers: Record<string, string> = {}; let body = '';
  const req = { url, method: 'GET', headers: { host: 'localhost' } } as IncomingMessage;
  const res = { setHeader: (k: string, v: string) => { headers[k.toLowerCase()] = v; },
    get statusCode() { return status; }, set statusCode(v: number) { status = v; },
    end: (v: string) => { body = v; } } as unknown as ServerResponse;
  expect(await handleApiRequest(req, res, { eaiosRoot: root, hermesHome: root })).toBe(true);
  expect(headers['cache-control']).toBe('no-store');
  return new Response(body, { status, headers });
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'concierge-test-'));
  docRoot = join(root, 'concierge'); profileRoot = join(root, 'profiles', 'eaios-concierge');
  mkdirSync(docRoot); mkdirSync(profileRoot, { recursive: true });
  for (const name of ['SOUL.md']) writeFileSync(join(docRoot, name), readFileSync(resolve('../concierge', name)));
  writeFileSync(join(profileRoot, 'SOUL.md'), readFileSync(join(docRoot, 'SOUL.md')));
  writeFileSync(join(profileRoot, 'eaios-concierge.json'), JSON.stringify({ schema: 1, profile: 'eaios-concierge' }));
  creates = 0; events = []; history = []; localStorage.clear();
  holder.concierge.invalidate(); holder.assistantLanes.clear(); holder.assistantSidToAgent.clear(); holder.assistantWired = false;
  holder.rpc = {
    onNotify: vi.fn(fn => events.push(fn)),
    call: vi.fn(async (method: string, params: Record<string, unknown>) => {
      if (method === 'session.create' || method === 'session.resume') {
        expect(params.profile).toBe('eaios-concierge');
        expect(params.model).toBeUndefined(); expect(params.provider).toBeUndefined();
        if (method === 'session.create') { creates++; history = []; }
        return { session_id: `runtime-${creates}`, stored_session_id: `stored-${creates}`, info: { profile_name: 'eaios-concierge' } };
      }
      if (method === 'session.history') return { messages: history };
      if (method === 'prompt.submit') { history.push({ role: 'user', text: String(params.text) }); return { status: 'streaming' }; }
      throw new Error('Unexpected RPC method');
    }),
  };
  vi.stubGlobal('fetch', vi.fn(contextRequest));
});
afterEach(() => { holder.rpc = originalRpc; vi.unstubAllGlobals(); rmSync(root, { recursive: true, force: true }); });

describe('brain widget → backend documents → isolated Hermes profile (synthetic)', () => {
  it('documents every implemented route within the direct-context budget', () => {
    const routes = readFileSync(resolve('src/app/routes.tsx'), 'utf8');
    const context = readConciergeContext(root, root);
    for (const match of routes.matchAll(/path: '([a-z]+)'/g)) expect(context.instructions).toContain(`/${match[1]}`);
    expect(context.instructions.length).toBeLessThanOrEqual(24000);
  });

  it('delivers the exact SOUL through the widget on fresh and later turns, hiding documents', async () => {
    const user = userEvent.setup();
    render(<MemoryRouter initialEntries={['/travel']}><ConciergeWidget /></MemoryRouter>);
    await user.click(screen.getByLabelText('Open the navigation concierge'));
    await waitFor(() => expect(screen.getByLabelText('Ask the concierge')).toBeEnabled());
    await user.type(screen.getByLabelText('Ask the concierge'), 'Where do I plan a trip?');
    await user.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(history).toHaveLength(1));
    expect(history[0].text).toContain(readFileSync(join(docRoot, 'SOUL.md'), 'utf8'));
    expect(history[0].text).toContain('Travel" page (/travel)');
    expect(screen.queryByText(/EAiOS navigation reference/)).not.toBeInTheDocument();
    await live.sendAssistantMessage('And backups?', { agentId: 'concierge' });
    expect(history[1].text).toContain('## Backup — /backup');
    expect(creates).toBe(1);
    const rows = await live.getAssistantHistory('concierge');
    expect(rows[1].text).toBe('And backups?');
  });

  it('ignores legacy Ally keys; resumes only the dedicated revision and preserves all old keys', async () => {
    localStorage.setItem('eaios.assistant.storedSessionId', 'ally-history');
    localStorage.setItem('eaios.assistant.storedSessionId.concierge', 'legacy-history');
    await live.getAssistantHistory('concierge');
    expect(holder.rpc.call.mock.calls[0][0]).toBe('session.create');
    holder.concierge.invalidate();
    await live.sendAssistantMessage('hello again', { agentId: 'concierge' });
    expect(holder.rpc.call).toHaveBeenCalledWith('session.resume', { session_id: 'stored-1', profile: 'eaios-concierge' });
    expect(localStorage.getItem('eaios.assistant.storedSessionId')).toBe('ally-history');
    expect(localStorage.getItem('eaios.assistant.storedSessionId.concierge')).toBe('legacy-history');
    expect(history[0].text).toContain('# EAiOS Concierge');
  });

  it('rotates on document changes, stops old event routing, and New creates a fresh isolated chat', async () => {
    const before = readConciergeContext(root, root);
    await live.sendAssistantMessage('old', { agentId: 'concierge' });
    const seen: unknown[] = []; const unsubscribe = live.subscribeAssistant(e => seen.push(e), 'concierge');
    writeFileSync(join(docRoot, 'SOUL.md'), '# Updated instructions\nNew documentation.');
    writeFileSync(join(profileRoot, 'SOUL.md'), '# Updated instructions\nNew documentation.');
    await live.sendAssistantMessage('new', { agentId: 'concierge' });
    expect(creates).toBe(2); expect(history[0].text).toContain('New documentation.');
    expect(history[0].text).not.toContain('Documentation revision: 1');
    expect(localStorage.getItem(conciergeStorageKey(before.revision))).toBe('stored-1');
    for (const emit of events) emit('event', { type: 'message.delta', session_id: 'runtime-1', payload: { text: 'old reply' } });
    expect(seen).toEqual([]); unsubscribe();
    expect((await live.startNewAssistantChat('concierge')).ok).toBe(true); expect(creates).toBe(3);
    await live.sendAssistantMessage('fresh', { agentId: 'concierge' });
    expect(history[0].text).toContain('New documentation.');
  });

  it.each(['missing instructions', 'empty instructions', 'oversized instructions', 'missing profile', 'wrong soul'])('fails closed for %s without submitting or falling back', async reason => {
    if (reason === 'missing instructions') rmSync(join(docRoot, 'SOUL.md'));
    if (reason === 'empty instructions') writeFileSync(join(docRoot, 'SOUL.md'), '');
    if (reason === 'oversized instructions') writeFileSync(join(docRoot, 'SOUL.md'), 'x'.repeat(25000));
    if (reason === 'missing profile') rmSync(join(profileRoot, 'eaios-concierge.json'));
    if (reason === 'wrong soul') writeFileSync(join(profileRoot, 'SOUL.md'), 'Other agent');
    expect((await live.sendAssistantMessage('hi', { agentId: 'concierge' })).ok).toBe(false);
    await expect(live.getAssistantHistory('concierge')).rejects.toThrow();
    expect(holder.rpc.call).not.toHaveBeenCalled();
  });

  it('rejects a mismatched gateway profile and ambiguous resume failures; never submits', async () => {
    holder.rpc.call.mockResolvedValueOnce({ session_id: 'ally', info: { profile_name: '' } });
    expect((await live.sendAssistantMessage('hi', { agentId: 'concierge' })).ok).toBe(false);
    expect(history).toEqual([]);
    localStorage.setItem(conciergeStorageKey(readConciergeContext(root, root).revision), 'existing');
    holder.rpc.call.mockRejectedValueOnce(new Error('connection lost'));
    expect((await live.sendAssistantMessage('hi', { agentId: 'concierge' })).ok).toBe(false);
    expect(creates).toBe(0);
  });

  it('does not reuse cached context after a source disappears or the backend becomes unavailable', async () => {
    await live.sendAssistantMessage('first', { agentId: 'concierge' });
    rmSync(join(docRoot, 'SOUL.md'));
    expect((await live.sendAssistantMessage('second', { agentId: 'concierge' })).ok).toBe(false);
    vi.mocked(fetch).mockRejectedValueOnce(new Error('offline'));
    expect((await live.sendAssistantMessage('third', { agentId: 'concierge' })).ok).toBe(false);
    expect(history).toHaveLength(1);
  });

  it('requires reviewed SOUL refresh and rotates away from the previous instructions', async () => {
    await live.sendAssistantMessage('first', { agentId: 'concierge' });
    writeFileSync(join(docRoot, 'SOUL.md'), '# Revised Concierge role');
    expect((await live.sendAssistantMessage('blocked', { agentId: 'concierge' })).ok).toBe(false);
    writeFileSync(join(profileRoot, 'SOUL.md'), '# Revised Concierge role');
    expect((await live.sendAssistantMessage('revised', { agentId: 'concierge' })).ok).toBe(true);
    expect(creates).toBe(2); expect(history[0].text).toContain('# Revised Concierge role');
  });

  it('recreates an explicitly missing stored session with all context', async () => {
    localStorage.setItem(conciergeStorageKey(readConciergeContext(root, root).revision), 'stale');
    holder.rpc.call.mockRejectedValueOnce(new Error('session not found (4001)'));
    expect((await live.sendAssistantMessage('recover', { agentId: 'concierge' })).ok).toBe(true);
    expect(creates).toBe(1); expect(history[0].text).toContain('## Settings — /settings');
  });

  it('shows an explicit widget error and disables sends when context is unavailable', async () => {
    rmSync(join(docRoot, 'SOUL.md'));
    render(<MemoryRouter><ConciergeWidget /></MemoryRouter>);
    await userEvent.setup().click(screen.getByLabelText('Open the navigation concierge'));
    expect(await screen.findByRole('alert')).toHaveTextContent('Concierge is unavailable');
    expect(screen.getByLabelText('Ask the concierge')).toBeDisabled();
    expect(holder.rpc.call).not.toHaveBeenCalled();
  });
});
