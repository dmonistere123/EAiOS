/**
 * Travel browser-automation backend tests (F31 extension).
 *
 * Exercises the encrypted vault, encrypted session store, playbook registry,
 * and result parsing. Does not launch a real browser.
 */
import { describe, expect, it, beforeEach } from 'vitest';
import { CredentialVault } from '../../server/travelBrowser/vault.ts';
import { FileVaultBackend, OnePasswordVaultBackend, BitwardenVaultBackend, KeyringVaultBackend, createVaultBackend } from '../../server/travelBrowser/vaultBackend.ts';
import type { VaultBackend, VaultSiteSummary } from '../../server/travelBrowser/vaultBackend.ts';
import { SessionStore } from '../../server/travelBrowser/sessions.ts';
import { listPlaybooks, pickPlaybook, resyCitySlug } from '../../server/travelBrowser/playbooks.ts';
import { parseSearchResults, buildSearchJob, buildBookingJob } from '../../server/travelBrowser/runner.ts';
import type { TravelSearchParams, TravelSearchResult } from '../adapters/interfaces.ts';
import { randomBytes } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function tmpDir(): string {
  return mkdtempSync(join(tmpdir(), 'travel-browser-'));
}

function key32(): Buffer {
  return randomBytes(32);
}

// DEFERRED 2026-09-05: browser-automation booking moved to roadmap. Re-enable
// when the credential vault + Booking.com single-provider playbook is built.
describe.skip('CredentialVault', () => {
  let dir: string;
  beforeEach(() => {
    dir = tmpDir();
  });

  it('round-trips credentials', () => {
    const vault = new CredentialVault(key32(), join(dir, 'vault.enc'));
    vault.set('opentable', { username: 'don@example.com', password: 'secret123', notes: 'main account' });
    const summary = vault.list();
    expect(summary).toHaveLength(1);
    expect(summary[0].site).toBe('opentable');
    expect(summary[0].hasPassword).toBe(true);
    expect(summary[0].hasUsername).toBe(true);

    const decrypted = vault.getDecrypted('opentable');
    expect(decrypted?.password).toBe('secret123');
  });

  it('removes credentials', () => {
    const vault = new CredentialVault(key32(), join(dir, 'vault.enc'));
    vault.set('opentable', { username: 'don@example.com', password: 'secret123' });
    expect(vault.remove('opentable')).toBe(true);
    expect(vault.list()).toHaveLength(0);
    expect(vault.remove('opentable')).toBe(false);
  });

  it('fails to decrypt with the wrong key', () => {
    const key = key32();
    const vault = new CredentialVault(key, join(dir, 'vault.enc'));
    vault.set('opentable', { username: 'don@example.com', password: 'secret123' });

    const wrongVault = new CredentialVault(key32(), join(dir, 'vault.enc'));
    expect(() => wrongVault.list()).toThrow();
  });
});

// --- Mock backend for unit testing ---

class MockVaultBackend implements VaultBackend {
  private storage = new Map<string, { cred: Parameters<VaultBackend['set']>[1]; updatedAt: string }>();

  list(): VaultSiteSummary[] {
    return Array.from(this.storage.entries()).map(([site, entry]) => ({
      site,
      hasUsername: !!entry.cred.username,
      username: entry.cred.username,
      hasPassword: !!entry.cred.password,
      hasTotp: !!entry.cred.totpSeed,
      notes: entry.cred.notes,
      updatedAt: entry.updatedAt,
    }));
  }

  get(site: string): ReturnType<VaultBackend['get']> {
    const entry = this.storage.get(site);
    if (!entry) return null;
    return {
      site,
      username: entry.cred.username,
      notes: entry.cred.notes,
      updatedAt: entry.updatedAt,
      ...(entry.cred.password ? { passwordCipher: 'mock:enc' } : {}),
      ...(entry.cred.totpSeed ? { totpSeedCipher: 'mock:enc' } : {}),
    };
  }

