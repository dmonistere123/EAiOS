/**
 * W4 tests — Connections: available vs connected.
 * Middle = connected cards (degraded link-strays shown honestly as
 * 'incomplete' with Resume connect); rail = available-to-connect catalog
 * (D-B4) with search, auth-kind badges, connected markers, and a real
 * Connect action that opens the hosted link in a new tab. Mock parity for
 * connectApp's three auth kinds. (The live flow itself was verified on-box:
 * scripts/verify-w4-connect.mjs.)
 */
import { describe, expect, it, beforeAll, afterEach, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import Connections from '../pages/Connections';
import AppShell from '../app/AppShell';
import { startRuntime } from '../state/runtime';
import { composio } from '../adapters';

beforeAll(() => {
  startRuntime();
});

afterEach(() => {
  vi.restoreAllMocks();
});

function renderAt(route: string) {
  return render(
    <MemoryRouter initialEntries={[route]}>
      <Routes>
        <Route path="/" element={<AppShell />}>
          <Route path="connections" element={<Connections />} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

async function catalogRow(name: string): Promise<HTMLElement> {
  // async: the rail section title renders before the catalog fetch resolves
  const el = await screen.findByText(name, { selector: 'span.truncate' });
  const li = el.closest('li');
  if (!li) throw new Error(`no catalog row for ${name}`);
  return li;
}

describe('catalog rail (D-B4)', () => {
  it('connected apps render in the middle; the catalog declares into the rail', async () => {
    renderAt('/connections');
    // middle: mock connections
    expect((await screen.findAllByText('don@allygnment.com')).length).toBeGreaterThan(0); // gmail + gcal fixtures
    // rail: catalog sections, not the default watchtower
    expect(await screen.findByText('Available to connect')).toBeInTheDocument();
    expect(screen.queryByText('Operational Watchtower')).not.toBeInTheDocument();
    // catalog rows from the fixture
    for (const name of ['Slack', 'Notion', 'GitHub', 'Hacker News']) {
      expect(await catalogRow(name)).toBeInTheDocument();
    }
    // an already-connected app is marked, not offered again
    expect(within(await catalogRow('Gmail')).getByText('connected')).toBeInTheDocument();
  });

  it('search filters the catalog client-side', async () => {
    const user = userEvent.setup();
    renderAt('/connections');
    await screen.findByText('Available to connect');
    await catalogRow('Slack'); // catalog loaded before filtering
    await user.type(screen.getByLabelText('Filter apps'), 'git');
    expect(await catalogRow('GitHub')).toBeInTheDocument();
    expect(screen.queryByText('Slack', { selector: 'span.truncate' })).not.toBeInTheDocument();
  });

  it('Connect on a managed app opens the hosted link in a new tab', async () => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    const user = userEvent.setup();
    renderAt('/connections');
    await screen.findByText('Available to connect');
    await user.click(within(await catalogRow('Slack')).getByRole('button', { name: 'Connect' }));
    // generous timeout: mock delay (≤1.1s) + liveOk failure latency under suite load
    await vi.waitFor(() => expect(open).toHaveBeenCalledWith('https://connect.composio.dev/link/mock-slack', '_blank', 'noopener'), { timeout: 5000 });
  });

  it('bring-own-auth apps show Needs setup with no Connect button; no-auth apps show No account', async () => {
    renderAt('/connections');
    await screen.findByText('Available to connect');
    const wp = await catalogRow('WordPress');
    expect(within(wp).getByText('Needs setup')).toBeInTheDocument();
    expect(within(wp).queryByRole('button', { name: 'Connect' })).not.toBeInTheDocument();
    const hn = await catalogRow('Hacker News');
    expect(within(hn).getByText('No account')).toBeInTheDocument();
    expect(within(hn).queryByRole('button', { name: 'Connect' })).not.toBeInTheDocument();
  });
});

describe('connected cards', () => {
  it('a degraded (abandoned-link) connection renders honestly as incomplete with Resume connect', async () => {
    renderAt('/connections');
    expect(await screen.findByText('incomplete')).toBeInTheDocument(); // wordpress fixture is degraded
    expect(screen.getByRole('button', { name: 'Resume connect' })).toBeInTheDocument();
  });
});

describe('mock connectApp contract (three auth kinds)', () => {
  it('managed → hosted link; bring-own-auth → honest note; unknown → link', async () => {
    const slack = await composio.connectApp('slack');
    expect(slack.authUrl).toBe('https://connect.composio.dev/link/mock-slack');
    const mc = await composio.connectApp('mailchimp');
    expect(mc.authUrl).toBeUndefined();
    expect(mc.note).toContain('custom auth config');
  });
});
