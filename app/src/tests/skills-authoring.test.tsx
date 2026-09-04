/**
 * W7 tests — skills & playbooks authoring (D-B3). Mock parity for
 * savePlaybook (create → 0.1.0; edit → bump; published edit → new draft)
 * and createSkill (validated, duplicates refused); page drawers for New /
 * Edit playbook and New skill. (The confined disk write itself is unit-
 * tested in authoring-store.test.ts; live round-trip verified on-box.)
 */
import { describe, expect, it, beforeAll, afterEach, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import Skills from '../pages/Skills';
import { startRuntime } from '../state/runtime';
import { hermes, live } from '../adapters';

beforeAll(() => {
  startRuntime();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('live listSkills union (W7: RPC cache is per-process)', () => {
  it('newly created skills appear via the skills-index union even when the RPC cache is stale', async () => {
    const holder = live as unknown as { rpc: { call: (m: string, p?: Record<string, unknown>) => Promise<unknown> } };
    const realRpc = holder.rpc;
    holder.rpc = {
      call: async (m: string) => {
        if (m === 'skills.manage') return { skills: { productivity: ['existing-skill'] } }; // stale per-process cache
        throw new Error(`unexpected ${m}`);
      },
    } as typeof realRpc;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) =>
        url === '/api/skills-index'
          ? new Response(
              JSON.stringify({
                skills: [
                  { name: 'existing-skill', category: 'productivity', description: 'Has an RPC row.', version: '1.0.0' },
                  { name: 'brand-new-skill', category: 'general', description: 'Created at runtime.', version: '0.1.0' },
                ],
              }),
              { status: 200 },
            )
          : new Response('not found', { status: 404 }),
      ),
    );
    try {
      const skills = await live.listSkills();
      expect(skills.find((sk) => sk.id === 'existing-skill')).toMatchObject({ category: 'productivity', description: 'Has an RPC row.' });
      expect(skills.find((sk) => sk.id === 'brand-new-skill')).toMatchObject({ category: 'general', version: '0.1.0' });
    } finally {
      holder.rpc = realRpc;
    }
  });
});

describe('mock savePlaybook parity', () => {
  it('create → v0.1.0 draft; edit → patch bump; published edit → new draft', async () => {
    const created = await hermes.savePlaybook({
      name: 'Board Weekly Sync',
      description: 'Pull metrics, draft the weekly, park the send.',
      status: 'draft',
      mode: 'task',
      skills: [],
      body: '## Steps\n1. Pull.\n2. Draft.\n3. Park.',
    });
    expect(created.ok).toBe(true);
    expect(created.data).toMatchObject({ id: 'board-weekly-sync', version: '0.1.0', status: 'draft' });

    const edited = await hermes.savePlaybook({
      id: 'board-weekly-sync',
      name: 'Board Weekly Sync',
      description: 'Edited description.',
      status: 'draft',
      mode: 'task',
      skills: [],
      body: '## Steps\n1. Changed.',
    });
    expect(edited.data).toMatchObject({ version: '0.1.1', status: 'draft', description: 'Edited description.' });

    // fixture p-02 (Monthly Expense Audit) is published v1.2.0 → edit lands draft v1.2.1
    const publishedEdit = await hermes.savePlaybook({
      id: 'p-02',
      name: 'Monthly Expense Audit',
      description: 'Touched.',
      status: 'published',
      mode: 'task',
      skills: [],
      body: '## Steps\n1. Touched.',
    });
    expect(publishedEdit.data).toMatchObject({ version: '1.2.1', status: 'draft' });

    const all = await hermes.listPlaybooks();
    expect(all.find((p) => p.id === 'board-weekly-sync')?.version).toBe('0.1.1');
  });
});

describe('mock createSkill parity', () => {
  it('creates, validates, and refuses duplicates', async () => {
    const res = await hermes.createSkill({ name: 'memo-drafter', category: 'productivity', description: 'Draft memos from notes.', body: '# Memo Drafter\n\n## When to Use\n- Memo time.' });
    expect(res.ok).toBe(true);
    const all = await hermes.listSkills();
    expect(all.find((sk) => sk.id === 'memo-drafter')).toMatchObject({ category: 'productivity', version: '0.1.0' });

    const dup = await hermes.createSkill({ name: 'memo-drafter', category: 'productivity', description: 'Again.', body: 'x' });
    expect(dup.ok).toBe(false);
    expect(dup.error?.code).toBe('already_exists');

    const bad = await hermes.createSkill({ name: 'Bad Name', category: 'productivity', description: 'd', body: 'b' });
    expect(bad.ok).toBe(false);
    expect(bad.error?.code).toBe('invalid_name');
  });
});

