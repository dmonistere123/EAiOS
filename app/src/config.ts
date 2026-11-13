import { displayName } from './domain/identity';

// The serving box overrides build-time values before any page/adapter is loaded.
// Live failure uses a neutral label rather than another machine's bundled name.
export let AGENT_NAME = displayName(import.meta.env.VITE_AGENT_NAME);
export let EXECUTIVE_NAME = displayName(import.meta.env.VITE_EXECUTIVE_NAME, 'Executive');

export async function loadBoxIdentity(): Promise<void> {
  if (import.meta.env.VITE_HERMES_LIVE !== '1') return;
  AGENT_NAME = 'AI Assistant';
  EXECUTIVE_NAME = 'Executive';
  try {
    const response = await fetch('/api/identity', { cache: 'no-store', signal: AbortSignal.timeout(5000) });
    if (!response.ok) return;
    const identity = await response.json();
    AGENT_NAME = displayName(identity.assistantName);
    EXECUTIVE_NAME = displayName(identity.executiveName, 'Executive');
  } catch { /* Keep the app available if the identity endpoint is unavailable. */ }
}

const telegramTarget = (import.meta.env.VITE_TELEGRAM_HOME_DELIVERY as string | undefined)?.trim() ?? '';
export const TELEGRAM_HOME_DELIVERY = /^telegram:-?\d+$/.test(telegramTarget) ? telegramTarget : '';
