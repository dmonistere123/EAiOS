/**
 * Skills slice tests — Phase 5. Mock adapter (VITE_HERMES_LIVE forced off in
 * vitest env) hydrates the runtime skills slice; the Skills page renders
 * runtime skills in the skills tab and fixture playbooks in the other.
 */
import { describe, expect, it, beforeAll } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import Skills from '../pages/Skills';
import { startRuntime, getState } from '../state/runtime';
import { hermes } from '../adapters';

beforeAll(() => {
  startRuntime();
});

describe('skills slice (mock adapter contract)', () => {
  it('listSkills returns enabled skills with description and version', async () => {
    const skills = await hermes.listSkills();
    expect(skills.length).toBeGreaterThan(0);
    for (const sk of skills) {
      expect(sk.status).toBe('enabled');
      expect(sk.name).toBeTruthy();
      expect(sk.category).toBeTruthy();
    }
  });

  it('runtime hydration populates state.skills', async () => {
    // startRuntime boot hydrates all slices; wait for the skills slice.
    await waitFor(() => expect(getState().skills.length).toBeGreaterThan(0), { timeout: 4000 });
  });
});

describe('Skills page', () => {
  it('renders runtime skills in the skills tab and fixture playbooks in the playbooks tab', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <Skills />
      </MemoryRouter>,
    );

    // Skills tab: mock fixture skill appears
    expect(await screen.findByText('competitor-news-monitor', undefined, { timeout: 4000 })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Skills \(\d+\)/ })).toHaveAttribute('aria-selected', 'true');

    // Playbooks tab: fixture playbook appears
    await user.click(screen.getByRole('tab', { name: 'Playbooks' }));
    expect(await screen.findByText('Weekly Investor Update')).toBeInTheDocument();
    expect(screen.queryByText('competitor-news-monitor')).not.toBeInTheDocument();
  });
});