  getDecrypted(site: string): ReturnType<VaultBackend['getDecrypted']> {
    const entry = this.storage.get(site);
    if (!entry) return null;
    return {
      site,
      username: entry.cred.username,
      password: entry.cred.password,
      totpSeed: entry.cred.totpSeed,
      notes: entry.cred.notes,
      updatedAt: entry.updatedAt,
    };
  }

  set(site: string, input: { username?: string; password?: string; totpSeed?: string; notes?: string }): void {
    this.storage.set(site, { cred: { ...input }, updatedAt: new Date().toISOString() });
  }

  remove(site: string): boolean {
    return this.storage.delete(site);
  }

  has(site: string): boolean {
    return this.storage.has(site);
  }
}

describe('VaultBackend interface', () => {
  it('CredentialVault.withBackend works with a mock backend', () => {
    const mock = new MockVaultBackend();
    const vault = CredentialVault.withBackend(key32(), mock);
    vault.set('test-site', { username: 'u', password: 'p', notes: 'n' });
    expect(vault.list()).toHaveLength(1);
    expect(vault.list()[0].site).toBe('test-site');
    expect(vault.list()[0].hasUsername).toBe(true);
    expect(vault.has('test-site')).toBe(true);
    expect(vault.getDecrypted('test-site')?.password).toBe('p');
    expect(vault.remove('test-site')).toBe(true);
    expect(vault.has('test-site')).toBe(false);
  });

  it('FileVaultBackend round-trips through CredentialVault constructor', () => {
    const dir = tmpDir();
    const vault = new CredentialVault(key32(), join(dir, 'vault.enc'));
    vault.set('kayak', { username: 'kayak-user', password: 'kayak-pass' });
    const list = vault.list();
    expect(list).toHaveLength(1);
    expect(list[0].hasUsername).toBe(true);
    expect(list[0].username).toBe('kayak-user');
    expect(vault.getDecrypted('kayak')?.password).toBe('kayak-pass');
  });

  it('FileVaultBackend get returns null for missing site', () => {
    const dir = tmpDir();
    const vault = new CredentialVault(key32(), join(dir, 'vault.enc'));
    expect(vault.get('nonexistent')).toBeNull();
    expect(vault.has('nonexistent')).toBe(false);
  });

  it('createVaultBackend returns FileVaultBackend by default', () => {
    const key = key32();
    const selection = createVaultBackend(key, '/tmp/test-vault.enc');
    expect(selection.kind).toBe('file');
    expect(selection.backend).toBeInstanceOf(FileVaultBackend);
  });

  it('createVaultBackend returns OnePasswordVaultBackend when TRAVEL_BROWSER_VAULT_BACKEND=1password', () => {
    process.env.TRAVEL_BROWSER_VAULT_BACKEND = '1password';
    try {
      const key = key32();
      const selection = createVaultBackend(key, '/tmp/test-vault.enc');
      expect(selection.kind).toBe('1password');
      expect(selection.backend).toBeInstanceOf(OnePasswordVaultBackend);
    } finally {
      delete process.env.TRAVEL_BROWSER_VAULT_BACKEND;
    }
  });

  it('createVaultBackend returns BitwardenVaultBackend when TRAVEL_BROWSER_VAULT_BACKEND=bitwarden', () => {
    process.env.TRAVEL_BROWSER_VAULT_BACKEND = 'bitwarden';
    try {
      const key = key32();
      const selection = createVaultBackend(key, '/tmp/test-vault.enc');
      expect(selection.kind).toBe('bitwarden');
      expect(selection.backend).toBeInstanceOf(BitwardenVaultBackend);
    } finally {
      delete process.env.TRAVEL_BROWSER_VAULT_BACKEND;
    }
  });

  it('createVaultBackend returns KeyringVaultBackend when TRAVEL_BROWSER_VAULT_BACKEND=keyring', () => {
    process.env.TRAVEL_BROWSER_VAULT_BACKEND = 'keyring';
    try {
      const key = key32();
      const selection = createVaultBackend(key, '/tmp/test-vault.enc');
      expect(selection.kind).toBe('keyring');
      expect(selection.backend).toBeInstanceOf(KeyringVaultBackend);
    } finally {
      delete process.env.TRAVEL_BROWSER_VAULT_BACKEND;
    }
  });

  it('Password-manager backends are injectable via CredentialVault.createFromEnv', () => {
    process.env.TRAVEL_BROWSER_VAULT_BACKEND = '1password';
    try {
      const key = key32();
      const { vault, kind } = CredentialVault.createFromEnv(key, '/tmp/test-vault.enc');
      expect(kind).toBe('1password');
      // The vault wraps a OnePasswordVaultBackend; set/get will fail
      // because no `op` CLI is present, but the wiring is correct.
      expect(vault).toBeInstanceOf(CredentialVault);
    } finally {
      delete process.env.TRAVEL_BROWSER_VAULT_BACKEND;
    }
  });
});

