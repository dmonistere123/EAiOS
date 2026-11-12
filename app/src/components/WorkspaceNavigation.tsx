import { useEffect, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';

export const NAV_GROUPS = [
  { id: 'executive', label: 'EAiOS', icon: '◈', items: [
    { to: '/today', label: 'Today', icon: '☀', module: 'today' },
    { to: '/staff', label: 'Staff', icon: '⛁', module: 'staff' },
    { to: '/assistant', label: 'AI Assistant', icon: '◈', module: 'assistant' },
    { to: '/human-assistant', label: 'HI Assistant', icon: '♙', module: 'staff' },
    { to: '/approvals', label: 'Approvals', icon: '✓', module: 'approvals' },
    { to: '/schedule', label: 'Schedule', icon: '▦', module: 'schedule' },
    { to: '/artifacts', label: 'Artifacts', icon: '▤', module: 'artifacts' },
  ] },
  { id: 'apps', label: 'The App Stack', icon: '▧', items: [
    { to: '/travel', label: 'Travel', icon: '✈', module: 'travel' },
    { to: '/podcasts', label: 'Podcasts', icon: '❚❚', module: 'podcasts' },
    { to: '/social', label: 'Social Media', icon: '↗', module: 'social' },
    { to: '/ticker', label: 'Ticker', icon: '⌁', module: 'ticker' },
  ] },
  { id: 'settings', label: 'Settings', icon: '⚙', items: [
    { to: '/connections', label: 'Connections', icon: '⬡', module: 'connections' },
    { to: '/knowledge', label: 'Knowledge', icon: '❖', module: 'knowledge' },
    { to: '/skills', label: 'Skills & Playbooks', icon: '⚒', module: 'skills' },
    { to: '/usage', label: 'Usage', icon: '◔', module: 'usage' },
    { to: '/backup', label: 'Backup Settings', icon: '⛃', module: 'backup' },
    { to: '/insights', label: 'Executive Insights', icon: '◉', module: 'insights' },
    { to: '/settings', label: 'App Settings', icon: '⚙', module: 'settings' },
  ] },
] as const;
export const NAV_MODULES = [...new Set(NAV_GROUPS.flatMap(g => g.items.map(i => i.module)))];
const STORE_KEY = 'eaios.navigation.group.v1';

export function WorkspaceNavigation({ modules, collapsed, pending, onExpand, onNavigate }: {
  modules: string[] | null; collapsed: boolean; pending: number; onExpand: () => void; onNavigate?: () => void;
}) {
  const { pathname } = useLocation();
  const routeGroup = NAV_GROUPS.find(g => g.items.some(i => pathname === i.to || pathname.startsWith(i.to + '/')))?.id;
  const [choice, setChoice] = useState<{ path: string; group: string | null }>(() => {
    let saved: string | null = null;
    try { saved = localStorage.getItem(STORE_KEY); } catch { /* preferences are optional */ }
    return { path: pathname, group: routeGroup ?? (NAV_GROUPS.some(g => g.id === saved) ? saved : 'executive') };
  });
  // Opening a bookmarked page reveals its group; expanding a group never navigates.
  const expanded = choice.path === pathname ? choice.group : routeGroup ?? 'executive';
  useEffect(() => {
    try { localStorage.setItem(STORE_KEY, expanded ?? ''); } catch { /* private browsing */ }
  }, [expanded]);
  return <div className="workspace-groups">
    {NAV_GROUPS.map(group => {
      const items = group.items.filter(i => modules?.includes(i.module));
      if (!items.length) return null;
      const open = !collapsed && expanded === group.id;
      return <section key={group.id}>
        <button type="button" className="workspace-group-toggle" aria-label={group.label} title={group.label}
          aria-expanded={open} aria-controls={`workspace-group-${group.id}`}
          onClick={() => { if (collapsed) onExpand(); setChoice({ path: pathname, group: open ? null : group.id }); }}>
          <span aria-hidden className="workspace-group-symbol">{group.icon}</span>
          {!collapsed && <><span className="flex-1 text-left">{group.label}</span>
            {group.id === 'executive' && pending > 0 && <span className="workspace-count" aria-label={`${pending} pending approvals`}>{pending}</span>}
            <span aria-hidden>{open ? '⌄' : '›'}</span></>}
        </button>
        <div id={`workspace-group-${group.id}`} hidden={!open} className="workspace-group-links">
          {open && items.map(item => <NavLink key={item.to} to={item.to} title={item.label} onClick={onNavigate}
            className={({ isActive }) => `workspace-link${isActive ? ' is-active' : ''}`}>
            <span aria-hidden className="workspace-link-symbol">{item.icon}</span><span>{item.label}</span>
            {item.to === '/approvals' && pending > 0 && <span className="workspace-count ml-auto">{pending}</span>}
          </NavLink>)}
        </div>
      </section>;
    })}
  </div>;
}
