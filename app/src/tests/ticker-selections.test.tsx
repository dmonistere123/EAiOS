import { describe, expect, it, afterEach } from 'vitest';
import { normalizeFeed, renderTicker, rememberFeed, readHistory, HISTORY_KEY, recentWeekend } from '../adapters/ticker';
import { DEFAULT_SELECTIONS, parseStockSymbols, parseTeams, saveSelections, loadSelections, marketSymbols } from '../state/tickerPreferences';
const now = Date.parse('2026-10-19T12:00:00Z');
const raw = (date = '2026-10-19', state = 'live') => ({ version: 1, date, generatedAt: `${date}T11:00:00Z`, state, stale: false, sources: {americanFootball: {complete: true}, baseball: {complete: true}}, sports: {secFootball: [],secBaseball: [],nfc: []} });
const game = { id: 1, date: '2026-10-17T19:00:00Z', home: {name:'Alabama Crimson Tide',abbreviation:'ALA'}, away: {name:'LSU Tigers',abbreviation:'LSU'}, status:'Finished',detail:'Final',score:'23 - 13' };
afterEach(() => localStorage.clear());
describe('Ticker selections and history', () => {
 it('uses actual dated weekend finals only when selected current coverage is confirmed empty', () => {
  const old = normalizeFeed({...raw('2026-10-17'),sports:{secFootball:[game],secBaseball:[],nfc:[]}});
  const today = normalizeFeed(raw());
  const prefs = {...DEFAULT_SELECTIONS, sports:['secFootball'], ncaaTeams:['Alabama']};
  const lines = renderTicker(today,prefs,[old],now).items.join(' ');
  expect(lines).toContain(`recent weekend ${recentWeekend(now).label}`);
  expect(lines).toContain('Alabama Crimson Tide 23 — LSU Tigers 13');
  expect(lines).toContain('2026-10-17 19:00 UTC');expect(lines).toContain('source 2026-10-17T11:00:00Z');
  expect(lines).not.toContain('2026-10-19 19:00');
  for(const state of ['partial','unavailable','stale']) expect(renderTicker({...today,state},prefs,[old],now).items.join(' ')).not.toContain('Alabama Crimson Tide 23');
  expect(renderTicker(today,{...prefs,weekend:false},[old],now).items.join(' ')).not.toContain('Alabama Crimson Tide 23');
  expect(renderTicker(today,{...prefs,ncaaTeams:['Georgia']},[old],now).items.join(' ')).not.toContain('Alabama Crimson Tide 23');
 });
 it('does not reuse an unfinished game, another weekend, or replace current games', () => {
  const old = normalizeFeed({...raw('2026-10-17'),sports:{secFootball:[{...game,status:'Scheduled',detail:'Scheduled'}],secBaseball:[],nfc:[]}});
  const prefs = {...DEFAULT_SELECTIONS,sports:['secFootball']};
  expect(renderTicker(normalizeFeed(raw()),prefs,[old],now).items.join(' ')).toContain('no observed results');
  const historic = normalizeFeed({...raw('2026-10-10'),sports:{secFootball:[{...game,date:'2026-10-10T19:00:00Z'}],secBaseball:[],nfc:[]}});
  expect(renderTicker(normalizeFeed(raw()),prefs,[historic],now).items.join(' ')).not.toContain('Alabama Crimson Tide 23');
  const today = normalizeFeed({...raw(),sports:{secFootball:[{...game,date:'2026-10-19T10:00:00Z'}],secBaseball:[],nfc:[]}});
  expect(renderTicker(today,prefs,[old],now).items.join(' ')).not.toContain('historical results');
  expect(recentWeekend(Date.parse('2026-10-18T10:00:00Z')).label).toContain('2026-10-16–2026-10-18');
 });
 it('preserves successful observations through an outage and rejects corrupt history', () => {
  const source = normalizeFeed({...raw(), sports:{secFootball:[game],secBaseball:[],nfc:[]}});
  rememberFeed(source,now); rememberFeed(normalizeFeed(raw('2026-10-19','unavailable')),now);
  expect(readHistory(now)).toHaveLength(1);
  expect(readHistory(now+15*86400000)).toHaveLength(0);
  localStorage.setItem(HISTORY_KEY,JSON.stringify([{version:1,state:'live',generatedAt:'2026-10-19T11:00:00Z',sports:{secFootball:[null]}}]));
  expect(() => renderTicker(source,DEFAULT_SELECTIONS,readHistory(now),now)).not.toThrow();
 });
 it('filters selected sports, teams, and unsupported selections honestly', () => {
  const today = normalizeFeed({...raw(),sports:{secFootball:[{...game,date:'2026-10-19T10:00:00Z'}],secBaseball:[],nfc:[]}});
  const prefs={...DEFAULT_SELECTIONS,sports:['secFootball','ACC'],ncaaTeams:['LSU'],indexes:['S&P 500'],stocks:['NASDAQ:AAPL'],bitcoin:true};
  const line=renderTicker(today,prefs,[],now).items.join(' ');
  expect(line).toContain('Alabama Crimson Tide');expect(line).not.toContain('SEC baseball');
  expect(line).toContain('ACC • saved preference; coverage unavailable');expect(line).toContain('exact cash index unavailable');
  saveSelections(prefs);expect(loadSelections()).toEqual(prefs);expect(marketSymbols(loadSelections())).toEqual(['NASDAQ:AAPL','BITSTAMP:BTCUSD']);
 });
 it('validates and bounds user-entered symbols and teams', () => {
  expect(parseStockSymbols(' nasdaq:aapl, NASDAQ:AAPL,NYSE:IBM')).toEqual(['NASDAQ:AAPL','NYSE:IBM']);
  for(const s of ['<script>','https://evil.example','OANDA:SPX500USD','AAPL','NASDAQ:A;DROP','NASDAQ:'+ 'A'.repeat(20)])expect(()=>parseStockSymbols(s)).toThrow();
  expect(()=>parseStockSymbols(Array.from({length:9},(_,i)=>'NYSE:A'+i).join(','))).toThrow();
  expect(parseTeams('Alabama, LSU')).toEqual(['Alabama','LSU']);expect(()=>parseTeams('<iframe>')).toThrow();
 });
});

it('persists server history as reloadable observations', () => {
 const historic={...raw('2026-10-17'),sports:{secFootball:[game],secBaseball:[],nfc:[]}};
 const source=normalizeFeed({...raw(),history:{complete:true,days:[historic]}});
 rememberFeed(source,now);
 const stored=readHistory(now);
 expect(stored).toHaveLength(2);
 expect(renderTicker(normalizeFeed(raw()),{...DEFAULT_SELECTIONS,sports:['secFootball']},stored,now).scores).toHaveLength(1);
});