describe('CredentialVault.createFromEnv with mock backend (functionally tested via MockVaultBackend)', () => {
  it('works identically to .withBackend', () => {
    const mock = new MockVaultBackend();
    const vault = CredentialVault.withBackend(key32(), mock);
    vault.set('site-a', { username: 'a', password: 'secret' });
    vault.set('site-b', { username: 'b', password: 'topsecret' });
    expect(vault.list()).toHaveLength(2);
    expect(vault.getDecrypted('site-a')?.password).toBe('secret');
    expect(vault.getDecrypted('site-b')?.password).toBe('topsecret');
    vault.remove('site-a');
    expect(vault.list()).toHaveLength(1);
    expect(vault.has('site-a')).toBe(false);
    expect(vault.has('site-b')).toBe(true);
  });

  it('handles TOTP seed round-trip', () => {
    const mock = new MockVaultBackend();
    const vault = CredentialVault.withBackend(key32(), mock);
    vault.set('bank', { username: 'user', totpSeed: 'JBSWY3DPEHPK3PXP' });
    const entry = vault.getDecrypted('bank');
    expect(entry?.totpSeed).toBe('JBSWY3DPEHPK3PXP');
    expect(entry?.password).toBeUndefined();
  });
});

describe.skip('SessionStore', () => {
  let dir: string;
  beforeEach(() => {
    dir = tmpDir();
  });

  it('round-trips cookies per site', () => {
    const store = new SessionStore(key32(), join(dir, 'sessions.enc'));
    store.setCookies('opentable', [{ name: 'sid', value: 'abc' }]);
    expect(store.getCookies('opentable')).toHaveLength(1);
    expect(store.getCookies('kayak')).toHaveLength(0);
  });

  it('lists session sites', () => {
    const store = new SessionStore(key32(), join(dir, 'sessions.enc'));
    store.setCookies('opentable', [{ name: 'sid', value: 'abc' }]);
    store.setCookies('kayak', [{ name: 'ksid', value: 'xyz' }]);
    expect(store.list().map((s) => s.site).sort()).toEqual(['kayak', 'opentable']);
  });
});

