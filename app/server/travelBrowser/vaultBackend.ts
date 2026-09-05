/**
 * Pluggable backends for the browser-automation credential vault.
 *
 * The file backend (`FileVaultBackend`) is the default and preserves the
 * existing AES-256-GCM encrypted JSON vault on disk.
 *
 * Password-manager backends delegate storage to external vaults:
 * - OnePasswordVaultBackend: 1Password CLI (`op`)
 * - BitwardenVaultBackend:    Bitwarden CLI (`bw`)
 * - KeyringVaultBackend:      Python `keyring` module (macOS Keychain,
 *                             Linux Secret Service, Windows Credential Vault)
 *
 * All backends implement the same `VaultBackend` interface so
 * `CredentialVault` can wrap or delegate to any of them.
 */
import { createCipheriv, createDecipheriv, randomBytes, pbkdf2Sync, scryptSync } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, mkdirSync, chmodSync } from 'node:fs';
import { dirname } from 'node:path';
import { execSync } from 'node:child_process';
import type { SiteCredential } from './vault.ts';

const VAULT_VERSION = 1;
const KEY_LEN = 32;
const IV_LEN = 16;

export interface VaultSiteSummary {
  site: string;
  hasUsername: boolean;
  username?: string;
  hasPassword: boolean;
  hasTotp: boolean;
  notes?: string;
  updatedAt: string;
}

export interface VaultBackend {
  /** List all stored sites without returning secrets. */
  list(): VaultSiteSummary[];
  /** Get a site's encrypted credential record (no decrypted secrets). */
  get(site: string): SiteCredential | null;
  /** Get a site with decrypted password/TOTP seed. */
  getDecrypted(site: string): (SiteCredential & { password?: string; totpSeed?: string }) | null;
  /** Store or update a site's credentials. */
  set(site: string, input: { username?: string; password?: string; totpSeed?: string; notes?: string }): void;
  /** Remove a site. Returns true if it existed. */
  remove(site: string): boolean;
  /** Return true if the site exists. */
  has(site: string): boolean;
}

function deriveKey(password: string, salt: Buffer): Buffer {
  try {
    return scryptSync(password, salt, KEY_LEN);
  } catch {
    return pbkdf2Sync(password, salt, 600000, KEY_LEN, 'sha512');
  }
}

