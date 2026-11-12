import type { Agent } from '../domain/types';
import { BrainGlyph } from './BrainGlyph';

/** Identity comes from the actual profile; glyphs distinguish areas of work. */
export function StaffAvatar({ agent, hub = false }: { agent: Agent; hub?: boolean }) {
  if (hub) return <BrainGlyph className="staff-avatar-glyph" />;
  const role = `${agent.id} ${agent.role}`.toLowerCase();
  const glyph = /research|scout|search/.test(role) ? 'research'
    : /writ|quill|content/.test(role) ? 'writing'
    : /develop|\bdev\b|build|code/.test(role) ? 'code'
    : /analy|ledger|financ/.test(role) ? 'analysis'
    : /secur|sentinel|guard/.test(role) ? 'security'
    : /travel|concierge/.test(role) ? 'travel'
    : /social|reach|market/.test(role) ? 'outreach' : 'general';
  return <svg className="staff-avatar-glyph" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {glyph === 'research' ? <><circle cx="10" cy="10" r="6"/><path d="m15 15 6 6M10 6v8M6 10h8"/></>
      : glyph === 'writing' ? <><path d="m5 16 11-11 3 3-11 11-5 2 2-5ZM14 7l3 3M3 22h18"/></>
      : glyph === 'code' ? <><path d="m7 6-5 6 5 6m10-12 5 6-5 6m-3-15-4 18"/></>
      : glyph === 'analysis' ? <><path d="M3 3v18h18M7 17v-5m5 5V7m5 10V3"/></>
      : glyph === 'security' ? <><path d="m12 2 8 3v6c0 5-8 11-8 11S4 16 4 11V5l8-3Z"/><path d="m8 11 3 3 5-6"/></>
      : glyph === 'travel' ? <><circle cx="12" cy="12" r="10"/><path d="m16 8-3 5-5 3 3-5 5-3Z"/></>
      : glyph === 'outreach' ? <><path d="m3 9 14-6v18L3 15V9Zm4 8v4h4l-2-3M20 8l2-1m-2 9 2 1"/></>
      : <><rect x="4" y="6" width="16" height="14" rx="4"/><path d="M12 2v4M8 12h1m6 0h1M9 16h6"/></>}
  </svg>;
}
export function staffHub(agents: Agent[]): Agent | undefined {
  return agents.find(a => a.id === 'default') ?? agents.find(a => a.id === 'ally') ?? agents.find(a => !a.reportsToAgentId);
}