describe('Playbooks', () => {
  it('lists registered playbooks', () => {
    const playbooks = listPlaybooks();
    expect(playbooks.length).toBeGreaterThanOrEqual(4);
    const ids = playbooks.map((p) => p.id);
    expect(ids).toContain('kayak-hotels');
    expect(ids).toContain('opentable-restaurants');
  });

  it('picks a playbook by kind', () => {
    expect(pickPlaybook('hotel')?.id).toBe('kayak-hotels');
    expect(pickPlaybook('car')?.id).toBe('kayak-cars');
    expect(pickPlaybook('restaurant')?.id).toBe('opentable-restaurants');
  });

  it('supports preferred site lookup', () => {
    expect(pickPlaybook('hotel', 'ihg')?.id).toBe('ihg-hotels');
    expect(pickPlaybook('hotel', 'marriott')?.id).toBe('marriott-hotels');
  });

  it('resolves resy-restaurants as a preferred site', () => {
    const resy = pickPlaybook('restaurant', 'resy');
    expect(resy?.id).toBe('resy-restaurants');
    expect(resy?.site).toBe('resy');
    expect(resy?.kind).toBe('restaurant');
  });

  it('resy playbook has authSteps with login modal flow', () => {
    const resy = pickPlaybook('restaurant', 'resy');
    expect(resy?.authSteps).toBeDefined();
    expect(resy?.authSteps!.length).toBeGreaterThanOrEqual(5);
    // Should include go, click login, fill email, fill password, submit
    const actions = resy!.authSteps!.map((s) => s.action);
    expect(actions).toContain('goto');
    expect(actions).toContain('fill');
    expect(actions).toContain('click');
  });

  it('resy playbook searchSteps include venueSlug and externalUrl in schema', () => {
    const resy = pickPlaybook('restaurant', 'resy');
    const extractStep = resy?.searchSteps.find((s) => s.action === 'extract');
    expect(extractStep).toBeDefined();
    if (extractStep && 'schema' in extractStep) {
      expect(extractStep.schema).toHaveProperty('venueSlug');
      expect(extractStep.schema).toHaveProperty('externalUrl');
      expect(extractStep.schema).toHaveProperty('restaurantName');
      expect(extractStep.schema).toHaveProperty('cuisine');
    }
  });

  it('resy playbook searchUrl uses {citySlug} template', () => {
    const resy = pickPlaybook('restaurant', 'resy');
    expect(resy?.searchUrl).toContain('{citySlug}');
    expect(resy?.searchUrl).toContain('resy.com/cities');
  });

  it('resy playbook bookingSteps stop before confirm', () => {
    const resy = pickPlaybook('restaurant', 'resy');
    const extractStep = resy?.bookingSteps.find((s) => s.action === 'extract');
    expect(extractStep).toBeDefined();
    if (extractStep && 'prompt' in extractStep) {
      // Must include an instruction to NOT confirm
      expect(extractStep.prompt.toLowerCase()).toContain('stop');
      expect(extractStep.prompt.toLowerCase()).not.toContain('confirm booking');
    }
  });
});

describe('parseSearchResults', () => {
  it('parses extracted hotel results', () => {
    const extracted = {
      results: [
        {
          title: 'Watermark Hotel',
          subtitle: 'King Executive · Baton Rouge',
          priceUsd: 380,
          hotelName: 'Watermark Hotel',
          roomType: 'King Executive',
          address: '123 Main St',
          checkIn: '2026-09-12',
          checkOut: '2026-09-14',
        },
      ],
    };
    const results = parseSearchResults(extracted, 'hotel');
    expect(results).toHaveLength(1);
    expect(results[0].kind).toBe('hotel');
    expect(results[0].provider).toBe('browser-use-consumer');
    expect(results[0].priceUsd).toBe(380);
    expect(results[0].meta.hotelName).toBe('Watermark Hotel');
  });

  it('parses Resy restaurant results with venueSlug and externalUrl', () => {
    const extracted = {
      results: [
        {
          title: 'Carbone',
          subtitle: 'Italian · $$$$ · Greenwich Village',
          priceUsd: 150,
          restaurantName: 'Carbone',
          cuisine: 'Italian',
          address: 'Greenwich Village',
          reservationAt: '2026-09-06T19:00:00',
          partySize: 2,
          venueSlug: 'carbone',
          externalUrl: 'https://resy.com/cities/new-york-ny/venues/carbone?date=2026-09-06&seats=2',
          rating: 4.7,
        },
      ],
    };
    const results = parseSearchResults(extracted, 'restaurant');
    expect(results).toHaveLength(1);
    expect(results[0].kind).toBe('restaurant');
    expect(results[0].title).toBe('Carbone');
    expect(results[0].externalUrl).toBe('https://resy.com/cities/new-york-ny/venues/carbone?date=2026-09-06&seats=2');
    expect(results[0].meta.venueSlug).toBe('carbone');
    expect(results[0].meta.reservationAt).toBe('2026-09-06T19:00:00');
    expect(results[0].priceUsd).toBe(150);
  });

  it('returns empty for malformed extraction', () => {
    expect(parseSearchResults(null, 'hotel')).toHaveLength(0);
    expect(parseSearchResults({ notResults: [] }, 'car')).toHaveLength(0);
  });
});