function encryptJson(key: Buffer, plaintext: object): VaultFile {
  const salt = randomBytes(16);
  const iv = randomBytes(IV_LEN);
  const derived = deriveKey(key.toString('base64'), salt);
  const cipher = createCipheriv('aes-256-gcm', derived, iv);
  const json = JSON.stringify(plaintext);
  const ciphertext = Buffer.concat([cipher.update(json, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    version: VAULT_VERSION,
    salt: salt.toString('base64'),
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
    ciphertext: ciphertext.toString('base64'),
  };
}

function decryptJson<T>(key: Buffer, file: VaultFile): T {
  if (file.version !== VAULT_VERSION) {
    throw new Error(`Unsupported vault version ${file.version}`);
  }
  const salt = Buffer.from(file.salt, 'base64');
  const iv = Buffer.from(file.iv, 'base64');
  const tag = Buffer.from(file.tag, 'base64');
  const ciphertext = Buffer.from(file.ciphertext, 'base64');
  const derived = deriveKey(key.toString('base64'), salt);
  const decipher = createDecipheriv('aes-256-gcm', derived, iv);
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return JSON.parse(plaintext.toString('utf8')) as T;
}

function encryptField(key: Buffer, value: string): string {
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('base64')}:${tag.toString('base64')}:${ciphertext.toString('base64')}`;
}

function decryptField(key: Buffer, cipherText: string): string {
  const [ivB64, tagB64, ciphertextB64] = cipherText.split(':');
  if (!ivB64 || !tagB64 || !ciphertextB64) throw new Error('Invalid field cipher');
  const iv = Buffer.from(ivB64, 'base64');
  const tag = Buffer.from(tagB64, 'base64');
  const ciphertext = Buffer.from(ciphertextB64, 'base64');
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}

interface VaultFile {
  version: 1;
  salt: string; // base64
  iv: string; // base64
  tag: string; // base64
  ciphertext: string; // base64
}

/**
 * Default encrypted file backend.
 * Stores credentials in a single AES-256-GCM encrypted JSON file.
 */
export class FileVaultBackend implements VaultBackend {
  private readonly filePath: string;
  private readonly key: Buffer;
  private credentials: SiteCredential[] = [];
  private loaded = false;

  constructor(key: Buffer, filePath: string) {
    if (key.length !== KEY_LEN) {
      throw new Error(`Vault key must be ${KEY_LEN} bytes`);
    }
    this.key = key;
    this.filePath = filePath;
  }

  private ensureLoaded(): void {
    if (!this.loaded) this.unlock();
  }

  private unlock(): void {
    if (!existsSync(this.filePath)) {
      this.credentials = [];
      this.loaded = true;
      return;
    }
    const raw = readFileSync(this.filePath, 'utf8');
    const file = JSON.parse(raw) as VaultFile;
    this.credentials = decryptJson<SiteCredential[]>(this.key, file);
    this.loaded = true;
  }

  private save(): void {
    mkdirSync(dirname(this.filePath), { recursive: true });
    const file = encryptJson(this.key, this.credentials);
    writeFileSync(this.filePath, JSON.stringify(file), { mode: 0o600 });
    try {
      chmodSync(this.filePath, 0o600);
    } catch {
      // ignore on filesystems that don't support chmod
    }
  }

  list(): VaultSiteSummary[] {
    this.ensureLoaded();
    return this.credentials.map(({ site, username, notes, updatedAt, passwordCipher, totpSeedCipher }) => ({
      site,
      hasUsername: !!username,
      username,
      notes,
      updatedAt,
      hasPassword: !!passwordCipher,
      hasTotp: !!totpSeedCipher,
    }));
  }

  get(site: string): SiteCredential | null {
    this.ensureLoaded();
    const cred = this.credentials.find((c) => c.site === site);
    return cred ? { ...cred } : null;
  }

  getDecrypted(site: string): (SiteCredential & { password?: string; totpSeed?: string }) | null {
    const cred = this.get(site);
    if (!cred) return null;
    const out: SiteCredential & { password?: string; totpSeed?: string } = { ...cred };
    if (cred.passwordCipher) out.password = decryptField(this.key, cred.passwordCipher);
    if (cred.totpSeedCipher) out.totpSeed = decryptField(this.key, cred.totpSeedCipher);
    return out;
  }

  set(site: string, input: { username?: string; password?: string; totpSeed?: string; notes?: string }): void {
    this.ensureLoaded();
    const idx = this.credentials.findIndex((c) => c.site === site);
    const updatedAt = new Date().toISOString();
    const entry: SiteCredential = {
      site,
      username: input.username,
      notes: input.notes,
      updatedAt,
    };
    if (input.password) entry.passwordCipher = encryptField(this.key, input.password);
    if (input.totpSeed) entry.totpSeedCipher = encryptField(this.key, input.totpSeed);
    if (idx >= 0) {
      this.credentials[idx] = entry;
    } else {
      this.credentials.push(entry);
    }
    this.save();
  }

  remove(site: string): boolean {
    this.ensureLoaded();
    const before = this.credentials.length;
    this.credentials = this.credentials.filter((c) => c.site !== site);
    if (this.credentials.length !== before) {
      this.save();
      return true;
    }
    return false;
  }

  has(site: string): boolean {
    this.ensureLoaded();
    return this.credentials.some((c) => c.site === site);
  }
}

/** Helpers shared by CLI-based password-manager backends. */
function opItemTitle(site: string): string {
  return `eaios-travel:${site}`;
}

function runCli(command: string, input?: string): string {
  try {
    return execSync(command, {
      encoding: 'utf8',
      input,
      timeout: 30000,
      env: { ...process.env, OP_FORMAT: 'json' },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Password manager CLI failed: ${message}`);
  }
}

