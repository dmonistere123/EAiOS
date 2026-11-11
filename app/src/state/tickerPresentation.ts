import type { TickerSnapshot } from '../adapters/ticker';
export function tickerDate(value: string | null, compact = false) {
  if (!value || !Number.isFinite(Date.parse(value))) return 'Time unavailable';
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', ...(compact ? {} : { year: 'numeric' as const }), hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }).format(new Date(value));
}
export function tickerStrip(snapshot: TickerSnapshot): string[] {
  const lines = snapshot.scores.map(({game, label, historical}) => {
    const pair = game.score.match(/^(\d+)\s*-\s*(\d+)$/);
    return `${historical ? 'Recent weekend • ' : ''}${label} • ${game.home.name} ${pair?.[1] ?? '–'} — ${game.away.name} ${pair?.[2] ?? '–'} • ${game.detail || game.status || 'Status unknown'} • ${tickerDate(game.date, true)}`;
  });
  if (!lines.length) lines.push('No verified scores to display');
  if (snapshot.stale || snapshot.state !== 'live') lines.unshift(snapshot.state === 'unavailable' ? 'Sports unavailable' : snapshot.stale ? 'Sports source stale' : 'Sports coverage partial');
  if (snapshot.notices.length) lines.push(`${snapshot.notices.length} coverage notices • details on Ticker page`);
  return lines;
}
