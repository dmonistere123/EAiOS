import { useEffect, useState } from 'react';
export const SELECTIONS_KEY = 'eaios.ticker.selections.v1';
export const SPORTS = [
  { id: 'secFootball', label: 'SEC football', source: 'americanFootball' },
  { id: 'secBaseball', label: 'SEC baseball', source: 'baseball' },
  { id: 'nfc', label: 'NFL • NFC games', source: 'americanFootball' },
] as const;
export const UNAVAILABLE_LEAGUES = ['NCAA • all conferences', 'ACC', 'Big Ten', 'Big 12', 'NFL • all conferences', 'AFC', 'NBA', 'MLB'] as const;
export const CASH_INDEXES = ['S&P 500', 'Dow Jones Industrial Average', 'Nasdaq Composite'] as const;
export type TickerSelections = { sports: string[]; ncaaTeams: string[]; nflTeams: string[]; weekend: boolean; stocks: string[]; indexes: string[]; bitcoin: boolean };
export const DEFAULT_SELECTIONS: TickerSelections = { sports: SPORTS.map(s => s.id), ncaaTeams: [], nflTeams: [], weekend: true, stocks: [], indexes: [], bitcoin: false };
const unique = (values: string[]) => [...new Set(values)];
export function parseStockSymbols(value: string): string[] {
  const symbols = unique(value.split(',').map(s => s.trim().toUpperCase()).filter(Boolean));
  if (symbols.length > 8 || symbols.some(s => !/^(NASDAQ|NYSE|AMEX):[A-Z][A-Z0-9.-]{0,14}$/.test(s))) throw new Error('Use up to 8 exchange-qualified stock symbols, such as NASDAQ:AAPL or NYSE:IBM.');
  return symbols;
}
export function parseTeams(value: string): string[] {
  const teams = unique(value.split(',').map(s => s.trim()).filter(Boolean));
  if (teams.length > 10 || teams.some(s => s.length > 60 || !/^[\p{L}\p{N} .&'’-]+$/u.test(s))) throw new Error('Use up to 10 team names or abbreviations, separated by commas (60 characters each).');
  return teams;
}
export function normalizeSelections(input: unknown): TickerSelections {
  const p = (input && typeof input === 'object' ? input : {}) as Partial<TickerSelections>;
  const allowed = [...SPORTS.map(s => s.id), ...UNAVAILABLE_LEAGUES];
  const list = (v: unknown) => Array.isArray(v) ? v.filter((s): s is string => typeof s === 'string') : [];
  let stocks: string[] = [], ncaaTeams: string[] = [], nflTeams: string[] = [];
  try { stocks = parseStockSymbols(list(p.stocks).join(',')); } catch { /* invalid stored entries are not sent to a widget */ }
  try { ncaaTeams = parseTeams(list(p.ncaaTeams).join(',')); nflTeams = parseTeams(list(p.nflTeams).join(',')); } catch { /* invalid saved filters */ }
  return { sports: Array.isArray(p.sports) ? unique(list(p.sports).filter(s => allowed.includes(s as never))) : [...DEFAULT_SELECTIONS.sports], ncaaTeams, nflTeams, stocks, indexes: unique(list(p.indexes).filter(s => CASH_INDEXES.includes(s as never))), bitcoin: p.bitcoin === true, weekend: p.weekend !== false };
}
export function loadSelections(): TickerSelections {
  try { return normalizeSelections(JSON.parse(localStorage.getItem(SELECTIONS_KEY) ?? '{}')); } catch { return normalizeSelections({}); }
}
export function saveSelections(prefs: TickerSelections) {
  localStorage.setItem(SELECTIONS_KEY, JSON.stringify(normalizeSelections(prefs)));
  window.dispatchEvent(new Event('eaios-ticker-selections'));
}
export function useTickerSelections() {
  const [prefs, setPrefs] = useState(loadSelections);
  useEffect(() => {
    const update = () => setPrefs(loadSelections());
    window.addEventListener('storage', update); window.addEventListener('eaios-ticker-selections', update);
    return () => { window.removeEventListener('storage', update); window.removeEventListener('eaios-ticker-selections', update); };
  }, []);
  return prefs;
}
export function marketSymbols(prefs: TickerSelections) { return [...prefs.stocks, ...(prefs.bitcoin ? ['BITSTAMP:BTCUSD'] : [])]; }
