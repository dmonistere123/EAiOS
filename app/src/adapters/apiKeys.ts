import { liveComposio } from './live/LiveComposioAdapter';
import type { ApiKeyScope, ApiKeySettings } from '../domain/apiKeys';
const endpoint = '/api/settings/api-keys';
export const apiKeys = {
  async list(scope: ApiKeyScope): Promise<ApiKeySettings> {
    const res = await fetch(`${endpoint}?scope=${scope}`, { cache: 'no-store' });
    if (!res.ok) throw new Error('API key settings are unavailable. Try reloading.');
    return res.json();
  },
  async save(scope: ApiKeyScope, key: string, value: string, version: string): Promise<void> {
    const res = await fetch(endpoint, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ scope, key, value, version }) });
    if (!res.ok) throw new Error(res.status === 409 ? 'Configuration changed or another update is in progress. Reload settings before saving again.' : 'Could not save the key. Check the token format and try again.');
    if (scope === 'app' && key === 'COMPOSIO_API_KEY') liveComposio.resetCredentials();
  },
};
