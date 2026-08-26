/**
 * Knowledge slice tests — Phase 5.2. Mock adapter (VITE_HERMES_LIVE forced
 * off in vitest env) hydrates the knowledge slice; the Knowledge page lists
 * sources and the add-URL flow goes through the adapter.
 */
import { describe, expect, it, beforeAll, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import Knowledge from '../pages/Knowledge';
import { startRuntime, getState } from '../state/runtime';
import { knowledge } from '../adapters';

beforeAll(() => {
  startRuntime();
});

describe('knowledge slice (mock adapter contract)', () => {
  it('listSources returns fixture sources with governance fields', async () => {
    const sources = await knowledge.listSources();
    expect(sources.length).toBeGreaterThan(0);
    for (const s of sources) {
      expect(['private', 'workspace', 'agent']).toContain(s.scope);
      expect(['pending', 'processing', 'ready', 'failed', 'stale']).toContain(s.indexingStatus);
    }
  });

  it('addUrl then removeSource round-trips', async () => {
    const src = await knowledge.addUrl('https://example.com/handbook', { name: 'Handbook', scope: 'workspace', citationEnabled: true });
    expect(src.indexingStatus).toBe('ready');
    expect(src.uri).toBe('https://example.com/handbook');
    const res = await knowledge.removeSource(src.id);
    expect(res.ok).toBe(true);
  });

  it('runtime hydration populates state.knowledge', async () => {
    await waitFor(() => expect(getState().knowledge.length).toBeGreaterThan(0), { timeout: 4000 });
  });
});

describe('Knowledge page', () => {
  it('lists sources and adds a URL source through the adapter', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <Knowledge />
      </MemoryRouter>,
    );

    // Fixture source appears after hydration
    expect(await screen.findByText('Q3 board deck (working).pptx', undefined, { timeout: 4000 })).toBeInTheDocument();

    // Open Add source → URL tab → submit
    await user.click(screen.getByRole('button', { name: 'Add source' }));
    await user.click(screen.getByRole('tab', { name: 'Add URL' }));
    const spy = vi.spyOn(knowledge, 'addUrl');
    await user.type(screen.getByPlaceholderText('https://…'), 'https://allygnment.com/values');
    await user.click(screen.getByRole('button', { name: /Add & index/i }));
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1), { timeout: 4000 });
    const [calledUrl, calledMeta] = spy.mock.calls[0];
    expect(calledUrl).toBe('https://allygnment.com/values');
    expect((calledMeta as { scope: string }).scope).toBe('private');
  });
});
