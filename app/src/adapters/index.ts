import {liveTravel} from './live/LiveTravelAdapter';
/**
 * Adapter entry — the ONLY adapter import pages/state are allowed to use.
 * Live mode when VITE_HERMES_LIVE=1 (with per-method mock fallback inside
 * LiveHermesAdapter), pure mock otherwise.
 */
import type { HermesAdapter } from './interfaces';
import { hermes as mock } from './mock/MockHermesAdapter';
import { live } from './live/LiveHermesAdapter';
import { composio as mockComposio } from './mock/MockComposioAdapter';
import { liveComposio } from './live/LiveComposioAdapter';
import { liveKnowledge } from './live/LiveKnowledgeAdapter';
import { knowledge as mockKnowledge } from './mock/MockKnowledgeAdapter';
import { livePodcasts } from './live/LivePodcastAdapter';
import { podcasts as mockPodcasts } from './mock/MockPodcastAdapter';

const useLive = import.meta.env.VITE_HERMES_LIVE === '1';

const travelOnly = import.meta.env.VITE_TRAVEL_LIVE === '1';
export const travelMode = useLive || travelOnly ? 'live' : 'mock';
const travelMethods = new Set(['chooseTravelOption','travelPlaces','travelRecommendations','updateTravelTrip','listTrips','getTrip','searchTravel','travelAgent','createTrip','proposeBooking','decideTravelApproval','addTravelPlan','travelAction']);
export const hermes: HermesAdapter = travelOnly ? new Proxy(mock, {get(target, property, receiver) {
  if (travelMethods.has(String(property))) {const value = Reflect.get(liveTravel, property); return typeof value === 'function' ? value.bind(liveTravel) : value;}
  const value = Reflect.get(target, property, receiver); return typeof value === 'function' ? value.bind(target) : value;
}}) : useLive ? live : mock;
export const adapterMode: 'live' | 'mock' = useLive ? 'live' : 'mock';
// LiveComposioAdapter self-detects a missing/invalid key and falls back to mock.
export const composio = liveComposio;
// Live mode: sidecar-backed, self-detects a down sidecar → mock fallback.
export const knowledge = useLive ? liveKnowledge : mockKnowledge;
// Live mode: podcast sidecar (OpenRouter LLM + Edge TTS) on /podcasts-api.
export const podcasts = useLive ? livePodcasts : mockPodcasts;
export { live, mockComposio };
