import { describe, expect, it, beforeAll, vi, afterEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import Staff from '../pages/Staff';
import AppShell from '../app/AppShell';
import { startRuntime } from '../state/runtime';
import { OrgChart } from '../components/OrgChart';
import type { Agent } from '../domain/types';

afterEach(() => vi.unstubAllGlobals());

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
  it('org view is the default: brain hub, staff on orbital rings; working agents display their runtime status', async () => {
    const { container } = render(
      <MemoryRouter>
        <Staff />
      </MemoryRouter>,
    );
    await screen.findByRole('group', { name: 'Org chart' });
    // hub + all four staff nodes, accessibly named with their live status
    expect(await screen.findByRole('button', { name: 'Ally, working' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Scout, working' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Quill, waiting approval' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ledger, idle' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sentinel, idle' })).toBeInTheDocument();
    // the hub is the hand-rolled brain glyph with the orchestrator caption
    expect(container.querySelector('[data-brain-hub]')).not.toBeNull();
    expect(screen.getByText('Orchestrator Agent')).toBeInTheDocument();
    expect(container.querySelectorAll('.staff-orbit-node[data-status="working"]')).toHaveLength(2);
    expect(screen.getByRole('button', { name: 'Pause motion' })).toHaveAttribute('aria-pressed', 'true');
    await userEvent.setup().click(screen.getByRole('button', { name: 'Pause motion' }));
    expect(screen.getByRole('button', { name: 'Rotate team' })).toHaveAttribute('aria-pressed', 'false');

  });

  it('keeps large teams readable and makes every specialist selectable', async () => {
    const make = (id: string, hub = false): Agent => ({id, name: id, role: 'Specialist', reportsToAgentId: hub ? undefined : 'default', model: {provider:'mock',model:'mock'}, availableModels:[], tools:[], status:'idle'});
    const agents = [make('default', true), ...Array.from({length:8}, (_,i) => make(`Specialist ${i+1}`))];
    const select = vi.fn(); render(<OrgChart agents={agents} onSelect={select}/>);
    const user = userEvent.setup();
    expect(screen.getByRole('button',{name:'Specialist 6, idle'})).toBeInTheDocument();
    expect(screen.queryByRole('button',{name:'Specialist 7, idle'})).not.toBeInTheDocument();
    await user.click(screen.getByRole('button',{name:'Next agents'}));
    await user.click(screen.getByRole('button',{name:'Specialist 8, idle'}));
    expect(select).toHaveBeenCalledWith(agents[8]);
    expect(screen.getByRole('button',{name:'Rotate team'})).toHaveAttribute('aria-pressed','false');
    expect(screen.getByRole('button',{name:'Next agents'})).toBeDisabled();
  });

  it('respects the system reduced-motion preference', async () => {
    vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
    render(<MemoryRouter><Staff /></MemoryRouter>);
    expect(await screen.findByRole('button', { name: 'Reduced motion' })).toBeDisabled();
  });

  it('List toggle restores the pre-W3 grid; Orbital toggles back', async () => {
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
    await user.click(screen.getByRole('tab', { name: 'Orbital' }));
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
    expect(await screen.findByRole('button', { name: 'Ally, working' })).toBeInTheDocument(); // hub survives the filter
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
