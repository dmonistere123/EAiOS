import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { parseEnv } from 'node:util';
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { quoteDisplayName } from '../identity-env.mjs';

test('chosen names round-trip through dotenv and shell readers', () => {
  for (const name of ['Pepper', 'Ally', "Pepper O’Neil", "Ana's Assistant", 'Élodie #1']) {
    const setting = `VITE_AGENT_NAME=${quoteDisplayName(name)}`;
    assert.equal(parseEnv(setting).VITE_AGENT_NAME, name);
    assert.equal(execFileSync('bash', ['-c', setting+'\nprintf %s "$VITE_AGENT_NAME"'], { encoding: 'utf8' }), name);
  }
  for (const bad of ['', 'x\nSECRET=bad', '$(id)', '`id`', '"', '\\', 'x'.repeat(81)]) assert.throws(() => quoteDisplayName(bad));
});

test('actual installer identity stanza preserves Pepper on rerun and configures fresh Core/Full installs', () => {
  const root = mkdtempSync(join(tmpdir(), '2ep-identity-'));
  try {
    mkdirSync(join(root, 'app'));
    const installer = readFileSync(new URL('../../install/install.sh', import.meta.url), 'utf8');
    const stanza = installer.slice(installer.indexOf('ENV_LOCAL='), installer.indexOf('\n# ---------------------------------------------------------------------------\n# 8.'));
    assert.ok(stanza.includes('ENVEOF') && stanza.length < 9000);
    assert.ok(installer.indexOf('npm run build') > installer.indexOf('VITE_AGENT_NAME=$AGENT_NAME_ENV'));
    assert.ok(installer.indexOf('npm run build') < installer.indexOf('./scripts/install-systemd-user.sh --start'));
    const script = 'log_info(){ :; }; log_success(){ :; }; log_warn(){ :; }; fail(){ exit 1; };\n'+stanza.replaceAll('$EAIOS_ROOT/scripts/identity-env.mjs', resolve('scripts/identity-env.mjs'));
    const env = { ...process.env, EAIOS_ROOT: root, NONINTERACTIVE: '1', EAIOS_AGENT_NAME: 'Pepper', EAIOS_EXECUTIVE_NAME: 'Test Executive', DEV_TOKEN: 'fixture-token' };
    for (const edition of ['core','full']) {
      rmSync(join(root, 'app/.env.local'), { force: true });
      execFileSync('bash', ['-c', script], { env: { ...env, EAIOS_EDITION: edition } });
      const path = join(root, 'app/.env.local');
      assert.equal(parseEnv(readFileSync(path, 'utf8')).VITE_AGENT_NAME, 'Pepper');
      writeFileSync(path, readFileSync(path, 'utf8')+'\nPRIVATE_MARKER=preserve-me\n');
      const before = readFileSync(path);
      execFileSync('bash', ['-c', script], { env: { ...env, EAIOS_AGENT_NAME: 'Ally' } });
      assert.deepEqual(readFileSync(path), before);
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
});