describe('mock lifecycle parity', () => {
  it('disables, enables, and deletes a skill', async () => {
    await hermes.createSkill({ name: 'toggle-skill', category: 'productivity', description: 'Toggle me.', body: '# x' });
    expect((await hermes.listSkills()).find((s) => s.id === 'toggle-skill')?.status).toBe('enabled');

    const disable = await hermes.updateSkillStatus('toggle-skill', 'productivity', 'disabled');
    expect(disable.ok).toBe(true);
    expect((await hermes.listSkills()).find((s) => s.id === 'toggle-skill')?.status).toBe('disabled');

    const enable = await hermes.updateSkillStatus('toggle-skill', 'productivity', 'enabled');
    expect(enable.ok).toBe(true);
    expect((await hermes.listSkills()).find((s) => s.id === 'toggle-skill')?.status).toBe('enabled');

    const del = await hermes.deleteSkill('toggle-skill', 'productivity');
    expect(del.ok).toBe(true);
    expect((await hermes.listSkills()).find((s) => s.id === 'toggle-skill')).toBeUndefined();
  });

  it('disables, enables, and deletes a playbook', async () => {
    const created = await hermes.savePlaybook({ name: 'Toggle Playbook', description: 'x', status: 'draft', mode: 'task', skills: [], body: '# x' });
    expect(created.data?.enabled).toBe(true);

    const disable = await hermes.updatePlaybookEnabled(created.data!.id, false);
    expect(disable.ok).toBe(true);
    expect((await hermes.listPlaybooks()).find((p) => p.id === created.data!.id)?.enabled).toBe(false);

    const enable = await hermes.updatePlaybookEnabled(created.data!.id, true);
    expect(enable.ok).toBe(true);
    expect((await hermes.listPlaybooks()).find((p) => p.id === created.data!.id)?.enabled).toBe(true);

    const del = await hermes.deletePlaybook(created.data!.id);
    expect(del.ok).toBe(true);
    expect((await hermes.listPlaybooks()).find((p) => p.id === created.data!.id)).toBeUndefined();
  });
});

describe('authoring drawers (page)', () => {
  it('New playbook drawer creates a card', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <Skills />
      </MemoryRouter>,
    );
    await user.click(await screen.findByRole('tab', { name: /Playbooks/ }));
    await user.click(screen.getByRole('button', { name: '+ New playbook' }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText('Name'), 'Customer Win Digest');
    expect(within(dialog).getByText('customer-win-digest')).toBeInTheDocument(); // live slug preview
    await user.type(within(dialog).getByLabelText('Description'), 'Digest of closed-won notes.');
    await user.type(within(dialog).getByLabelText(/Workflow instructions/), '## Steps\n1. Gather wins.\n2. Draft.');
    await user.click(within(dialog).getByRole('button', { name: 'Create playbook' }));
    expect(await screen.findByText('Customer Win Digest', undefined, { timeout: 4000 })).toBeInTheDocument();
  });

  it('Edit drawer bumps the version (published → new draft)', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <Skills />
      </MemoryRouter>,
    );
    await user.click(await screen.findByRole('tab', { name: /Playbooks/ }));
    // edit the playbook created above (draft, so no immutability warning)
    const cardEl = (await screen.findByText('Customer Win Digest')).closest('div.rounded-xl');
    expect(cardEl).toBeTruthy();
    await user.click(within(cardEl as HTMLElement).getByRole('button', { name: 'Edit' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Edit: Customer Win Digest')).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Save new version' }));
    // drawer closes; the card now shows v0.1.1
    await screen.findByText('v0.1.1', undefined, { timeout: 4000 });
  });

  it('New skill drawer creates a skill card', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <Skills />
      </MemoryRouter>,
    );
    await user.click(await screen.findByRole('button', { name: '+ New skill' }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText('Name'), 'Investor FAQ');
    expect(within(dialog).getByText('investor-faq')).toBeInTheDocument();
    await user.type(within(dialog).getByLabelText(/Description/), 'Answer recurring investor questions.');
    await user.type(within(dialog).getByLabelText(/Instructions/), '# Investor FAQ\n\n## When to Use\n- Investor asks.');
    await user.click(within(dialog).getByRole('button', { name: 'Create skill' }));
    expect(await screen.findByText('investor-faq', undefined, { timeout: 4000 })).toBeInTheDocument();
  });
});
