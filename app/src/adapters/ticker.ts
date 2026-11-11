import { DEFAULT_SELECTIONS, SPORTS, marketSymbols } from '../state/tickerPreferences';
import type { TickerSelections } from '../state/tickerPreferences';
export const TICKER_PREFS_KEY = 'eaios.ticker.v1';
export function loadTickerPrefs(): { hidden: boolean; paused: boolean } {
  try { const p = JSON.parse(localStorage.getItem(TICKER_PREFS_KEY) ?? '{}'); return { hidden: p.hidden === true, paused: p.paused === true }; } catch { return { hidden: false, paused: false }; }
}
export const TICKER_DASHBOARD = 'https://allygnment.com/ticker/';
export const HISTORY_KEY = 'eaios.ticker.observed-history.v1';
const DAY = 86400000;
type Team = { name: string; abbreviation: string };
export type TickerGame = { id: string; date: string; home: Team; away: Team; status: string; detail: string; score: string };
export type SportsFeed = { version: 1; state: string; stale: boolean; generatedAt: string; date: string; sports: Record<string, TickerGame[]>; complete: Record<string, boolean>; history?: SportsFeed[]; historyComplete?: boolean };
export type TickerScore = { label: string; game: TickerGame; historical: boolean; sourceTimestamp: string; sourceState: string };
export type TickerSnapshot = { items: string[]; timestamp: string | null; stale: boolean; scores: TickerScore[]; notices: string[]; state: string; diagnostics: { sourceDate: string; received: Record<string, number>; historyDates: string[]; historyGames: number; timezone: string } };
const text = (v: unknown, fallback = '') => typeof v === 'string' && v.trim() ? v.slice(0, 160) : fallback;
const obj = (v: unknown): Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {};
export function normalizeFeed(data: unknown, includeHistory = true): SportsFeed {
  const d = obj(data), raw = obj(d.sports);
  if (d.version !== 1 || !d.sports || !['live', 'no_games', 'partial', 'stale', 'unavailable'].includes(String(d.state))) throw new Error('Invalid ticker response');
  const sports: SportsFeed['sports'] = {}, complete: SportsFeed['complete'] = {};
  for (const group of SPORTS) {
    const games = raw[group.id];
    sports[group.id] = Array.isArray(games) ? games.map(value => {
      const g = obj(value), home = obj(g.home), away = obj(g.away);
      return { id: String(g.id ?? '').slice(0, 80), date: text(g.date), home: { name: text(home.name, 'Home'), abbreviation: text(home.abbreviation) }, away: { name: text(away.name, 'Away'), abbreviation: text(away.abbreviation) }, status: text(g.status), detail: text(g.detail), score: text(g.score) };
    }) : [];
    complete[group.id] = Array.isArray(games) && obj(obj(d.sources)[group.source]).complete === true;
  }
  return { version: 1, state: d.state === 'no_games' ? 'live' : String(d.state), stale: d.stale === true, generatedAt: text(d.generatedAt), date: text(d.date), sports, complete, ...(includeHistory && d.history ? { historyComplete: obj(d.history).complete === true, history: (Array.isArray(obj(d.history).days) ? obj(d.history).days as unknown[] : []).slice(0, 7).flatMap(value => { try { return [normalizeFeed(value, false)]; } catch { return []; } }) } : {}) };
}
export function readHistory(now = Date.now()): SportsFeed[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY) ?? '[]';
    if (raw.length > 512000) return [];
    const values: unknown = JSON.parse(raw);
    if (!Array.isArray(values)) return [];
    return values.slice(-32).flatMap(value => {
      try {
        const original = obj(value);
        const feed = normalizeFeed(original);
        for (const group of SPORTS) feed.complete[group.id] = obj(original.complete)[group.id] === true;
        const time = Date.parse(feed.generatedAt);
        return Number.isFinite(time) && now - time <= 14 * DAY && time <= now + 60_000 ? [feed] : [];
      } catch { return []; }
    });
  } catch { return []; }
}
export function rememberFeed(feed: SportsFeed, now = Date.now()): SportsFeed[] {
  const old = readHistory(now);
  // Retain successful observations only. Failures cannot erase earlier results.
  const time = Date.parse(feed.generatedAt);
  if (!['live', 'partial'].includes(feed.state) || feed.stale || !Number.isFinite(time) || now - time > 2 * 3600000 || time > now + 60000) return old;
  // Store server days as ordinary snapshots so weekend observations survive reloads.
  const snapshots = [...old, ...(feed.history ?? []), feed].flatMap(source => {
    if (!['live', 'partial'].includes(source.state) || source.stale) return [];
    const { history: _history, historyComplete: _complete, ...snapshot } = source;
    return [snapshot];
  });
  const unique = new Map<string, SportsFeed>();
  for (const source of snapshots) unique.set(`${source.date}:${JSON.stringify(source.sports)}`, source);
  const history = [...unique.values()].sort((a,b) => Date.parse(a.generatedAt) - Date.parse(b.generatedAt)).slice(-32);
  while (JSON.stringify(history).length > 512000 && history.length > 1) history.shift();
  try { localStorage.setItem(HISTORY_KEY, JSON.stringify(history)); } catch { /* current response still works without persistence */ }
  return history;
}
export function localDateKey(value: number | string) {
  const d = new Date(value);
  if (!Number.isFinite(d.valueOf())) return '';
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
export function recentWeekend(now: number) {
  const date = new Date(now); date.setHours(0,0,0,0);
  const sunday = new Date(date); sunday.setDate(sunday.getDate() - (sunday.getDay() || 7));
  if (date.getDay() === 0 || date.getDay() === 6) sunday.setDate(sunday.getDate() + 7);
  const friday = new Date(sunday); friday.setDate(friday.getDate() - 2);
  const monday = new Date(sunday); monday.setDate(monday.getDate() + 1);
  return { start: friday.valueOf(), end: monday.valueOf(), label: `${localDateKey(friday.valueOf())}–${localDateKey(sunday.valueOf())} (${Intl.DateTimeFormat().resolvedOptions().timeZone})` };
}
const normalized = (s: string) => s.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
function matches(game: TickerGame, filters: string[]) {
  return !filters.length || filters.some(filter => [game.home, game.away].some(team => {
    const value = normalized(filter), name = normalized(team.name);
    return name === value || name.startsWith(value + ' ') || normalized(team.abbreviation) === value;
  }));
}
function gameLine(label: string, game: TickerGame) {
  const score = game.score.match(/^(\d+)\s*-\s*(\d+)$/);
  const date = Date.parse(game.date);
  return `${label} • ${game.home.name} ${score?.[1] ?? '–'} — ${game.away.name} ${score?.[2] ?? '–'} • ${game.detail || game.status || 'Status unavailable'} • ${Number.isFinite(date) ? new Date(date).toISOString().replace('T', ' ').slice(0, 16) + ' UTC' : 'time unavailable'}`;
}
export function renderTicker(feed: SportsFeed, prefs: TickerSelections = DEFAULT_SELECTIONS, history: SportsFeed[] = [], now = Date.now()): TickerSnapshot {
  const time = Date.parse(feed.generatedAt), today = localDateKey(now);
  const stale = feed.stale || feed.state === 'stale' || !Number.isFinite(time) || now - time > 2 * 3600000 || time > now + 60000;
  const items = [feed.state === 'unavailable' ? 'Sports unavailable' : stale ? 'Sports • stale source data' : feed.state === 'partial' ? 'Sports • partial coverage' : 'Sports • Highlightly'];
  const scores: TickerScore[] = [];
  const scoreLines = new Set<string>();
  const seenScores = new Set<string>();
  function addScore(label: string, game: TickerGame, source: SportsFeed, historical = false) {
    const key = `${label}:${game.id || `${game.date}:${game.home.name}:${game.away.name}`}`;
    if (seenScores.has(key)) return;
    seenScores.add(key);
    scores.push({ label, game, historical, sourceTimestamp: source.generatedAt, sourceState: source.state });
    const line = gameLine(label, game) + (historical ? ` • source ${source.generatedAt}${source.stale || source.state !== 'live' ? ' • source coverage partial/stale' : ''}` : '');
    scoreLines.add(line); items.push(line);
  }
  const weekend = recentWeekend(now);
  const allHistory = [...history, ...(feed.history ?? [])];
  if (prefs.weekend && feed.historyComplete === false) items.push('Recent weekend source coverage is incomplete; displayed games may be missing');
  for (const group of SPORTS.filter(s => prefs.sports.includes(s.id))) {
    const filters = group.id === 'nfc' ? prefs.nflTeams : prefs.ncaaTeams;
    // A current game for one followed team must not suppress another team's weekend results.
    for (const selection of filters.length ? filters.map(team => [team]) : [[]]) {
      const games = feed.sports[group.id].filter(g => matches(g, selection));
      const current = [feed, ...(feed.history ?? [])].flatMap(source => source.sports[group.id].filter(g => matches(g, selection) && localDateKey(g.date) === today).map(game => ({game, source})));
      if (current.length) { current.forEach(({game, source}) => addScore(group.label, game, source)); continue; }
      const confirmed = !stale && feed.state === 'live' && feed.complete[group.id] && feed.date === new Date(now).toISOString().slice(0, 10);
      if (!confirmed) { items.push(`${group.label} • current coverage not confirmed`); games.forEach(g => addScore(group.label, g, feed)); continue; }
      const found = new Map<string, {game: TickerGame; source: SportsFeed}>();
      if (prefs.weekend) for (const source of [...allHistory, feed].sort((a,b) => Date.parse(a.generatedAt) - Date.parse(b.generatedAt))) {
        if (!['live', 'partial'].includes(source.state)) continue;
        for (const game of source.sports[group.id]) {
          const date = Date.parse(game.date);
          if (date >= weekend.start && date < weekend.end && matches(game, selection) && /^(finished|final|ended|completed)\b/i.test(game.status + ' ' + game.detail) && /^\d+\s*-\s*\d+$/.test(game.score)) found.set(game.id || `${game.date}:${game.home.name}:${game.away.name}`, { game, source });
        }
      }
      if (found.size) {
        items.push(`${group.label} • recent weekend ${weekend.label} • historical results; no matching local-day games in source response`);
        for (const {game, source} of found.values()) addScore(group.label, game, source, true);
      } else {
        items.push(`${group.label} • ${selection.length ? `${selection.join(', ')}: no matching teams returned; team coverage not confirmed` : 'no verified games in source window'}${prefs.weekend ? ` • recent weekend ${weekend.label} unavailable: no observed results in the supported source window` : ''}`);
      }
    }
  }
  if (!prefs.sports.length) items.push('Sports disabled in Ticker settings');
  for (const league of prefs.sports.filter(id => !SPORTS.some(s => s.id === id))) items.push(`${league} • saved preference; coverage unavailable`);
  if (prefs.ncaaTeams.length && !prefs.sports.some(s => s === 'secFootball' || s === 'secBaseball')) items.push(`NCAA team filters saved • enable a supported SEC feed to apply them`);
  const symbols = marketSymbols(prefs);
  items.push(symbols.length ? `Market watchlist • ${symbols.join(', ')} • quotes in Ticker page widget only` : 'Stock movers • official TradingView widget in standalone dashboard (delayed)');
  for (const index of prefs.indexes) items.push(`${index} • saved preference; exact cash index unavailable`);
  return { items, timestamp: Number.isFinite(time) ? new Date(time).toISOString() : null, stale, scores, state: feed.state, diagnostics: { sourceDate: feed.date, received: Object.fromEntries(SPORTS.map(s => [s.label, feed.sports[s.id].length])), historyDates: [...new Set(allHistory.map(f => f.date))].sort(), historyGames: new Set(allHistory.flatMap(f => SPORTS.flatMap(s => f.sports[s.id].map(g => `${s.id}:${g.id || `${g.date}:${g.home.name}:${g.away.name}`}`)))).size, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone }, notices: items.slice(1).filter(line => !scoreLines.has(line) && !line.startsWith('Market watchlist') && !line.startsWith('Stock movers')) };
}
export function parseTicker(data: unknown, now = Date.now()): TickerSnapshot { return renderTicker(normalizeFeed(data), DEFAULT_SELECTIONS, [], now); }
export async function fetchTickerData(signal: AbortSignal) {
  const response = await fetch('/ticker-api/sports', { signal, credentials: 'omit' });
  if (!response.ok) throw new Error('Ticker unavailable');
  return normalizeFeed(await response.json());
}
