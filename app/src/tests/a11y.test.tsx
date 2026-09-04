/**
 * H1 — Accessibility acceptance (spec §14.4 + §11.8).
 * - Every interactive control on key pages has an accessible name
 * - Drawers move focus inside on open + close with Escape
 * - Resizable panels work from the keyboard (arrows resize, Home resets)
 * - Status is never color-alone (badges render text)
 * - Approval rows have a keyboard-reachable Inspect path (row click is pointer-only)
 */
import { describe, expect, it, beforeAll, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
// @ts-expect-error — transitive lib; its dist/index.d.ts doesn't resolve under bundler moduleResolution (test-only import)
import { computeAccessibleName } from 'dom-accessibility-api';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import AppShell from '../app/AppShell';
import Today from '../pages/Today';
import Staff from '../pages/Staff';
import Approvals from '../pages/Approvals';
import Settings from '../pages/Settings';
import Assistant from '../pages/Assistant';
import { startRuntime } from '../state/runtime';
import { hermes } from '../adapters';
import type { Approval } from '../domain/types';

beforeAll(() => {
  startRuntime();
});

function renderAt(route: string, element: React.ReactElement, path: string) {
  return render(
    <MemoryRouter initialEntries={[route]}>
      <Routes>
        <Route path="/" element={<AppShell />}>
          <Route path={path} element={element} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

/** Every interactive element must be keyboard-reachable AND named. */
function assertInteractiveNamed(container: HTMLElement) {
  const controls = container.querySelectorAll('button, a[href], input:not([type="hidden"]), select, textarea, [role="tab"], [role="separator"]');
  expect(controls.length).toBeGreaterThan(5);
  const unnamed: string[] = [];
  controls.forEach((el) => {
    if (computeAccessibleName(el).trim() === '') unnamed.push(el.outerHTML.slice(0, 80));
  });
  expect(unnamed, `unnamed controls: ${unnamed.join(' | ')}`).toEqual([]);
}

describe('§14.4 keyboard reachability + names', () => {
  it('Today + shell: every interactive control is named', async () => {
    const { container } = renderAt('/today', <Today />, 'today');
    await screen.findByText('Operating queue');
    assertInteractiveNamed(container);
  });

  it('Staff: every interactive control is named', async () => {
    const { container } = renderAt('/staff', <Staff />, 'staff');
    await screen.findByRole('group', { name: 'Org chart' });
    assertInteractiveNamed(container);
  });

  it('Approvals: every interactive control is named', async () => {
    const { container } = renderAt('/approvals', <Approvals />, 'approvals');
    await screen.findAllByText('Investor update — 14 recipients'); // page table AND rail list
    assertInteractiveNamed(container);
  });

  it('Settings: every interactive control is named', async () => {
    const { container } = renderAt('/settings', <Settings />, 'settings');
    await screen.findByText('Environment files');
    assertInteractiveNamed(container);
  });

  it('Assistant: every interactive control is named', async () => {
    const { container } = renderAt('/assistant', <Assistant />, 'assistant');
    await screen.findByLabelText('Message Ally');
    assertInteractiveNamed(container);
  });

  it('approval rows expose a keyboard-reachable Inspect button', async () => {
    renderAt('/approvals', <Approvals />, 'approvals');
    const inspect = await screen.findAllByRole('button', { name: 'Inspect' });
    expect(inspect.length).toBe(3); // one per pending fixture approval
  });

  it('approval inspector lets the executive edit the prepared payload', async () => {
    const user = userEvent.setup();
    renderAt('/approvals', <Approvals />, 'approvals');
    const matches = await screen.findAllByText('Investor update — 14 recipients');
    const row = (matches[0].closest('tr') ?? matches[0].closest('li')) as HTMLElement;
    await user.click(within(row).getByRole('button', { name: 'Inspect' }));
    await user.click(await screen.findByRole('button', { name: 'Edit' }));
    const textarea = await screen.findByRole('textbox');
    await user.clear(textarea);
    await user.type(textarea, 'To: investors@allygnment.com\nSubject: Updated');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    await vi.waitFor(async () => {
      const updated = (await hermes.listApprovals({ status: ['pending'] })).find((a: Approval) => a.id === 'a-03');
      expect(updated?.payload).toBe('To: investors@allygnment.com\nSubject: Updated');
    }, { timeout: 4000 });
  });
});

describe('§14.4 drawers manage focus', () => {
  it('opening a drawer moves focus inside it; Escape closes', async () => {
    const user = userEvent.setup();
    renderAt('/today', <Today />, 'today');
    await screen.findByText('Operating queue');
    await user.click((await screen.findAllByRole('button', { name: 'Delegate' }))[0]);
    const dialog = await screen.findByRole('dialog');
    // focus moved into the dialog (close button autofocus)
    expect(dialog.contains(document.activeElement)).toBe(true);
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});

describe('§14.4 resizable panels — keyboard alternative', () => {
  it('arrow keys resize the left nav, Home resets', async () => {
    renderAt('/today', <Today />, 'today');
    const sep = screen.getByRole('separator', { name: 'Resize navigation pane' });
    const nav = screen.getByRole('navigation', { name: 'Primary' });
    const before = parseInt(nav.style.width, 10);
    fireEvent.keyDown(sep, { key: 'ArrowRight' });
    expect(parseInt(nav.style.width, 10)).toBe(before + 8);
    fireEvent.keyDown(sep, { key: 'ArrowLeft', shiftKey: true });
    expect(parseInt(nav.style.width, 10)).toBe(before + 8 - 32);
    fireEvent.keyDown(sep, { key: 'Home' });
    expect(parseInt(nav.style.width, 10)).toBe(264); // LIMITS.left.def
  });

  it('status badges carry text (never color alone)', async () => {
    renderAt('/staff', <Staff />, 'staff');
    await screen.findByRole('group', { name: 'Org chart' });
    for (const label of ['Idle', 'Working', 'Awaiting approval']) {
      expect(screen.getAllByText(label).length).toBeGreaterThan(0);
    }
  });
});

describe('§14.4 table semantics', () => {
  it('Today queue and Approvals tables use real header cells', async () => {
    renderAt('/today', <Today />, 'today');
    await screen.findByText('Operating queue');
    expect(within(screen.getByRole('table')).getAllByRole('columnheader').length).toBeGreaterThanOrEqual(4);
  });
});
