/**
 * Encrypted credential vault for browser-automation travel booking.
 *
 * This module is the public face of credential storage. The actual persistence
 * is delegated to a `VaultBackend` implementation:
 *
 * - FileVaultBackend (default): AES-256-GCM encrypted JSON file.
 * - OnePasswordVaultBackend:    1Password CLI (`op`).
 * - BitwardenVaultBackend:      Bitwarden CLI (`bw`).
 * - KeyringVaultBackend:        Python `keyring` / OS-native secret stores.
 *
 * Use `CredentialVault.createFromEnv()` to pick the backend automatically, or
 * inject a backend with `CredentialVault.withBackend()` for tests.
 */
import { randomBytes, pbkdf2Sync, scryptSync } from 'node:crypto';
import type { VaultBackend, VaultSiteSummary } from './vaultBackend.ts';
import { FileVaultBackend, createVaultBackend } from './vaultBackend.ts';

const KEY_LEN = 32;

export interface SiteCredential {
  site: string;
  username?: string;
  /** Encrypted password ciphertext (base64) or backend sentinel. */
  passwordCipher?: string;
  /** Encrypted TOTP seed ciphertext (base64) or backend sentinel. */
  totpSeedCipher?: string;
  /** Plain notes (not sensitive). */
  notes?: string;
  updatedAt: string;
}

export class CredentialVault {
  readonly key: Buffer;
  private readonly backend: VaultBackend;

  /** Construct a file-backed vault (backward-compatible). */
  constructor(key: Buffer, filePath: string) {
    if (key.length !== KEY_LEN) {
      throw new Error(`Vault key must be ${KEY_LEN} bytes`);
    }
    this.key = key;
    this.backend = new FileVaultBackend(key, filePath);
  }

  /** Wrap an arbitrary backend (used by factories and tests). */
  static withBackend(key: Buffer, backend: VaultBackend): CredentialVault {
    const vault = new CredentialVault(key, '/dev/null');
    (vault as unknown as { backend: VaultBackend }).backend = backend;
    return vault;
  }

  static fromBase64Key(base64Key: string, filePath: string): CredentialVault {
    const key = Buffer.from(base64Key, 'base64');
    if (key.length !== KEY_LEN) {
      throw new Error(`TRAVEL_BROWSER_VAULT_KEY decodes to ${key.length} bytes, expected ${KEY_LEN}`);
    }
    return new CredentialVault(key, filePath);
  }

  /** Create a vault using the backend selected by environment variables. */
  static createFromEnv(key: Buffer, filePath: string): { vault: CredentialVault; kind: string } {
    const selection = createVaultBackend(key, filePath);
    return { vault: CredentialVault.withBackend(key, selection.backend), kind: selection.kind };
  }

  /** Returns a key derived from a user-supplied master password. */
  static keyFromPassword(password: string): { key: Buffer; base64: string } {
    const salt = randomBytes(16);
    const key = deriveKey(password, salt);
    // We prepend salt to the base64 output so future unlocks can re-derive.
    const combined = Buffer.concat([salt, key]);
    return { key, base64: combined.toString('base64') };
  }

  list(): VaultSiteSummary[] {
    return this.backend.list();
  }

  get(site: string): SiteCredential | null {
    return this.backend.get(site);
  }

  getDecrypted(site: string): (SiteCredential & { password?: string; totpSeed?: string }) | null {
    return this.backend.getDecrypted(site);
  }

  set(site: string, input: { username?: string; password?: string; totpSeed?: string; notes?: string }): void {
    this.backend.set(site, input);
  }

  remove(site: string): boolean {
    return this.backend.remove(site);
  }

  has(site: string): boolean {
    return this.backend.has(site);
  }
}

function deriveKey(password: string, salt: Buffer): Buffer {
  // Prefer scrypt (memory-hard); fall back to PBKDF2 if scrypt is unavailable.
  try {
    return scryptSync(password, salt, KEY_LEN);
  } catch {
    return pbkdf2Sync(password, salt, 600000, KEY_LEN, 'sha512');
  }
}
