/**
 * Public API for browser-automation travel booking.
 *
 * Encapsulates credential vault, encrypted cookie sessions, per-site
 * playbooks, and the Python browser-use runner bridge.
 */
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { TravelSearchParams, TravelSearchResult } from '../../src/adapters/interfaces.ts';
import { CredentialVault } from './vault.ts';
import { SessionStore } from './sessions.ts';
import { pickPlaybook, listPlaybooks, type PlaybookKind, type Playbook } from './playbooks.ts';
import { buildSearchJob, buildBookingJob, parseSearchResults, runBrowserJob, type BrowserRunResult } from './runner.ts';

export type { Playbook, PlaybookKind } from './playbooks.ts';
export type { SiteCredential } from './vault.ts';
export type { BrowserRunResult } from './runner.ts';

const DEFAULT_DATA_DIR = join(homedir(), '.hermes/eaios');

function dataDir(): string {
  return process.env.TRAVEL_BROWSER_DATA_DIR ?? DEFAULT_DATA_DIR;
}

function vaultPath(): string {
  return join(dataDir(), 'travel-browser-vault.enc');
}

function sessionsPath(): string {
  return join(dataDir(), 'travel-browser-sessions.enc');
}

function getVaultKey(): Buffer | null {
  const b64 = process.env.TRAVEL_BROWSER_VAULT_KEY;
  if (!b64) return null;
  try {
    return CredentialVault.fromBase64Key(b64, vaultPath()).key;
  } catch {
    return null;
  }
}

function getVault(): CredentialVault | null {
  const key = getVaultKey();
  if (!key) return null;
  return CredentialVault.createFromEnv(key, vaultPath()).vault;
}

function getSessionStore(): SessionStore | null {
  const key = getVaultKey();
  if (!key) return null;
  return SessionStore.fromVaultKey(key, sessionsPath());
}

export interface BrowserStatus {
  enabled: boolean;
  chromeBin?: string;
  vaultUnlocked: boolean;
  configuredSites: string[];
  sessionSites: string[];
  playbooks: { id: string; site: string; kind: PlaybookKind; displayName: string }[];
}

export function getBrowserStatus(): BrowserStatus {
  const enabled = !!process.env.TRAVEL_BROWSER_USE && !!process.env.CHROME_BIN;
  const vault = getVault();
  const sessions = getSessionStore();
  return {
    enabled,
    chromeBin: process.env.CHROME_BIN,
    vaultUnlocked: vault !== null,
    configuredSites: vault ? vault.list().map((c) => c.site) : [],
    sessionSites: sessions ? sessions.list().map((s) => s.site) : [],
    playbooks: listPlaybooks().map((p) => ({ id: p.id, site: p.site, kind: p.kind, displayName: p.displayName })),
  };
}

export interface SearchOptions {
  params: TravelSearchParams;
  preferredSite?: string;
  chromeBin?: string;
}

export async function searchBrowserUse(options: SearchOptions): Promise<TravelSearchResult[]> {
  const kind = options.params.kind;
  if (kind !== 'hotel' && kind !== 'car' && kind !== 'restaurant') {
    throw new Error(`Browser-use provider does not support search kind: ${kind}`);
  }

  const playbook = pickPlaybook(kind, options.preferredSite);
  if (!playbook) {
    throw new Error(`No playbook registered for ${kind}`);
  }

  const vault = getVault();
  if (!vault) {
    throw new Error('Browser-use vault is locked: set TRAVEL_BROWSER_VAULT_KEY');
  }

  const sessions = getSessionStore();
  const cookies = sessions ? sessions.getCookies(playbook.site) : [];

  // If we have credentials but no session, run auth steps first (best-effort).
  if (cookies.length === 0 && playbook.authSteps && vault.has(playbook.site)) {
    const cred = vault.getDecrypted(playbook.site);
    if (cred?.username && cred?.password) {
      const authTask = buildAuthTask(playbook, cred.username, cred.password);
      const authJob = {
        task: authTask,
        chromeBin: options.chromeBin ?? process.env.CHROME_BIN,
        headless: true,
        cookies: [],
        llm: {
          provider: process.env.BROWSER_USE_LLM_PROVIDER ?? 'openrouter',
          model: process.env.BROWSER_USE_LLM_MODEL ?? 'deepseek/deepseek-v4-flash',
          apiKey: process.env.OPENROUTER_API_KEY,
        },
      };
      const authResult = await runBrowserJob(authJob);
      if (authResult.ok && authResult.finalUrl && sessions) {
        // We cannot read cookies directly from the runner today; the runner
        // persists via storage_state. Future: pass cookie jar back.
        sessions.setCookies(playbook.site, []);
      }
    }
  }

  const job = buildSearchJob(playbook, options.params, cookies, options.chromeBin ?? process.env.CHROME_BIN);
  const result = await runBrowserJob(job);
  if (!result.ok) {
    throw new Error(result.error ?? 'Browser-use search failed');
  }
  return parseSearchResults(result.extracted ?? result.answer, kind);
}

