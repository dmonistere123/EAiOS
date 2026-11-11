import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Card, SectionTitle } from './ui';
import { CASH_INDEXES, SPORTS, UNAVAILABLE_LEAGUES, loadSelections, parseStockSymbols, parseTeams, saveSelections } from '../state/tickerPreferences';
export function TickerSettings() {
  const [draft, setDraft] = useState(loadSelections);
  const [ncaa, setNcaa] = useState(() => draft.ncaaTeams.join(', '));
  const [nfl, setNfl] = useState(() => draft.nflTeams.join(', '));
  const [stocks, setStocks] = useState(() => draft.stocks.join(', '));
  const [status, setStatus] = useState('');
  const toggle = (key: 'sports' | 'indexes', value: string) => { setDraft(p => ({ ...p, [key]: p[key].includes(value) ? p[key].filter(s => s !== value) : [...p[key], value] })); setStatus(''); };
  function save(e: React.FormEvent) {
    e.preventDefault();
    try {
      const next = { ...draft, ncaaTeams: parseTeams(ncaa), nflTeams: parseTeams(nfl), stocks: parseStockSymbols(stocks) };
      saveSelections(next); setDraft(next); setStocks(next.stocks.join(', ')); setStatus('Ticker preferences saved in this browser.');
    } catch (error) { setStatus(error instanceof Error ? error.message : 'Unable to save preferences in this browser.'); }
  }
  const input = 'mt-1 w-full rounded-lg border border-edge bg-canvas px-3 py-2 text-sm text-ink';
  return <section id="ticker-settings"><Card className="p-5">
    <SectionTitle>Ticker</SectionTitle>
    <form onSubmit={save} className="space-y-5 text-sm">
      <p className="text-ink-dim">Choose what appears in your ticker. Sports filter the public feed; market quotes stay in the official widget on your <Link className="text-signal" to="/ticker">Ticker page</Link>. Preferences are local to this browser.</p>
      <fieldset className="space-y-2"><legend className="mb-2 font-medium">Connected sports coverage</legend>
        {SPORTS.map(s => <label key={s.id} className="mr-5 inline-flex items-center gap-2"><input type="checkbox" checked={draft.sports.includes(s.id)} onChange={() => toggle('sports', s.id)} />{s.label}</label>)}
        <p className="text-xs text-ink-dim">Current provider coverage only; selecting a team does not expand the source’s coverage.</p>
      </fieldset>
      <div className="grid gap-4 xl:grid-cols-2">
        <label>NCAA teams<input aria-label="NCAA teams" className={input} value={ncaa} maxLength={610} onChange={e => { setNcaa(e.target.value); setStatus(''); }} placeholder="Alabama, LSU" /><span className="mt-1 block text-xs text-ink-dim">Optional comma-separated names or abbreviations. Filters selected SEC feeds. Blank follows all returned teams; other NCAA teams remain unavailable unless returned.</span></label>
        <label>NFL teams<input aria-label="NFL teams" className={input} value={nfl} maxLength={610} onChange={e => { setNfl(e.target.value); setStatus(''); }} placeholder="Green Bay Packers, DAL" /><span className="mt-1 block text-xs text-ink-dim">Filters NFC games returned by the source, including their opponents.</span></label>
      </div>
      <fieldset className="space-y-2"><legend className="mb-2 font-medium">Other leagues — saved preferences, not connected</legend>
        <div className="flex flex-wrap gap-x-5 gap-y-2">{UNAVAILABLE_LEAGUES.map(s => <label key={s} className="inline-flex items-center gap-2"><input type="checkbox" checked={draft.sports.includes(s)} onChange={() => toggle('sports', s)} />{s}</label>)}</div>
        <p className="text-xs text-warn">These leagues are outside the current feed. Selecting them saves your interest and displays an unavailable status.</p>
      </fieldset>
      <div><label className="flex items-center gap-2"><input type="checkbox" checked={draft.weekend} onChange={e => { setDraft(p => ({...p, weekend: e.target.checked})); setStatus(''); }} />Show recent-weekend results when no matching games are returned today</label>
        <p className="mt-2 text-xs text-ink-dim">Uses dated final results from the server’s completed Friday–Sunday window in America/Chicago, plus results observed in this browser. Game dates display in your local timezone. Browser observations are stored for up to 14 days. Partial or stale current coverage is never treated as a confirmed empty day.</p></div>
      <label className="block">Stock symbols<input aria-label="Stock symbols" className={input} value={stocks} maxLength={200} onChange={e => { setStocks(e.target.value); setStatus(''); }} placeholder="NASDAQ:AAPL, NYSE:IBM" /><span className="mt-1 block text-xs text-ink-dim">Up to 8 NASDAQ, NYSE or AMEX exchange-qualified symbols. Availability and delay are determined by TradingView; an accepted symbol is not a guarantee of a quote. Quotes appear on the Ticker page, not in the scrolling strip.</span></label>
      <label className="flex items-center gap-2"><input type="checkbox" checked={draft.bitcoin} onChange={e => { setDraft(p => ({...p, bitcoin: e.target.checked})); setStatus(''); }} />Bitcoin / USD — Bitstamp via TradingView widget</label>
      <fieldset className="space-y-2"><legend className="mb-2 font-medium">Cash indexes — latest completed trading day close</legend>
        <div className="flex flex-wrap gap-x-5 gap-y-2">{CASH_INDEXES.map(s => <label key={s} className="inline-flex items-center gap-2"><input type="checkbox" checked={draft.indexes.includes(s)} onChange={() => toggle('indexes', s)} />{s}</label>)}</div>
        <p className="text-xs text-warn">Saved preferences only: an exact, licensed closing-value source is not connected. No ETFs or CFDs are substituted. Future values must carry the actual trading date, including holiday/weekend gaps.</p>
      </fieldset>
      <div className="flex flex-wrap items-center gap-4"><button type="submit" className="rounded-lg bg-signal px-4 py-2 font-semibold text-canvas">Save ticker preferences</button><Link className="text-signal" to="/ticker">Open Ticker</Link><p role="status" className="text-xs text-ink-dim">{status}</p></div>
    </form>
  </Card></section>;
}
