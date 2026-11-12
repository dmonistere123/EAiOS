import {describe,expect,it} from 'vitest';
import {hermes} from '../adapters';
describe('Environment file saves (spec §8.11)', () => {
  it('rejects stale expectedVersion (optimistic concurrency)', async () => {
    await hermes.readEnvironmentFile('env-01');
    const res = await hermes.writeEnvironmentFile('env-01', 'stale-version', 'new content');
    expect(res.ok).toBe(false);
    expect(res.error?.code).toBe('version_conflict');
    expect(res.error?.retryable).toBe(true);
  });

  it('accepts a save with the current version and returns an audit id', async () => {
    const file = await hermes.readEnvironmentFile('env-02');
    const res = await hermes.writeEnvironmentFile('env-02', file.version, 'updated rules');
    expect(res.ok).toBe(true);
    expect(res.auditEventId).toMatch(/^aud-/);
  });
});

describe('Agent config validation (spec §8.3)', () => {
  it('rejects a model outside the agent allowed list', async () => {
    const res = await hermes.updateAgentConfig('ally', { model: { provider: 'evil', model: 'not-allowed' } });
    expect(res.ok).toBe(false);
    expect(res.error?.code).toBe('model_not_allowed');
  });
});