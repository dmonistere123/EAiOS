/**
 * Phase 5.5 acceptance tests (app side) — spec §8.7/§8.8.
 * §8.7 citation contract: retrieval UI cites source + chunk, drawer shows
 *   the resolvable eaios://chunk/<id> URI.
 * §8.8 indexing + versioning: failed sources surface their error detail;
 *   playbook runs record and display the version they ran.
 * Sidecar-level acceptance (state machine, scope enforcement) lives in
 * sidecar/test_sidecar.py — `npm run test:sidecar`.
 */
import { describe, expect, it, beforeAll } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import Knowledge from '../pages/Knowledge';
import Skills from '../pages/Skills';
import { startRuntime, getState } from '../state/runtime';
import { hermes } from '../adapters';

beforeAll(() => {
  startRuntime();
});

describe('§8.7 citation contract', () => {
  it('retrieval results carry source+chunk refs and the drawer shows the cite-as URI', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <Knowledge />
      </MemoryRouter>,
    );
    await user.type(screen.getByLabelText('Retrieval query'), 'brand');
    await user.click(screen.getByRole('button', { name: 'Search' }));
    // wait for an actual result (snippet text only exists in result cards —
    // the sources table also contains 'brand guidelines' and would match early)
    const snippet = await screen.findByText(/mock excerpt from/, undefined, { timeout: 4000 });
    await user.click(snippet.closest('button')!);
    const dialog = await screen.findByRole('dialog', undefined, { timeout: 4000 });
    expect(dialog).toBeInTheDocument();
    // the resolvable citation URI must be visible
    expect(await screen.findByText(/eaios:\/\/chunk\//)).toBeInTheDocument();
  });
});

describe('§8.8 indexing state machine (UI surface)', () => {
  it('failed sources keep and display their error detail', async () => {
    render(
      <MemoryRouter>
        <Knowledge />
      </MemoryRouter>,
    );
    expect(await screen.findByText('Vendor contracts 2026.zip', undefined, { timeout: 4000 })).toBeInTheDocument();
    expect(screen.getByText(/Unsupported archive format/)).toBeInTheDocument();
    // processing state renders too (fixture k-03)
    expect(screen.getByText('processing')).toBeInTheDocument();
  });
});

describe('§8.8 playbook versioning', () => {
  it('runs record the version they ran and history displays it', async () => {
    const res = await hermes.runPlaybook('p-02', { assignee: 'ally' });
    expect(res.ok).toBe(true);
    expect(res.data!.playbookVersion).toBe('1.2.0');

    // refresh the slice the page reads, then check the rendered history
    const { refreshPlaybookRuns } = await import('../state/runtime');
    await refreshPlaybookRuns();
    expect(getState().playbookRuns.filter((r) => r.playbookId === 'p-02').every((r) => r.playbookVersion)).toBe(true);

    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <Skills />
      </MemoryRouter>,
    );
    await user.click(await screen.findByRole('tab', { name: /Playbooks/ }));
    expect(await screen.findByText('Monthly Expense Audit', undefined, { timeout: 4000 })).toBeInTheDocument();
    const historyButtons = await screen.findAllByRole('button', { name: /History \(\d+\)/ });
    await user.click(historyButtons[historyButtons.length - 1]); // p-02 card (second)
    await waitFor(() => expect(screen.getAllByText(/^v1\.2\.0$/).length).toBeGreaterThan(0), { timeout: 4000 });
  });
});
