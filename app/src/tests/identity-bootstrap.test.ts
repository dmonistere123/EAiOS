import { afterEach, expect, it, vi } from 'vitest';
import { displayName } from '../domain/identity';
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.resetModules(); });
it('uses the serving box instead of the build machine before loading page modules', async () => {
  vi.stubEnv('VITE_HERMES_LIVE','1'); vi.stubEnv('VITE_AGENT_NAME','Ally');
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ok:true,json:async()=>({assistantName:'Pepper',executiveName:'Austin'})}));
  const config = await import('../config');
  await config.loadBoxIdentity();
  expect(config.AGENT_NAME).toBe('Pepper'); expect(config.EXECUTIVE_NAME).toBe('Austin');
  expect(fetch).toHaveBeenCalledWith('/api/identity', expect.objectContaining({cache:'no-store'}));
});
it('falls back neutrally if identity fails instead of showing the packaged Ally name', async () => {
  vi.stubEnv('VITE_HERMES_LIVE','1'); vi.stubEnv('VITE_AGENT_NAME','Ally');
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
  const config = await import('../config'); await config.loadBoxIdentity();
  expect(config.AGENT_NAME).toBe('AI Assistant');
});
it('keeps the mock preview isolated and validates display values', async () => {
  vi.stubEnv('VITE_HERMES_LIVE','0'); vi.stubEnv('VITE_AGENT_NAME','Pepper');
  vi.stubGlobal('fetch', vi.fn());
  const config = await import('../config'); await config.loadBoxIdentity();
  expect(config.AGENT_NAME).toBe('Pepper'); expect(fetch).not.toHaveBeenCalled();
  expect(displayName('  Élodie  ')).toBe('Élodie');
  for (const value of [null, {}, '', 'x'.repeat(81), 'Pepper\nBad']) expect(displayName(value)).toBe('AI Assistant');
});
