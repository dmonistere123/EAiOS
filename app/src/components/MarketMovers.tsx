import { useEffect, useRef, useState } from 'react';
// Same official US hotlists widget as the approved standalone dashboard.
export function MarketMovers() {
  const host = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);
  const [expanded, setExpanded] = useState(true);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const root = host.current;
    if (!root || !expanded) return;
    setFailed(false);
    const container = document.createElement('div');
    container.className = 'tradingview-widget-container';
    container.style.height = '100%';
    const widget = document.createElement('div');
    widget.className = 'tradingview-widget-container__widget';
    container.append(widget);
    const script = document.createElement('script');
    script.src = 'https://s3.tradingview.com/external-embedding/embed-widget-hotlists.js';
    script.async = true;
    script.textContent = JSON.stringify({colorTheme:'dark',dateRange:'1D',exchange:'US',showChart:true,locale:'en',isTransparent:false,showSymbolLogo:true,showFloatingTooltip:false,width:'100%',height:'100%'});
    script.onerror = () => setFailed(true);
    container.append(script); root.append(container);
    return () => { script.onerror = null; container.remove(); };
  }, [expanded, attempt]);
  return <section aria-label="US stock movers" className="min-w-0 rounded-xl border border-edge bg-canvas-raised p-4">
    <div className="mb-3 flex flex-wrap items-center justify-between gap-2"><h2 className="text-sm font-semibold">US stock movers</h2><span className="text-xs text-ink-dim">Delayed · TradingView</span></div>
    <div className="mb-3 flex flex-wrap gap-3 text-sm">
      <button type="button" className="text-signal" aria-expanded={expanded} onClick={() => setExpanded(value => !value)}>{expanded ? 'Hide movers widget' : 'Show movers widget'}</button>
      {expanded && <button type="button" className="text-signal" onClick={() => setAttempt(value => value + 1)}>Retry movers</button>}
      <a className="text-signal" href="https://www.tradingview.com/markets/stocks-usa/market-movers-active/" target="_blank" rel="noopener noreferrer">Open movers on TradingView ↗</a>
    </div>
    <p role="status" className="mb-3 text-xs text-ink-dim">Embedded quotes may be unavailable. 2EP cannot verify whether TradingView loaded prices. If the widget is blank, retry or open TradingView.</p>
    <div ref={host} className={!expanded || failed ? 'hidden' : 'h-[520px] min-w-0'} aria-label="TradingView Active, Gainers and Losers" />
    {failed && <p role="status" className="text-sm text-warn">Stock movers could not load. No market data is confirmed.</p>}
    <p className="mt-3 text-xs text-ink-dim">Active, Gainers and Losers appear inside the official TradingView widget with its attribution. Data may be delayed; blank or unavailable widgets do not confirm prices. Quotes are not copied into the scrolling strip.</p>
  </section>;
}
