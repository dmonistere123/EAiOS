/** Public metadata only. Never add key values to this contract. */
export type ApiKeyScope = 'app' | 'hermes' | 'podcasts';
export const API_KEY_SCOPES = {
  app: { label: 'Application', help: 'Travel and connected services. Saved keys apply to the next request.' },
  hermes: { label: 'Assistant & tools', help: 'Shared Hermes keys. Concierge and travel planning pick up changes immediately; restart Hermes before using changed keys in agents or schedules. Individual agent overrides stay unchanged.' },
  podcasts: { label: 'Podcasts', help: 'Podcast provider keys. Restart the podcast service after saving to apply changes.' },
} as const;
export const API_KEY_CATALOG = [
  { key: 'DUFFEL_API_KEY', name: 'Duffel', description: 'Flights, hotels and cars. Account access is still required. Saving a live key does not enable purchases.', scopes: ['app'] },
  { key: 'COMPOSIO_API_KEY', name: 'Composio', description: 'Connected apps and integrations. Connect individual accounts in Connections.', scopes: ['app'] },
  { key: 'OPENTABLE_API_KEY', name: 'OpenTable', description: 'Restaurant partner access. A key alone does not enable in-app reservations.', scopes: ['app'] },
  { key: 'OPENROUTER_API_KEY', name: 'OpenRouter', description: 'Language models, Concierge and travel planning.', scopes: ['hermes', 'podcasts'] },
  { key: 'OPENAI_API_KEY', name: 'OpenAI', description: 'OpenAI models and supported speech features.', scopes: ['hermes', 'podcasts'] },
  { key: 'ANTHROPIC_API_KEY', name: 'Anthropic', description: 'Claude models when selected in your agent configuration.', scopes: ['hermes'] },
  { key: 'GEMINI_API_KEY', name: 'Google Gemini', description: 'Gemini models when selected in your agent configuration.', scopes: ['hermes'] },
  { key: 'KIMI_API_KEY', name: 'Kimi', description: 'Kimi model access for configured agents.', scopes: ['hermes'] },
  { key: 'KIMI_CN_API_KEY', name: 'Kimi China', description: 'Regional Kimi model access for configured agents.', scopes: ['hermes'] },
  { key: 'MCP_COMPOSIO_API_KEY', name: 'Composio assistant tools', description: 'Composio MCP tools used by Hermes agents.', scopes: ['hermes'] },
  { key: 'TELEGRAM_BOT_TOKEN', name: 'Telegram', description: 'Default Hermes bot only. Individual agent bot tokens are managed in Agents.', scopes: ['hermes'] },
  { key: 'TAVILY_API_KEY', name: 'Tavily', description: 'Web search for configured assistant tools.', scopes: ['hermes'] },
  { key: 'FIRECRAWL_API_KEY', name: 'Firecrawl', description: 'Web retrieval for configured assistant tools.', scopes: ['hermes'] },
  { key: 'ELEVENLABS_API_KEY', name: 'ElevenLabs', description: 'Voice generation.', scopes: ['hermes', 'podcasts'] },
] as const;
export interface ApiKeyStatus {
  key: string; name: string; description: string; configured: boolean;
  source: 'saved' | 'environment' | 'inherited' | 'missing';
  mode?: 'test' | 'live';
}
export interface ApiKeySettings { scope: ApiKeyScope; version: string; keys: ApiKeyStatus[]; }