interface CliBackendOptions {
  /** Override the CLI binary path. */
  binaryPath?: string;
  /** Optional vault/account selector (1Password vault, Bitwarden organization). */
  vaultSelector?: string;
}

/**
 * 1Password CLI backend.
 *
 * Stores each site as a 1Password "Login" item titled `eaios-travel:<site>`.
 * Requires the 1Password CLI (`op`) to be installed and signed in.
 *
 * Env configuration:
 *   OP_CLI_BIN       - path to `op` binary (default: `op` on PATH)
 *   OP_VAULT         - vault name/UUID to scope reads/writes
 */
export class OnePasswordVaultBackend implements VaultBackend {
  private readonly binary: string;
  private readonly vault?: string;

  constructor(options: CliBackendOptions = {}) {
    this.binary = options.binaryPath ?? process.env.OP_CLI_BIN ?? 'op';
    this.vault = options.vaultSelector ?? process.env.OP_VAULT;
  }

  private vaultFlag(): string {
    return this.vault ? `--vault=${this.vault}` : '';
  }

  private listTitles(): string[] {
    const out = runCli(`${this.binary} item list --categories=Login --format=json ${this.vaultFlag()}`);
    const items = JSON.parse(out || '[]') as Array<{ title: string }>;
    return items.map((i) => i.title).filter((t) => t.startsWith('eaios-travel:'));
  }

  private getItem(site: string): Record<string, unknown> | null {
    try {
      const title = opItemTitle(site);
      const out = runCli(`${this.binary} item get "${title}" --format=json ${this.vaultFlag()}`);
      return JSON.parse(out) as Record<string, unknown>;
    } catch {
      return null;
    }
  }

  private static getField(item: Record<string, unknown>, label: string): string | undefined {
    const fields = (item.fields ?? []) as Array<{ label?: string; value?: string }>;
    return fields.find((f) => f.label === label)?.value;
  }

  private static toSummary(site: string, item: Record<string, unknown>): VaultSiteSummary {
    const username = OnePasswordVaultBackend.getField(item, 'username');
    const password = OnePasswordVaultBackend.getField(item, 'password');
    const totpSeed = OnePasswordVaultBackend.getField(item, 'TOTP seed');
    const notes = OnePasswordVaultBackend.getField(item, 'notes');
    const updatedAt = typeof item.updated_at === 'string' ? item.updated_at : new Date().toISOString();
    return {
      site,
      hasUsername: !!username,
      username,
      hasPassword: !!password,
      hasTotp: !!totpSeed,
      notes,
      updatedAt,
    };
  }

  list(): VaultSiteSummary[] {
    const titles = this.listTitles();
    return titles.map((t) => {
      const site = t.slice('eaios-travel:'.length);
      const item = this.getItem(site);
      return item ? OnePasswordVaultBackend.toSummary(site, item) : { site, hasUsername: false, hasPassword: false, hasTotp: false, updatedAt: '' };
    });
  }

  get(site: string): SiteCredential | null {
    const item = this.getItem(site);
    if (!item) return null;
    const summary = OnePasswordVaultBackend.toSummary(site, item);
    const cred: SiteCredential = {
      site,
      username: summary.username,
      notes: summary.notes,
      updatedAt: summary.updatedAt,
    };
    if (summary.hasPassword) cred.passwordCipher = 'op:managed';
    if (summary.hasTotp) cred.totpSeedCipher = 'op:managed';
    return cred;
  }

