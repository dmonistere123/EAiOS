import { Link } from 'react-router-dom';
import { MarketMovers } from '../components/MarketMovers';
import { MarketQuote } from '../components/MarketQuote';
import { TICKER_DASHBOARD } from '../adapters/ticker';
import { useTickerFeed } from '../state/useTickerFeed';
import { SPORTS, marketSymbols } from '../state/tickerPreferences';
import { tickerDate } from '../state/tickerPresentation';
export default function Ticker() {
  const { prefs, snapshot, failed } = useTickerFeed();
  const symbols = marketSymbols(prefs);
  const unsupported = prefs.sports.filter(id => !SPORTS.some(s => s.id === id));
  const noScores = SPORTS.filter(s => prefs.sports.includes(s.id) && !snapshot?.scores.some(score => score.label === s.label));
  const coverage = [noScores.length ? `${noScores.length} sports feeds without verified scores` : '', unsupported.length ? `${unsupported.length} leagues not connected` : '', prefs.indexes.length ? `${prefs.indexes.length} cash indexes unavailable` : ''].filter(Boolean);
  return <div className="eaios-ticker-page space-y-5">
    <header className="flex flex-wrap items-start justify-between gap-4"><div><h1 className="text-2xl font-semibold">Ticker</h1><p className="mt-1 text-sm text-ink-dim">Your scores and market watchlist.</p></div><div className="flex flex-wrap gap-4 text-sm text-signal"><Link to="/settings#ticker-settings">Ticker settings</Link><a href={TICKER_DASHBOARD} target="_blank" rel="noopener noreferrer">Standalone dashboard ↗</a></div></header>
    <div className="eaios-ticker-columns">
    <section aria-label="Sports scores" className="min-w-0 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="text-sm font-semibold">Latest scores</h2><span className="text-xs text-ink-dim" title={snapshot?.timestamp ?? undefined}>Source updated {tickerDate(snapshot?.timestamp ?? null)}</span></div>
      {(failed || snapshot?.stale || snapshot?.state === 'unavailable' || snapshot?.state === 'partial') && <p role="status" className="rounded-lg border border-warn/30 bg-warn/5 px-3 py-2 text-sm text-warn">{failed || snapshot?.state === 'unavailable' ? 'Sports feed unavailable. Retrying automatically; any displayed results are previously received.' : snapshot?.stale ? 'Sports source is stale. Displayed results may be out of date.' : 'Sports coverage is partial. Some selected games may be missing.'}</p>}
      <div className="grid gap-3">
        {snapshot?.scores.map(({game, label, historical, sourceTimestamp, sourceState},i) => {
          const pair = game.score.match(/^(\d+)\s*-\s*(\d+)$/);
          return <article key={`${label}:${game.id}:${i}`} className="rounded-xl border border-edge bg-canvas-raised p-5">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-xs"><span className="text-signal">{label}</span><span className="rounded bg-canvas-overlay px-2 py-1 text-ink-dim">{game.detail || game.status || 'Status unavailable'}</span></div>
            <div className="space-y-2 text-sm"><div className="flex items-center justify-between gap-4"><span>{game.home.name}</span><strong className="text-xl tabular-nums">{pair?.[1] ?? '–'}</strong></div><div className="flex items-center justify-between gap-4"><span>{game.away.name}</span><strong className="text-xl tabular-nums">{pair?.[2] ?? '–'}</strong></div></div>
            <p className="mt-3 text-xs text-ink-dim"><time dateTime={game.date}>{tickerDate(game.date)}</time>{historical && ' • Recent weekend · historical result'}</p>
            {historical && <p className="mt-1 text-xs text-ink-dim">Observed {tickerDate(sourceTimestamp)}{sourceState !== 'live' && ' • partial/stale source coverage'}</p>}
          </article>;
        })}
      </div>
      {!snapshot?.scores.length && <p className="rounded-xl border border-edge bg-canvas-raised p-5 text-sm text-ink-dim">{!snapshot && !failed ? 'Loading sports…' : 'No verified scores are available for your selections. See coverage details below.'}</p>}
    </section>
    <div className="eaios-ticker-markets min-w-0 space-y-4"><MarketMovers />
    <section aria-label="Market watchlist" className="min-w-0 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="text-sm font-semibold">Market watchlist</h2><Link className="text-xs text-signal" to="/settings#ticker-settings">Manage stocks &amp; Bitcoin</Link></div>
      {symbols.length ? <>
        <div className="grid gap-3" style={{gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 280px), 1fr))'}}>
          {symbols.map(symbol => <div key={symbol} className="min-w-0 rounded-xl border border-edge bg-canvas-raised p-4">
            <h3 className="mb-2 text-xs font-medium text-ink-dim">{symbol === 'BITSTAMP:BTCUSD' ? 'Bitcoin / USD · Cryptocurrency' : `${symbol} · Stock`}</h3>
            <MarketQuote symbol={symbol} />
          </div>)}
        </div>
        <p className="text-xs text-ink-dim">Official TradingView quotes. Availability, timestamp and delay are shown by each widget. Blank or unavailable widgets do not confirm a price.</p>
      </> : <p className="rounded-lg border border-edge px-4 py-3 text-sm text-ink-dim">No stocks or Bitcoin selected. <Link className="text-signal" to="/settings#ticker-settings">Choose your markets</Link> to show quotes here.</p>}
    </section>
    </div></div>
    {snapshot && (coverage.length > 0 || snapshot.notices.length > 0) && <details className="rounded-lg border border-edge bg-canvas-raised px-4 py-3">
      <summary className="cursor-pointer text-sm text-ink-dim"><span className="font-medium text-warn">Coverage details</span> — {coverage.join(' · ') || 'Source and selection notes'}</summary>
      <div className="mt-3 space-y-2 text-xs text-ink-dim">
        {noScores.length > 0 && <p><strong>No verified scores:</strong> {noScores.map(s => s.label).join(', ')}. Empty results do not establish coverage for every selected team.</p>}
        {unsupported.length > 0 && <p><strong>Not connected:</strong> {unsupported.join(', ')}. Preferences are saved; those leagues are outside the current source.</p>}
        {prefs.indexes.length > 0 && <p><strong>Exact cash-index closes unavailable:</strong> {prefs.indexes.join(', ')}. Awaiting a licensed source for the latest completed trading day; no ETFs or CFDs substituted.</p>}
        {prefs.weekend && <p>Recent-weekend fallback uses cached server results for the most recent completed Friday–Sunday in America/Chicago, plus previously observed browser results. Dates display in your local timezone. Coverage remains limited to SEC football, SEC baseball and games involving NFC teams.</p>}
        <details><summary className="cursor-pointer text-signal">Detailed source notices ({snapshot.notices.length})</summary><ul className="mt-2 list-disc space-y-2 pl-4">{snapshot.notices.map((line,i) => <li key={i}>{line}</li>)}</ul></details>
        <details><summary className="cursor-pointer text-signal">Why these results?</summary><div className="mt-2 space-y-1" data-testid="ticker-source-audit">
          <p>Source date: {snapshot.diagnostics.sourceDate || 'unavailable'} (UTC source window). Display calendar: {snapshot.diagnostics.timezone}.</p>
          <p>Games received before local filtering: {Object.entries(snapshot.diagnostics.received).map(([name,count]) => `${name}: ${count}`).join(' · ')}.</p>
          <p>Available server/browser history: {snapshot.diagnostics.historyGames} distinct games; source dates {snapshot.diagnostics.historyDates.join(', ') || 'none'}. This covers the supported source window, not every league or historical date.</p>
        </div></details>
        <Link className="inline-block text-signal" to="/settings#ticker-settings">Manage followed teams and markets</Link>
      </div>
    </details>}

  </div>;
}
