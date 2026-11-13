import { useEffect, useRef, useState } from 'react';
// Official iframe widget. Its data is never read, scraped, or copied into our ticker.
export function MarketQuote({ symbol }: { symbol: string }) {
  const host = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);
  const [expanded, setExpanded] = useState(symbol === 'BITSTAMP:BTCUSD');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const root = host.current;
    if (!root || !expanded) return;
    setFailed(false);
    const container = document.createElement('div'); container.className = 'tradingview-widget-container';
    const widget = document.createElement('div'); widget.className = 'tradingview-widget-container__widget'; container.append(widget);
    const script = document.createElement('script'); script.src = 'https://s3.tradingview.com/external-embedding/embed-widget-single-quote.js'; script.async = true;
    script.textContent = JSON.stringify({ symbol, width: '100%', isTransparent: true, colorTheme: 'dark', locale: 'en' });
    script.onerror = () => setFailed(true); container.append(script); root.append(container);
    return () => { script.onerror = null; container.remove(); };
  }, [symbol, expanded, attempt]);
  return <div className="min-w-0">
    <div className="mb-2 flex flex-wrap gap-3 text-sm">
      <button type="button" className="text-signal" aria-expanded={expanded} onClick={() => setExpanded(value => !value)}>{expanded ? `Hide ${symbol} widget` : `Show ${symbol} widget`}</button>
      {expanded && <button type="button" className="text-signal" onClick={() => setAttempt(value => value + 1)}>Retry {symbol}</button>}
    </div>
    <p role="status" className="mb-2 text-xs text-ink-dim">Embedded quote may be unavailable. If blank, retry or open TradingView; 2EP cannot confirm a price.</p>
    <div ref={host} className={!expanded || failed ? 'hidden' : 'min-h-20'} aria-label={`TradingView quote for ${symbol}`} />
    {failed && <p className="text-sm text-warn">Market widget could not load. No quote is available here.</p>}
    <a className="text-xs text-signal" href={`https://www.tradingview.com/symbols/${symbol.replace(':', '-')}/`} target="_blank" rel="noopener noreferrer">Track {symbol} on TradingView ↗</a>

  </div>;
}
