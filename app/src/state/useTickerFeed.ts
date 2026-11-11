import { useEffect, useState } from 'react';
import { fetchTickerData, rememberFeed, renderTicker, readHistory } from '../adapters/ticker';
import type { SportsFeed } from '../adapters/ticker';
import { useTickerSelections } from './tickerPreferences';
export function useTickerFeed(active = true) {
  const prefs = useTickerSelections();
  const [feed, setFeed] = useState<SportsFeed | null>(null);
  const [history, setHistory] = useState<SportsFeed[]>(() => readHistory());
  const [failed, setFailed] = useState(false);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!active) return;
    let disposed = false;
    let controller: AbortController | undefined;
    async function refresh() {
      setNow(Date.now());
      if (controller) return;
      const current = new AbortController(); controller = current;
      const timeout = setTimeout(() => current.abort(), 10_000);
      try {
        const next = await fetchTickerData(current.signal);
        if (next.state === 'unavailable') throw new Error('Sports unavailable');
        if (!disposed) { setHistory(rememberFeed(next)); setFeed(next); setFailed(false); }
      } catch { if (!disposed) setFailed(true); }
      finally { clearTimeout(timeout); controller = undefined; }
    }
    void refresh(); const timer = setInterval(() => void refresh(), 60_000);
    const wake = () => { if (document.visibilityState !== 'hidden') void refresh(); };
    window.addEventListener('focus', wake); window.addEventListener('online', wake);
    window.addEventListener('pageshow', wake); document.addEventListener('visibilitychange', wake);
    return () => { disposed = true; controller?.abort(); clearInterval(timer);
      window.removeEventListener('focus', wake); window.removeEventListener('online', wake);
      window.removeEventListener('pageshow', wake); document.removeEventListener('visibilitychange', wake);
    };
  }, [active]);
  const snapshot = feed ? renderTicker(feed, prefs, history, now) : null;
  return { prefs, snapshot, failed };
}
