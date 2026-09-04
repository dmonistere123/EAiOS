/**
 * W3 tests — Staff org visualization + per-agent rail, post "AI Office"
 * orbital redesign: brain hub (SVG glyph, Orchestrator caption), staff on
 * dashed orbital rings that revolve via hand-rolled CSS (reduced-motion
 * contract in index.css); List toggle restores the pre-W3 grid; selecting
 * an agent opens its properties drawer AND declares its channel into the
 * right rail (D-B4); no selection = default watchtower; honest no-Bot-Chat
 * empty state.
 */
import { describe, expect, it, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import Staff from '../pages/Staff';
import AppShell from '../app/AppShell';
import { startRuntime } from '../state/runtime';
import { distributeIntoRings } from '../components/OrgChart';

beforeAll(() => {
  startRuntime();
});

function renderAt(route: string) {
  return render(
    <MemoryRouter initialEntries={[route]}>
      <Routes>
        <Route path="/" element={<AppShell />}>
          <Route path="staff" element={<Staff />} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

describe('org visualization', () => {
  it('org view is the default: brain hub, staff on orbital rings; working agents pulse', async () => {
    const { container } = render(
      <MemoryRouter>
        <Staff />
      </MemoryRouter>,
    );
    await screen.findByRole('group', { name: 'Org chart' });
    // hub + all four staff nodes, accessibly named with their live status
    expect(screen.getByRole('button', { name: 'Ally, working' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Scout, working' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Quill, waiting approval' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ledger, idle' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sentinel, idle' })).toBeInTheDocument();
    // the hub is the hand-rolled brain glyph with the orchestrator caption
    expect(container.querySelector('[data-brain-hub]')).not.toBeNull();
    expect(screen.getByText('Orchestrator Agent')).toBeInTheDocument();
    // four staff fit one orbital ring: one dashed track + one revolving wrapper
    expect(container.querySelectorAll('[data-orbit-track]').length).toBe(1);
    expect(container.querySelectorAll('.eaios-orbit-ring').length).toBe(1);
    // every orbiting node counter-rotates so its label stays upright
    expect(container.querySelectorAll('.eaios-orbit-counter').length).toBe(4);
    // pulse markers on exactly the working agents (ally + scout)
    expect(container.querySelectorAll('.animate-ping').length).toBe(2);
  });

  it('ring distribution: ≤5 staff orbit one ring, more split across two', () => {
    expect(distributeIntoRings([1, 2, 3, 4])).toEqual([[1, 2, 3, 4]]);
    expect(distributeIntoRings([1, 2, 3, 4, 5])).toEqual([[1, 2, 3, 4, 5]]);
    expect(distributeIntoRings([1, 2, 3, 4, 5, 6, 7])).toEqual([
      [1, 2, 3, 4],
      [5, 6, 7],
    ]);
  });

  it('prefers-reduced-motion disables the orbit (CSS contract)', () => {
    const css = readFileSync('src/index.css', 'utf8'); // vitest cwd = app root
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)/);
    const block = css.slice(css.indexOf('prefers-reduced-motion'));
    expect(block).toContain('.eaios-orbit-ring');
    expect(block).toContain('.eaios-orbit-counter');
  });

  it('List toggle restores the pre-W3 grid; Org toggles back', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <Staff />
      </MemoryRouter>,
    );
    await screen.findByRole('group', { name: 'Org chart' });
    await user.click(screen.getByRole('tab', { name: 'List' }));
    expect(screen.queryByRole('group', { name: 'Org chart' })).not.toBeInTheDocument();
    expect(await screen.findAllByText('Idle — ready for work')).toHaveLength(2); // ledger + sentinel cards
    await user.click(screen.getByRole('tab', { name: 'Org' }));
    expect(await screen.findByRole('group', { name: 'Org chart' })).toBeInTheDocument();
  });

  it('filters apply to staff nodes; Ally stays as the hub', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <Staff />
      </MemoryRouter>,
    );
    await screen.findByRole('group', { name: 'Org chart' });
    await user.click(screen.getByRole('tab', { name: 'Idle' }));
    expect(screen.getByRole('button', { name: 'Ally, working' })).toBeInTheDocument(); // hub survives the filter
    expect(screen.getByRole('button', { name: 'Ledger, idle' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Scout, working' })).not.toBeInTheDocument();
  });
});

describe('per-agent rail (D-B4)', () => {
  it('no selection keeps the default watchtower', async () => {
    renderAt('/staff');
    expect(await screen.findByText('Operational Watchtower')).toBeInTheDocument();
  });

  it('selecting an agent opens its properties drawer and declares its channel into the rail', async () => {
    const user = userEvent.setup();
    renderAt('/staff');
    await user.click(await screen.findByRole('button', { name: 'Quill, waiting approval' }));
    // existing properties drawer
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Quill — properties')).toBeInTheDocument();
    // rail channel sections (mock channel: w-05 delegation + 2 chat messages)
    expect(await screen.findByText('Delegated to Quill')).toBeInTheDocument();
    expect(await screen.findByText('Customer newsletter — September')).toBeInTheDocument();
    expect(await screen.findByText('Ally ↔ Quill')).toBeInTheDocument();
    expect(await screen.findByText(/Draft is up \(work item w-05\)/)).toBeInTheDocument();
    expect(screen.queryByText('Operational Watchtower')).not.toBeInTheDocument();
    // closing the drawer deselects → default watchtower returns
    await user.keyboard('{Escape}');
    expect(await screen.findByText('Operational Watchtower')).toBeInTheDocument();
  });

  it('agent with no Bot Chat shows the honest empty state in the rail', async () => {
    const user = userEvent.setup();
    renderAt('/staff');
    await user.click(await screen.findByRole('button', { name: 'Scout, working' }));
    expect(await screen.findByText(/No Ally↔Scout chat yet/)).toBeInTheDocument();
    expect(await screen.findByText('Market scan: AI ops tooling')).toBeInTheDocument(); // scout's delegation
    await user.keyboard('{Escape}');
  });
});
