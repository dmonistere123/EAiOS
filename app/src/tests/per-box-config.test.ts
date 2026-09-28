import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('per-box identity configuration', () => {
  it('uses private environment values without changing application source', async () => {
    vi.stubEnv('VITE_AGENT_NAME', 'Pepper');
    vi.stubEnv('VITE_EXECUTIVE_NAME', 'Austin');
    vi.stubEnv('VITE_TELEGRAM_HOME_DELIVERY', 'telegram:-1001234567890');
    vi.resetModules();

    const config = await import('../config');
    expect(config.AGENT_NAME).toBe('Pepper');
    expect(config.EXECUTIVE_NAME).toBe('Austin');
    expect(config.TELEGRAM_HOME_DELIVERY).toBe('telegram:-1001234567890');
  });

  it('never falls back to a different box telegram destination', async () => {
    vi.stubEnv('VITE_TELEGRAM_HOME_DELIVERY', 'not-a-destination');
    vi.resetModules();

    const config = await import('../config');
    expect(config.TELEGRAM_HOME_DELIVERY).toBe('');
    const governance = await import('../domain/governance');
    expect(governance.AGENT_GOVERNANCE_SOUL).toContain('never guess a recipient');
    expect(governance.AGENT_GOVERNANCE_SOUL).not.toContain('telegram:-1004268167166');
  });
});