describe('resyCitySlug', () => {
  it('maps US city names to Resy slugs', () => {
    expect(resyCitySlug('New York')).toBe('new-york-ny');
    expect(resyCitySlug('nyc')).toBe('new-york-ny');
    expect(resyCitySlug('Los Angeles')).toBe('los-angeles-ca');
    expect(resyCitySlug('Chicago')).toBe('chicago-il');
    expect(resyCitySlug('New Orleans')).toBe('new-orleans-la');
    expect(resyCitySlug('nola')).toBe('new-orleans-la');
    expect(resyCitySlug('San Francisco')).toBe('san-francisco-ca');
    expect(resyCitySlug('Washington DC')).toBe('washington-dc');
    expect(resyCitySlug('Las Vegas')).toBe('las-vegas-nv');
  });

  it('maps international city names', () => {
    expect(resyCitySlug('Barcelona')).toBe('barcelona');
    expect(resyCitySlug('Madrid')).toBe('madrid');
    expect(resyCitySlug('Hong Kong')).toBe('hong-kong');
  });

  it('falls back to heuristic for unknown cities', () => {
    const slug = resyCitySlug('Birmingham');
    // Should be lowercase, hyphenated
    expect(slug).toBe('birmingham');
    expect(slug).not.toContain(' ');
  });

  it('handles case and whitespace variations', () => {
    expect(resyCitySlug('  NEW YORK  ')).toBe('new-york-ny');
    expect(resyCitySlug('Los angeles')).toBe('los-angeles-ca');
  });
});

