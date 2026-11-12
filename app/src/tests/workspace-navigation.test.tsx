import { afterEach, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { NAV_MODULES, WorkspaceNavigation } from '../components/WorkspaceNavigation';
import Staff from '../pages/Staff';
import { humanDirectory, humanDelegation } from '../adapters';
function Current() { const {pathname} = useLocation(); return <output aria-label="Current page">{pathname}</output>; }
function navigation(path = '/staff', modules: string[] = NAV_MODULES, collapsed = false, onExpand = vi.fn()) {
  return render(<MemoryRouter initialEntries={[path]}><WorkspaceNavigation modules={modules} collapsed={collapsed} pending={2} onExpand={onExpand}/><Current/></MemoryRouter>);
}
afterEach(() => { localStorage.clear(); vi.restoreAllMocks(); });
it('groups the executive links in order and expands without navigating away', async () => {
  navigation(); const user = userEvent.setup();
  expect(screen.getAllByRole('link').map(a => a.textContent?.replace(/^[^A-Za-z]+/, ''))).toEqual(['Today','Staff','AI Assistant','HI Assistant','Approvals2','Schedule','Artifacts']);
  await user.click(screen.getByRole('button', {name:'The App Stack'}));
  expect(screen.queryByRole('link',{name:'Staff'})).not.toBeInTheDocument();
  expect(screen.getAllByRole('link').map(a => a.getAttribute('href'))).toEqual(['/travel','/podcasts','/social','/ticker']);
  expect(screen.getByLabelText('Current page')).toHaveTextContent('/staff');
  await user.click(screen.getByRole('button',{name:'Settings'}));
  expect(screen.getAllByRole('link').map(a=>a.getAttribute('href'))).toEqual(['/connections','/knowledge','/skills','/usage','/backup','/insights','/settings']);
  await user.click(screen.getByRole('link',{name:'Knowledge'}));
  expect(screen.getByLabelText('Current page')).toHaveTextContent('/knowledge');
  expect(screen.getByRole('link',{name:'Knowledge'})).toHaveAttribute('aria-current','page');
});
it('reveals the bookmarked app group and hides uninstalled modules', () => {
  navigation('/travel',['today','travel','settings']);
  expect(screen.getByRole('button',{name:'The App Stack'})).toHaveAttribute('aria-expanded','true');
  expect(screen.getAllByRole('link')).toHaveLength(1);
  expect(screen.queryByRole('link',{name:'Ticker'})).not.toBeInTheDocument();
});
it('lets the keyboard open collapsed navigation', async () => {
  const expand=vi.fn();navigation('/staff',NAV_MODULES,true,expand);
  const user=userEvent.setup();await user.tab();await user.keyboard('{Enter}');
  expect(expand).toHaveBeenCalledOnce();expect(screen.queryAllByRole('link')).toHaveLength(0);
});
it('HI Assistant shows human tools without an AI orbit or an implied account', async () => {
  vi.spyOn(humanDirectory,'listContacts').mockResolvedValue([]);
  vi.spyOn(humanDelegation,'list').mockResolvedValue([]);
  render(<MemoryRouter initialEntries={['/human-assistant']}><Routes><Route path="human-assistant" element={<Staff humanOnly/>}/></Routes></MemoryRouter>);
  expect(await screen.findByText('No human assistant added yet.')).toBeInTheDocument();
  expect(screen.queryByRole('group',{name:'Org chart'})).not.toBeInTheDocument();
  await userEvent.setup().click(screen.getByRole('button',{name:'Add human assistant'}));
  expect(screen.getByLabelText('Email for delegations *')).toBeInTheDocument();
  expect(screen.queryByLabelText('Model')).not.toBeInTheDocument();
});