  getDecrypted(site: string): (SiteCredential & { password?: string; totpSeed?: string }) | null {
    const item = this.getItem(site);
    if (!item) return null;
    const cred: SiteCredential & { password?: string; totpSeed?: string } = {
      site,
      username: OnePasswordVaultBackend.getField(item, 'username'),
      notes: OnePasswordVaultBackend.getField(item, 'notes'),
      updatedAt: typeof item.updated_at === 'string' ? item.updated_at : new Date().toISOString(),
    };
    const password = OnePasswordVaultBackend.getField(item, 'password');
    const totpSeed = OnePasswordVaultBackend.getField(item, 'TOTP seed');
    if (password) cred.password = password;
    if (totpSeed) cred.totpSeed = totpSeed;
    return cred;
  }

  set(site: string, input: { username?: string; password?: string; totpSeed?: string; notes?: string }): void {
    const title = opItemTitle(site);
    const existing = this.getItem(site);
    const fields: Array<{ label: string; value: string; type?: string }> = [];
    if (input.username) fields.push({ label: 'username', value: input.username, type: 'STRING' });
    if (input.password) fields.push({ label: 'password', value: input.password, type: 'CONCEALED' });
    if (input.totpSeed) fields.push({ label: 'TOTP seed', value: input.totpSeed, type: 'CONCEALED' });
    if (input.notes) fields.push({ label: 'notes', value: input.notes, type: 'STRING' });

    const payload = {
      title,
      category: 'LOGIN',
      fields,
    };

    if (existing) {
      runCli(`${this.binary} item edit "${title}" --format=json ${this.vaultFlag()}`, JSON.stringify(payload));
    } else {
      runCli(`${this.binary} item create --format=json ${this.vaultFlag()}`, JSON.stringify(payload));
    }
  }

  remove(site: string): boolean {
    if (!this.getItem(site)) return false;
    const title = opItemTitle(site);
    runCli(`${this.binary} item delete "${title}" ${this.vaultFlag()}`);
    return true;
  }

  has(site: string): boolean {
    return this.getItem(site) !== null;
  }
}

/**
 * Bitwarden CLI backend.
 *
 * Stores each site as a Bitwarden secure note or login item named
 * `eaios-travel:<site>`. Requires the Bitwarden CLI (`bw`) to be installed
 * and unlocked (`bw unlock`).
 *
 * Env configuration:
 *   BW_CLI_BIN       - path to `bw` binary (default: `bw` on PATH)
 *   BW_SESSION       - base64 session key (standard bw env var)
 */
export class BitwardenVaultBackend implements VaultBackend {
  private readonly binary: string;

  constructor(options: CliBackendOptions = {}) {
    this.binary = options.binaryPath ?? process.env.BW_CLI_BIN ?? 'bw';
  }

  private listItems(): Array<{ id: string; name: string; notes?: string; login?: { username?: string; password?: string } }> {
    const out = runCli(`${this.binary} list items`);
    return (JSON.parse(out || '[]') as Array<Record<string, unknown>>)
      .filter((i) => typeof i.name === 'string' && i.name.startsWith('eaios-travel:'))
      .map((i) => ({
        id: String(i.id ?? ''),
        name: String(i.name ?? ''),
        notes: typeof i.notes === 'string' ? i.notes : undefined,
        login: i.login as { username?: string; password?: string } | undefined,
      }));
  }

  private findItem(site: string) {
    const name = opItemTitle(site);
    return this.listItems().find((i) => i.name === name) ?? null;
  }

  list(): VaultSiteSummary[] {
    return this.listItems().map((i) => {
      const site = i.name.slice('eaios-travel:'.length);
      const raw = i.notes ? (JSON.parse(i.notes) as Record<string, string>) : {};
      return {
        site,
        hasUsername: !!i.login?.username || !!raw.username,
        username: i.login?.username ?? raw.username,
        hasPassword: !!i.login?.password || !!raw.password,
        hasTotp: !!raw.totpSeed,
        notes: raw.notes,
        updatedAt: raw.updatedAt ?? new Date().toISOString(),
      };
    });
  }

