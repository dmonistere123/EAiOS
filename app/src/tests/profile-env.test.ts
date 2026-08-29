// @vitest-environment node
/// <reference types="node" />
/**
 * Profile-env binding store tests (dogfood 2026-08-29) — confinement,
 * replace-or-append, chmod 600, existence-only reads, default-profile
 * refusal. Runs against a tmp profiles root, never the real one.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { hasProfileEnvKey, profileEnvPath, setProfileEnvKey } from '../../server/profileEnv';

const root = mkdtempSync(join(tmpdir(), 'eaios-profile-env-'));
const profiles = join(root, 'profiles');
mkdirSync(join(profiles, 'quill'), { recursive: true });
afterAll(() => rmSync(root, { recursive: true, force: true }));

describe('profileEnvPath confinement', () => {
  it('resolves a real profile dir; refuses default, traversal, and missing profiles', () => {
    expect(profileEnvPath(profiles, 'quill')).toBe(join(profiles, 'quill', '.env'));
    expect(() => profileEnvPath(profiles, 'default')).toThrow(/user-edits-only/);
    expect(() => profileEnvPath(profiles, '../evil')).toThrow(/invalid profile/);
    expect(() => profileEnvPath(profiles, 'ghost')).toThrow(/no profile/);
  });
});

describe('setProfileEnvKey + hasProfileEnvKey', () => {
  it('writes a new key with chmod 600 and reads existence only', () => {
    setProfileEnvKey(profiles, 'quill', 'TELEGRAM_BOT_TOKEN', 'tok-abc-1');
    expect(hasProfileEnvKey(profiles, 'quill', 'TELEGRAM_BOT_TOKEN')).toBe(true);
    expect(readFileSync(join(profiles, 'quill', '.env'), 'utf8')).toContain('TELEGRAM_BOT_TOKEN=tok-abc-1');
    expect(statSync(join(profiles, 'quill', '.env')).mode & 0o777).toBe(0o600);
  });

  it('replaces the key in place without duplicating or touching other lines', () => {
    writeFileSync(join(profiles, 'quill', '.env'), 'OTHER_KEY=keepme\nTELEGRAM_BOT_TOKEN=tok-old\n', 'utf8');
    setProfileEnvKey(profiles, 'quill', 'TELEGRAM_BOT_TOKEN', 'tok-new-2');
    const text = readFileSync(join(profiles, 'quill', '.env'), 'utf8');
    expect(text).toContain('OTHER_KEY=keepme');
    expect(text).toContain('TELEGRAM_BOT_TOKEN=tok-new-2');
    expect(text).not.toContain('tok-old');
    expect(text.split('TELEGRAM_BOT_TOKEN=').length - 1).toBe(1);
  });

  it('refuses non-allowlisted keys and multiline values', () => {
    expect(() => setProfileEnvKey(profiles, 'quill', 'COMPOSIO_API_KEY', 'x')).toThrow(/allowlisted/);
    expect(() => setProfileEnvKey(profiles, 'quill', 'TELEGRAM_BOT_TOKEN', 'a\nb')).toThrow(/single/);
    expect(() => hasProfileEnvKey(profiles, 'quill', 'COMPOSIO_API_KEY')).toThrow(/allowlisted/);
  });
});
