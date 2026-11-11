import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { parseTicker } from '../adapters/ticker';
import Ticker from '../pages/Ticker';
import { BottomTicker } from '../components/BottomTicker';
const sample = { date: new Date().toISOString().slice(0,10), version: 1, state: 'live', stale: false, generatedAt: new Date().toISOString(), sources: { americanFootball: { complete: true }, baseball: { complete: true } }, sports: { secFootball: [], secBaseball: [], nfc: [{ date: new Date().toISOString(), home: { name: 'Packers' }, away: { name: 'Cowboys' }, score: '23 - 13', detail: 'Final' }] } };
afterEach(() => { vi.unstubAllGlobals(); localStorage.clear(); });
describe('ticker source truth', () => {
  it('preserves home/away score order and verified empty windows', () => {
    const data = parseTicker(sample);
    expect(data.items.join(' ')).toContain('Packers 23 — Cowboys 13 • Final');
    expect(data.items.join(' ')).toContain('SEC baseball • no verified games in source window');
    expect(data.timestamp).toBe(sample.generatedAt);
  });
  it('never calls incomplete, stale or unavailable coverage no-game', () => {
    for (const state of ['partial', 'stale', 'unavailable']) expect(parseTicker({ ...sample, state }).items.join(' ')).not.toContain('no verified games');
    expect(parseTicker(sample, Date.now() + 3 * 3600_000).stale).toBe(true);
    expect(parseTicker({ ...sample, generatedAt: undefined }).items.join(' ')).not.toContain('no verified games');
    expect(() => parseTicker({})).toThrow();
  });
  it('contains network failure and persists pause without requiring storage access', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    render(<MemoryRouter><BottomTicker hidden={false} onHidden={() => {}} /></MemoryRouter>);
    await waitFor(() => expect(screen.getAllByText(/Sports unavailable/).length).toBeGreaterThan(0));
    fireEvent.click(screen.getByRole('button', { name: 'Pause' }));
    expect(JSON.parse(localStorage.getItem('eaios.ticker.v1')!).paused).toBe(true);
    expect(screen.getByRole('button', { name: 'Resume' })).toHaveAttribute('aria-pressed', 'true');
  });
  it('makes no data request while hidden and provides restore', () => {
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
    const restore = vi.fn(); render(<MemoryRouter><BottomTicker hidden onHidden={restore} /></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: 'Show ticker' }));
    expect(restore).toHaveBeenCalledWith(false); expect(fetcher).not.toHaveBeenCalled();
  });
});

describe('complete supported game rendering', () => {
  it('renders every returned matching game in both dashboard and scrolling strip', async () => {
    const games = ['Alpha', 'Bravo', 'Charlie'].map((name, i) => ({ id: i + 1, date: new Date().toISOString(), home: {name}, away: {name: 'Opponent ' + i}, score: '21 - 14', detail: 'Final' }));
    const feed = {...sample, sports: {secFootball: [games[0]], secBaseball: [games[1]], nfc: [games[2]]}};
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ok: true, json: async () => feed}));
    const view = render(<MemoryRouter><Ticker /><BottomTicker hidden={false} onHidden={() => {}} /></MemoryRouter>);
    await waitFor(() => expect(view.container.querySelectorAll('article')).toHaveLength(3));
    for (const name of ['Alpha','Bravo','Charlie']) {
      expect(Array.from(view.container.querySelectorAll('article')).some(el => el.textContent?.includes(name))).toBe(true);
      expect(view.container.querySelector('.eaios-ticker-group')?.textContent).toContain(name);
    }
  });
});