  get(site: string): SiteCredential | null {
    const item = this.findItem(site);
    if (!item) return null;
    const raw = item.notes ? (JSON.parse(item.notes) as Record<string, string>) : {};
    const cred: SiteCredential = {
      site,
      username: item.login?.username ?? raw.username,
      notes: raw.notes,
      updatedAt: raw.updatedAt ?? new Date().toISOString(),
    };
    if (item.login?.password || raw.password) cred.passwordCipher = 'bw:managed';
    if (raw.totpSeed) cred.totpSeedCipher = 'bw:managed';
    return cred;
  }

  getDecrypted(site: string): (SiteCredential & { password?: string; totpSeed?: string }) | null {
    const item = this.findItem(site);
    if (!item) return null;
    const raw = item.notes ? (JSON.parse(item.notes) as Record<string, string>) : {};
    return {
      site,
      username: item.login?.username ?? raw.username,
      password: item.login?.password ?? raw.password,
      totpSeed: raw.totpSeed,
      notes: raw.notes,
      updatedAt: raw.updatedAt ?? new Date().toISOString(),
    };
  }

  set(site: string, input: { username?: string; password?: string; totpSeed?: string; notes?: string }): void {
    const name = opItemTitle(site);
    const updatedAt = new Date().toISOString();
    const notes = JSON.stringify({
      ...(input.totpSeed ? { totpSeed: input.totpSeed } : {}),
      ...(input.notes ? { notes: input.notes } : {}),
      updatedAt,
    });
    const existing = this.findItem(site);
    const payload = {
      type: 1, // login
      name,
      notes,
      login: {
        username: input.username ?? '',
        password: input.password ?? '',
      },
      secureNote: null,
      card: null,
      identity: null,
    };

    if (existing?.id) {
      runCli(`${this.binary} edit item ${existing.id}`, JSON.stringify({ ...payload, id: existing.id }));
    } else {
      runCli(`${this.binary} create item`, JSON.stringify(payload));
    }
  }

  remove(site: string): boolean {
    const item = this.findItem(site);
    if (!item?.id) return false;
    runCli(`${this.binary} delete item ${item.id}`);
    return true;
  }

  has(site: string): boolean {
    return this.findItem(site) !== null;
  }
}

/**
 * OS-native keyring backend via the Python `keyring` module.
 *
 * Uses one keyring entry per site:
 *   service  = `eaios-travel`
 *   username = `<site>` (e.g. `opentable`)
 *   password = JSON blob with username, password, totpSeed, notes, updatedAt
 *
 * Supports macOS Keychain, Linux Secret Service (GNOME/KDE), and Windows
 * Credential Vault through the `keyring` abstraction.
 *
 * Env configuration:
 *   KEYRING_PYTHON     - path to Python interpreter with `keyring` installed
 *                        (default: `python3` on PATH)
 */
export class KeyringVaultBackend implements VaultBackend {
  private readonly python: string;

  constructor(options: { pythonPath?: string } = {}) {
    this.python = options.pythonPath ?? process.env.KEYRING_PYTHON ?? 'python3';
  }

  private runScript(script: string): string {
    return runCli(`${this.python} -c "${script}"`);
  }

  private getPassword(site: string): Record<string, string> | null {
    const script = `
import keyring, json
v = keyring.get_password('eaios-travel', ${JSON.stringify(site)})
print(v if v else '')
`;
    const out = this.runScript(script).trim();
    if (!out) return null;
    try {
      return JSON.parse(out) as Record<string, string>;
    } catch {
      return null;
    }
  }

  private setPassword(site: string, payload: Record<string, string>): void {
    const json = JSON.stringify(payload);
    const script = `
import keyring
keyring.set_password('eaios-travel', ${JSON.stringify(site)}, ${JSON.stringify(json)})
`;
    this.runScript(script);
  }

  private deletePassword(site: string): void {
    const script = `
import keyring
keyring.delete_password('eaios-travel', ${JSON.stringify(site)})
`;
    this.runScript(script);
  }

