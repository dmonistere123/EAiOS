/**
 * F26 concierge widget (Don 2026-08-30) — floating navigation helper:
 * BrainGlyph FAB → panel → minimized pill; Ally 'concierge' lane isolation
 * (default lane untouched); nav brief + current page on the FIRST message
 * only, page-only context after; concierge-context markers stripped from
 * display; reduced-motion CSS contract. Mock lanes are keyed (F26) — the
 * concierge lane starts empty, the default lane keeps its seeded greeting.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { ConciergeWidget, stripConciergeContext } from '../components/ConciergeWidget';
import { hermes } from '../adapters';

function renderWidget(route = '/schedule') {
  return render(
    <MemoryRouter initialEntries={[route]}>
      <ConciergeWidget />
    </MemoryRouter>,
  );
}

describe('ConciergeWidget (F26)', () => {
  it('FAB → panel → minimized pill → expanded → closed; brain glyph on the FAB', async () => {
    const user = userEvent.setup();
    const { container } = renderWidget();
    const fab = screen.getByRole('button', { name: 'Open the navigation concierge' });
    expect(container.querySelector('[data-brain-hub]')).not.toBeNull();

    await user.click(fab);
    expect(screen.getByRole('region', { name: 'EAiOS navigation concierge' })).toBeInTheDocument();
    expect(screen.getByText(/New here\? Ask me where anything lives/)).toBeInTheDocument();
    // concierge lane starts empty → example prompt chips show (after hydration)
    expect(await screen.findByRole('button', { name: 'How do approvals work?' })).toBeInTheDocument();
    expect(screen.getByText("Ally's Guide")).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Minimize concierge' }));
    expect(screen.queryByRole('region', { name: 'EAiOS navigation concierge' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Expand the navigation concierge' }));
    expect(screen.getByRole('region', { name: 'EAiOS navigation concierge' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Close concierge' }));
    expect(screen.getByRole('button', { name: 'Open the navigation concierge' })).toBeInTheDocument();
  });

  it('first message carries the nav brief + current page; display strips the context; default lane untouched', async () => {
    const user = userEvent.setup();
    renderWidget('/schedule');
    await user.click(screen.getByRole('button', { name: 'Open the navigation concierge' }));
    await waitFor(() => expect(screen.getByLabelText('Ask the concierge')).toBeEnabled());
    await user.type(screen.getByLabelText('Ask the concierge'), 'Where are approvals?');
    await user.click(screen.getByRole('button', { name: 'Send' }));

    // user bubble shows ONLY the question (markers stripped)
    expect(await screen.findByText('Where are approvals?')).toBeInTheDocument();
    expect(screen.queryByText(/\[concierge-context/)).not.toBeInTheDocument();

    // streamed reply lands; history is authoritative after complete
    await screen.findByText(/On it/, undefined, { timeout: 6000 });
    await waitFor(
      async () => {
        const lane = await hermes.getAssistantHistory('concierge');
        expect(lane.length).toBe(2);
      },
      { timeout: 6000 },
    );

    const lane = await hermes.getAssistantHistory('concierge');
    expect(lane[0].role).toBe('you');
    expect(lane[0].text).toContain('[concierge-context v1]');
    expect(lane[0].text).toContain('Page map:');
    expect(lane[0].text).toContain('currently on the "Schedule" page');
    expect(lane[0].text).toContain('Where are approvals?');

    // lane isolation: Ally's main chat keeps only its seeded greeting
    const main = await hermes.getAssistantHistory('default');
    expect(main.length).toBe(1);
    expect(main[0].text).toContain("I'm Ally");
  });

  it('later messages carry page-only context (brief is first-message-only)', async () => {
    const user = userEvent.setup();
    renderWidget('/usage');
    await user.click(screen.getByRole('button', { name: 'Open the navigation concierge' }));
    await waitFor(() => expect(screen.getByLabelText('Ask the concierge')).toBeEnabled());
    await user.type(screen.getByLabelText('Ask the concierge'), 'And the budget?');
    await user.click(screen.getByRole('button', { name: 'Send' }));

    await waitFor(
      async () => {
        const lane = await hermes.getAssistantHistory('concierge');
        expect(lane.length).toBe(4);
      },
      { timeout: 6000 },
    );
    const lane = await hermes.getAssistantHistory('concierge');
    const second = lane[2];
    expect(second.role).toBe('you');
    expect(second.text).toContain('[concierge-context v1]');
    expect(second.text).toContain('currently on the "Usage" page');
    expect(second.text).not.toContain('Page map:');
  });

  it('stripConciergeContext removes the envelope and keeps the question', () => {
    const raw = '[concierge-context v1]\nstuff\n[/concierge-context]\n\nWhere are approvals?';
    expect(stripConciergeContext(raw)).toBe('Where are approvals?');
    expect(stripConciergeContext('no envelope here')).toBe('no envelope here');
  });

  it('prefers-reduced-motion disables the panel animation (CSS contract)', () => {
    const css = readFileSync('src/index.css', 'utf8');
    const block = css.slice(css.indexOf('prefers-reduced-motion'));
    expect(block).toContain('.eaios-concierge-panel');
  });

  // LAST in the file: resets the singleton concierge lane (tests above
  // depend on its accumulated state).
  it('New chat clears the concierge context and resurfaces the example prompts', { timeout: 20000 }, async () => {
    const user = userEvent.setup();
    renderWidget('/today');
    await user.click(screen.getByRole('button', { name: 'Open the navigation concierge' }));
    await waitFor(() => expect(screen.getByLabelText('Ask the concierge')).toBeEnabled());
    const before = (await hermes.getAssistantHistory('concierge')).length;
    await user.type(screen.getByLabelText('Ask the concierge'), 'reminder for later');
    await user.click(screen.getByRole('button', { name: 'Send' }));
    expect(await screen.findByText('reminder for later')).toBeInTheDocument();
    await waitFor(
      async () => {
        expect((await hermes.getAssistantHistory('concierge')).length).toBe(before + 2);
      },
      { timeout: 8000 },
    );

    await user.click(screen.getByRole('button', { name: 'Start a new concierge chat' }));

    // old conversation gone, example chips back
    await waitFor(() => expect(screen.queryByText('reminder for later')).not.toBeInTheDocument(), { timeout: 6000 });
    expect(await screen.findByRole('button', { name: 'How do approvals work?' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'How do I put an agent to work?' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Where do I find a deliverable?' })).toBeInTheDocument();

    // context really is fresh: the next message carries the FULL nav brief again
    await user.click(screen.getByRole('button', { name: 'How do approvals work?' }));
    await waitFor(
      async () => {
        const lane = await hermes.getAssistantHistory('concierge');
        expect(lane.length).toBe(2);
      },
      { timeout: 8000 },
    );
    const lane = await hermes.getAssistantHistory('concierge');
    expect(lane[0].role).toBe('you');
    expect(lane[0].text).toContain('Page map:');
    expect(lane[0].text).toContain('currently on the "Today" page');

    // lane isolation: Ally's main chat still untouched
    const main = await hermes.getAssistantHistory('default');
    expect(main.length).toBe(1);
    expect(main[0].text).toContain("I'm Ally");
  });
});
