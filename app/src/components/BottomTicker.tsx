import { useEffect, useState } from 'react';
import { TICKER_PREFS_KEY, loadTickerPrefs } from '../adapters/ticker';
import { Link } from 'react-router-dom';
import { tickerDate, tickerStrip } from '../state/tickerPresentation';
import { useTickerFeed } from '../state/useTickerFeed';
export function BottomTicker({ hidden, onHidden }: { hidden: boolean; onHidden: (value: boolean) => void }) {
  const [paused, setPaused] = useState(() => loadTickerPrefs().paused);
  const { snapshot, failed } = useTickerFeed(!hidden);
  useEffect(() => { try { localStorage.setItem(TICKER_PREFS_KEY, JSON.stringify({ hidden, paused })); } catch { /* Storage may be disabled. */ } }, [hidden, paused]);
  if (hidden) return <footer className="eaios-ticker is-hidden"><button onClick={() => onHidden(false)}>Show ticker</button></footer>;
  const items = failed ? ['Sports unavailable • retrying automatically', ...(snapshot ? ['Last received data • stale', ...tickerStrip(snapshot)] : [])] : (snapshot ? tickerStrip(snapshot) : ['Loading sports…']);
  const updated = snapshot?.timestamp ? `Source ${tickerDate(snapshot.timestamp, true)}${failed || snapshot.stale ? ' • stale' : ''}` : 'Source time unavailable';
  return <footer className="eaios-ticker" aria-label="Sports and markets ticker">
    <Link to="/ticker" title="Open your ticker dashboard">Ticker ↗</Link>
    <div className={`eaios-ticker-viewport ${paused ? 'is-paused' : ''}`} tabIndex={0} aria-label="Ticker headlines. Scroll horizontally when paused; focus pauses movement.">
      <div className="eaios-ticker-track" style={{ animationDuration: `${Math.max(45, items.join('').length / 5)}s` }}>
        {[0, 1].map(copy => <div className="eaios-ticker-group" key={copy} aria-hidden={copy === 1 ? true : undefined}>
          <span className="text-ink-dim">{updated}</span>{items.map((item, i) => <span key={i}>{item}</span>)}
        </div>)}
      </div>
    </div>
    <button aria-pressed={paused} onClick={() => setPaused(p => !p)}>{paused ? 'Resume' : 'Pause'}</button>
    <button onClick={() => onHidden(true)} aria-label="Hide ticker">Hide</button>
  </footer>;
}