function buildAuthTask(playbook: Playbook, username: string, password: string): string {
  const parts: string[] = [];
  parts.push(`Log in to ${playbook.displayName}.`);
  if (!playbook.authSteps) {
    parts.push(`Go to ${playbook.loginUrl ?? playbook.searchUrl}, enter username "${username}" and the provided password, and sign in.`);
    return parts.join('\n');
  }
  for (const step of playbook.authSteps) {
    if (step.action === 'goto') parts.push(`Go to ${step.url}.`);
    else if (step.action === 'fill') {
      const value = step.value === '<username>' ? username : step.value === '<password>' ? password : step.value;
      parts.push(`Fill "${step.selector}" with "${value}".`);
    } else if (step.action === 'click') parts.push(`Click "${step.selector}".`);
    else if (step.action === 'wait') parts.push(`Wait ${step.ms}ms.`);
  }
  return parts.join('\n');
}

export interface BookingOptions {
  params: TravelSearchParams;
  result: TravelSearchResult;
  preferredSite?: string;
  chromeBin?: string;
}

export interface BookingExecution {
  ok: boolean;
  finalUrl?: string;
  confirmationNumber?: string;
  screenshot?: string;
  error?: string;
  logs: BrowserRunResult['logs'];
}

export async function executeBooking(options: BookingOptions): Promise<BookingExecution> {
  const kind = options.params.kind;
  if (kind !== 'hotel' && kind !== 'car' && kind !== 'restaurant') {
    return { ok: false, error: `Unsupported booking kind: ${kind}`, logs: [] };
  }

  const playbook = pickPlaybook(kind, options.preferredSite);
  if (!playbook) {
    return { ok: false, error: `No playbook registered for ${kind}`, logs: [] };
  }

  const sessions = getSessionStore();
  const cookies = sessions ? sessions.getCookies(playbook.site) : [];
  const job = buildBookingJob(playbook, options.params, options.result, cookies, options.chromeBin ?? process.env.CHROME_BIN);
  const result = await runBrowserJob(job);

  if (!result.ok) {
    return { ok: false, error: result.error ?? 'Browser booking failed', logs: result.logs };
  }

  const extracted = (result.extracted ?? {}) as Record<string, unknown>;
  return {
    ok: true,
    finalUrl: result.finalUrl ?? (typeof extracted.finalUrl === 'string' ? extracted.finalUrl : undefined),
    confirmationNumber: typeof extracted.confirmationNumber === 'string' ? extracted.confirmationNumber : undefined,
    screenshot: result.screenshot,
    logs: result.logs,
  };
}

// ---------- Vault management ----------

interface VaultSiteSummary {
  site: string;
  hasUsername: boolean;
  hasPassword: boolean;
  hasTotp: boolean;
  notes?: string;
  updatedAt: string;
}

export function listVaultSites(): VaultSiteSummary[] {
  const vault = getVault();
  if (!vault) return [];
  return vault.list().map((c) => ({
    site: c.site,
    hasUsername: c.hasUsername,
    hasPassword: c.hasPassword,
    hasTotp: c.hasTotp,
    notes: c.notes,
    updatedAt: c.updatedAt,
  }));
}

export function getVaultSite(site: string): VaultSiteSummary | null {
  const vault = getVault();
  if (!vault) return null;
  const c = vault.get(site);
  if (!c) return null;
  return {
    site: c.site,
    hasUsername: !!c.username,
    hasPassword: !!c.passwordCipher,
    hasTotp: !!c.totpSeedCipher,
    notes: c.notes,
    updatedAt: c.updatedAt,
  };
}

export function setVaultSite(site: string, cred: { username?: string; password?: string; totpSeed?: string; notes?: string }): void {
  const vault = getVault();
  if (!vault) throw new Error('Vault locked');
  vault.set(site, cred);
}

export function removeVaultSite(site: string): boolean {
  const vault = getVault();
  if (!vault) throw new Error('Vault locked');
  return vault.remove(site);
}
