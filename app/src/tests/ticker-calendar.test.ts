// @vitest-environment node
import { afterAll, describe, expect, it } from 'vitest';
import { localDateKey, recentWeekend, normalizeFeed, renderTicker } from '../adapters/ticker';
import actualFeed from './fixtures/ticker-weekend.json';
import { DEFAULT_SELECTIONS } from '../state/tickerPreferences';
const previousTZ = process.env.TZ;
process.env.TZ = 'America/Chicago';
afterAll(() => { if (previousTZ === undefined) delete process.env.TZ; else process.env.TZ = previousTZ; });
const now = Date.parse('2026-10-19T12:00:00Z');
const game = (id: string, date: string, home: string, away = 'Opponent') => ({id, date,home:{name:home},away:{name:away},status:'Finished',detail:'Final',score:'23 - 13'});
const feed = (games: unknown[]) => normalizeFeed({version:1,date:'2026-10-19',generatedAt:'2026-10-19T11:00:00Z',state:'live',stale:false,sources:{americanFootball:{complete:true},baseball:{complete:true}},sports:{secFootball:[],secBaseball:[],nfc:games}});
describe('local calendar and multiple followed teams', () => {
 it('classifies Monday UTC kickoff as Sunday locally and includes it in the completed weekend', () => {
  expect(localDateKey('2026-10-19T00:20:00Z')).toBe('2026-10-18');
  const result=renderTicker(feed([game('1','2026-10-19T00:20:00Z','Packers')]),{...DEFAULT_SELECTIONS,sports:['nfc']},[],now);
  expect(result.scores).toHaveLength(1);expect(result.scores[0].historical).toBe(true);
 });
 it('keeps another followed team weekend result when one team plays today and deduplicates both sides', () => {
  const current=feed([game('1','2026-10-19T18:00:00Z','Bears','Lions')]);
  const old=feed([game('2','2026-10-18T18:00:00Z','Packers')]);
  const result=renderTicker(current,{...DEFAULT_SELECTIONS,sports:['nfc'],nflTeams:['Bears','Lions','Packers']},[old],now);
  expect(result.scores.map(s=>s.game.id)).toEqual(['1','2']);
  expect(result.scores.map(s=>s.historical)).toEqual([false,true]);
 });
 it('does not truncate a supported response to forty games', () => {
  const result=renderTicker(feed(Array.from({length:45},(_,i)=>game(String(i),'2026-10-19T18:00:00Z','Team '+i))),{...DEFAULT_SELECTIONS,sports:['nfc']},[],now);
  expect(result.scores).toHaveLength(45);
 });
 it('uses calendar midnight boundaries across daylight saving changes', () => {
  const weekend=recentWeekend(Date.parse('2026-11-02T12:00:00Z'));
  expect(new Date(weekend.start).toISOString()).toBe('2026-10-30T05:00:00.000Z');
  expect(new Date(weekend.end).toISOString()).toBe('2026-11-02T06:00:00.000Z');
 });
});

it('renders all fourteen actual server weekend games without browser history', () => {
 const normalized=normalizeFeed(actualFeed);
 const result=renderTicker(normalized,{...DEFAULT_SELECTIONS,sports:['secFootball','secBaseball','nfc']},[],now);
 expect(normalized.history).toHaveLength(3);
 expect(result.scores).toHaveLength(14);
 expect(result.scores.every(score=>score.historical)).toBe(true);
 expect(result.scores.filter(score=>score.label==='NFL • NFC games')).toHaveLength(6);
 expect(result.items.join(' ')).toContain('Green Bay Packers 23');
 expect(result.items.join(' ')).toContain('LSU Tigers 31');
 expect(result.notices.join(' ')).toContain('no verified games');
});
it('accepts an honestly empty source and labels incomplete server history', () => {
 const normalized=normalizeFeed({...actualFeed,state:'no_games',history:{...actualFeed.history,complete:false}});
 expect(normalized.state).toBe('live');
 expect(renderTicker(normalized,DEFAULT_SELECTIONS,[],now).items.join(' ')).toContain('coverage is incomplete');
});