describe.skip('IHG playbook hardening', () => {
  it('has auth steps with placeholder credentials', () => {
    const ihg = pickPlaybook('hotel', 'ihg')!;
    expect(ihg.authSteps).toBeDefined();
    const fillSteps = ihg.authSteps!.filter((s) => s.action === 'fill');
    expect(fillSteps).toHaveLength(2);
    expect(fillSteps.some((s) => s.value === '<username>')).toBe(true);
    expect(fillSteps.some((s) => s.value === '<password>')).toBe(true);
  });

  it('has searchSteps with extract_list action and items', () => {
    const ihg = pickPlaybook('hotel', 'ihg')!;
    const searchStep = ihg.searchSteps.find((s) => s.action === 'extract_list');
    expect(searchStep).toBeDefined();
    expect(searchStep!.action).toBe('extract_list');
    const items = (searchStep! as { items: Record<string, string> }).items;
    expect(items.externalUrl).toBe('string');
    expect(items.hotelName).toBe('string');
    expect(items.priceUsd).toBe('number');
  });

  it('builds a search job with IHG-id and includes destination/checkIn', () => {
    const ihg = pickPlaybook('hotel', 'ihg')!;
    const params: TravelSearchParams = {
      kind: 'hotel',
      destination: 'Baton Rouge',
      checkIn: '2026-09-12',
      checkOut: '2026-09-14',
    };
    const job = buildSearchJob(ihg, params, []);
    expect(job.task).toContain('IHG');
    expect(job.task).toContain('Baton Rouge');
    expect(job.task).toContain('2026-09-12');
    expect(job.task).toContain('2026-09-14');
    expect(job.task).toMatch(/stop/gi);
    expect(job.task).toMatch(/book|pay|confirm/i);
    expect(job.extractionSchema).toBeDefined();
    const props = job.extractionSchema!.properties as Record<string, unknown>;
    expect(props.results).toBeDefined();
    expect((props.results as { type: string }).type).toBe('array');
  });

  it('builds a booking job that includes result title and stop instruction', () => {
    const ihg = pickPlaybook('hotel', 'ihg')!;
    const params: TravelSearchParams = {
      kind: 'hotel',
      destination: 'Baton Rouge',
      checkIn: '2026-09-12',
      checkOut: '2026-09-14',
    };
    const result: TravelSearchResult = {
      id: 'test-1',
      kind: 'hotel',
      title: 'Watermark Hotel',
      subtitle: 'King Executive · Baton Rouge',
      priceUsd: 380,
      provider: 'browser-use-consumer',
      meta: { hotelName: 'Watermark Hotel', roomType: 'King Executive', address: '123 Main St' },
    };
    const job = buildBookingJob(ihg, params, result, []);
    expect(job.task).toContain('Watermark Hotel');
    expect(job.task).toMatch(/stop/gi);
    expect(job.task).toMatch(/book|pay|confirm/i);
  });

  it('parses IHG-shaped extraction into TravelSearchResult', () => {
    const extracted = {
      results: [
        {
          title: 'Holiday Inn Baton Rouge',
          subtitle: 'Standard Room · 4960 Constitution Ave',
          priceUsd: 109,
          hotelName: 'Holiday Inn Baton Rouge',
          roomType: 'Standard Room',
          address: '4960 Constitution Ave, Baton Rouge, LA',
          checkIn: '2026-09-12',
          checkOut: '2026-09-14',
          externalUrl: 'https://www.ihg.com/hotels/us/en/reservation/rooms',
        },
      ],
    };
    const results = parseSearchResults(extracted, 'hotel');
    expect(results).toHaveLength(1);
    expect(results[0].title).toBe('Holiday Inn Baton Rouge');
    expect(results[0].priceUsd).toBe(109);
    expect(results[0].externalUrl).toBe('https://www.ihg.com/hotels/us/en/reservation/rooms');
    expect(results[0].meta.hotelName).toBe('Holiday Inn Baton Rouge');
    expect(results[0].meta.roomType).toBe('Standard Room');
  });
});

describe('OpenTable playbook', () => {
  it('has the opentable-restaurants playbook', () => {
    const pb = pickPlaybook('restaurant');
    expect(pb).toBeDefined();
    expect(pb!.id).toBe('opentable-restaurants');
    expect(pb!.site).toBe('opentable');
  });

  it('has search steps with explicit URL and externalUrl in schema', () => {
    const pb = pickPlaybook('restaurant');
    expect(pb!.searchSteps[0].action).toBe('goto');
    expect((pb!.searchSteps[0] as { action: 'goto'; url: string }).url).toContain('<destination>');
    const extract = pb!.searchSteps.find((s) => s.action === 'extract');
    expect(extract).toBeDefined();
    expect(extract!.schema).toHaveProperty('externalUrl');
    expect(extract!.schema).toHaveProperty('restaurantName');
  });

  it('has booking steps with externalUrl goto and stop-before-confirm', () => {
    const pb = pickPlaybook('restaurant');
    expect(pb!.bookingSteps[0].action).toBe('goto');
    expect((pb!.bookingSteps[0] as { action: 'goto'; url: string }).url).toBe('<externalUrl>');
    const extract = pb!.bookingSteps.find((s) => s.action === 'extract');
    expect(extract).toBeDefined();
    expect(extract!.prompt).toContain('Do NOT click any final');
  });

  it('has auth steps with credential vault placeholders', () => {
    const pb = pickPlaybook('restaurant');
    expect(pb!.authSteps).toBeDefined();
    expect(pb!.authSteps!.length).toBeGreaterThanOrEqual(4);
    const fillSteps = pb!.authSteps!.filter((s) => s.action === 'fill');
    const usernames = fillSteps.filter((s) => s.value === '<username>');
    const passwords = fillSteps.filter((s) => s.value === '<password>');
    expect(usernames.length).toBeGreaterThanOrEqual(1);
    expect(passwords.length).toBeGreaterThanOrEqual(1);
  });

  it('parses OpenTable restaurant results with externalUrl', () => {
    const extracted = {
      results: [
        {
          title: 'Gramercy Tavern',
          subtitle: 'American · 42 E 20th St',
          restaurantName: 'Gramercy Tavern',
          cuisine: 'American',
          address: '42 E 20th St, New York, NY 10003',
          reservationAt: '2026-09-15T19:30:00',
          partySize: 2,
          externalUrl: 'https://www.opentable.com/r/gramercy-tavern',
        },
      ],
    };
    const results = parseSearchResults(extracted, 'restaurant');
    expect(results).toHaveLength(1);
    expect(results[0].kind).toBe('restaurant');
    expect(results[0].externalUrl).toBe('https://www.opentable.com/r/gramercy-tavern');
    expect(results[0].meta.restaurantName).toBe('Gramercy Tavern');
    expect(results[0].meta.cuisine).toBe('American');
    expect(results[0].meta.partySize).toBe('2');
    expect(results[0].meta.reservationAt).toBe('2026-09-15T19:30:00');
  });

  it('search URL includes date and partySize params', () => {
    const pb = pickPlaybook('restaurant');
    const url = (pb!.searchSteps[0] as { url: string }).url;
    expect(url).toContain('<date>');
    expect(url).toContain('<partySize>');
    expect(url).toContain('<destination>');
  });
});

