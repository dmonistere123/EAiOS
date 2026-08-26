/**
 * Adapter entry — the ONLY adapter import pages/state are allowed to use.
 * Live mode when VITE_HERMES_LIVE=1 (with per-method mock fallback inside
 * LiveHermesAdapter), pure mock otherwise.
 */
import type { HermesAdapter } from './interfaces';
import { hermes as mock } from './mock/MockHermesAdapter';
import { live } from './live/LiveHermesAdapter';

const useLive = import.meta.env.VITE_HERMES_LIVE === '1';

export const hermes: HermesAdapter = useLive ? live : mock;
export const adapterMode: 'live' | 'mock' = useLive ? 'live' : 'mock';
export { live };