  private listSites(): string[] {
    const script = `
import keyring
print('\\n'.join(keyring.get_credential('eaios-travel', '') or []))
`;
    // keyring has no universal list-by-service API, so we rely on the site
    // being known via the backend-specific listing when available.
    try {
      const out = this.runScript(script).trim();
      return out ? out.split('\n') : [];
    } catch {
      return [];
    }
  }

  list(): VaultSiteSummary[] {
    // Best-effort: keyring backends do not all support service enumeration.
    // Return whatever we can discover.
    const sites = this.listSites();
    return sites.map((site) => {
      const raw = this.getPassword(site) ?? {};
      return {
        site,
        hasUsername: !!raw.username,
        username: raw.username,
        hasPassword: !!raw.password,
        hasTotp: !!raw.totpSeed,
        notes: raw.notes,
        updatedAt: raw.updatedAt ?? new Date().toISOString(),
      };
    });
  }

  get(site: string): SiteCredential | null {
    const raw = this.getPassword(site);
    if (!raw) return null;
    const cred: SiteCredential = {
      site,
      username: raw.username,
      notes: raw.notes,
      updatedAt: raw.updatedAt ?? new Date().toISOString(),
    };
    if (raw.password) cred.passwordCipher = 'keyring:managed';
    if (raw.totpSeed) cred.totpSeedCipher = 'keyring:managed';
    return cred;
  }

  getDecrypted(site: string): (SiteCredential & { password?: string; totpSeed?: string }) | null {
    const raw = this.getPassword(site);
    if (!raw) return null;
    return {
      site,
      username: raw.username,
      password: raw.password,
      totpSeed: raw.totpSeed,
      notes: raw.notes,
      updatedAt: raw.updatedAt ?? new Date().toISOString(),
    };
  }

  set(site: string, input: { username?: string; password?: string; totpSeed?: string; notes?: string }): void {
    const existing = this.getPassword(site) ?? {};
    const updatedAt = new Date().toISOString();
    this.setPassword(site, {
      ...(input.username ? { username: input.username } : existing.username ? { username: existing.username } : {}),
      ...(input.password ? { password: input.password } : existing.password ? { password: existing.password } : {}),
      ...(input.totpSeed ? { totpSeed: input.totpSeed } : existing.totpSeed ? { totpSeed: existing.totpSeed } : {}),
      ...(input.notes ? { notes: input.notes } : existing.notes ? { notes: existing.notes } : {}),
      updatedAt,
    });
  }

  remove(site: string): boolean {
    if (!this.getPassword(site)) return false;
    this.deletePassword(site);
    return true;
  }

  has(site: string): boolean {
    return this.getPassword(site) !== null;
  }
}

/** Backend selection env vars and factory. */
export interface BackendSelection {
  backend: VaultBackend;
  kind: 'file' | '1password' | 'bitwarden' | 'keyring';
}

/**
 * Create a backend based on environment configuration.
 *
 * Priority:
 *   TRAVEL_BROWSER_VAULT_BACKEND=1password  -> OnePasswordVaultBackend
 *   TRAVEL_BROWSER_VAULT_BACKEND=bitwarden  -> BitwardenVaultBackend
 *   TRAVEL_BROWSER_VAULT_BACKEND=keyring    -> KeyringVaultBackend
 *   otherwise                               -> FileVaultBackend
 *
 * The file backend still requires a 32-byte key; password-manager backends
 * ignore the supplied key and use their own authentication.
 */
export function createVaultBackend(key: Buffer, filePath: string): BackendSelection {
  const kind = (process.env.TRAVEL_BROWSER_VAULT_BACKEND ?? 'file').toLowerCase();
  switch (kind) {
    case '1password':
    case 'op':
      return { backend: new OnePasswordVaultBackend(), kind: '1password' };
    case 'bitwarden':
    case 'bw':
      return { backend: new BitwardenVaultBackend(), kind: 'bitwarden' };
    case 'keyring':
    case 'os':
      return { backend: new KeyringVaultBackend(), kind: 'keyring' };
    default:
      return { backend: new FileVaultBackend(key, filePath), kind: 'file' };
  }
}