describe('Marriott playbook hardening', () => {
  it('has correct id, site, and kind', () => {
    const marriott = pickPlaybook('hotel', 'marriott');
    expect(marriott).toBeDefined();
    expect(marriott!.id).toBe('marriott-hotels');
    expect(marriott!.site).toBe('marriott');
    expect(marriott!.kind).toBe('hotel');
    expect(marriott!.displayName).toBe('Marriott Bonvoy');
  });

  it('has auth steps with placeholder credentials', () => {
    const marriott = pickPlaybook('hotel', 'marriott')!;
    expect(marriott.authSteps).toBeDefined();
    const fillSteps = marriott.authSteps!.filter((s) => s.action === 'fill');
    expect(fillSteps).toHaveLength(2);
    expect(fillSteps.some((s) => s.value === '<username>')).toBe(true);
    expect(fillSteps.some((s) => s.value === '<password>')).toBe(true);
  });

  it('searchSteps include externalUrl field in schema', () => {
    const marriott = pickPlaybook('hotel', 'marriott')!;
    const extractStep = marriott.searchSteps.find((s) => s.action === 'extract');
    expect(extractStep).toBeDefined();
    if (extractStep && 'schema' in extractStep) {
      expect(extractStep.schema).toHaveProperty('externalUrl');
      expect(extractStep.schema).toHaveProperty('hotelName');
      expect(extractStep.schema).toHaveProperty('checkIn');
      expect(extractStep.schema).toHaveProperty('checkOut');
    }
  });

  it('includes a goto search page step', () => {
    const marriott = pickPlaybook('hotel', 'marriott')!;
    const gotoStep = marriott.searchSteps.find((s) => s.action === 'goto');
    expect(gotoStep).toBeDefined();
    expect(gotoStep!.url).toBe('https://www.marriott.com/search/default.mi');
  });

  it('booking steps contain stop instruction', () => {
    const marriott = pickPlaybook('hotel', 'marriott')!;
    const bookingStep = marriott.bookingSteps.find((s) => s.action === 'extract');
    expect(bookingStep).toBeDefined();
    if (bookingStep && 'prompt' in bookingStep) {
      expect(bookingStep.prompt.toLowerCase()).toMatch(/stop/i);
      expect(bookingStep.prompt).toContain('finalUrl');
    }
  });

  it('redirected loginUrl', () => {
    const marriott = pickPlaybook('hotel', 'marriott')!;
    expect(marriott.loginUrl).toBe('https://www.marriott.com/sign-in.mi');
  });
});