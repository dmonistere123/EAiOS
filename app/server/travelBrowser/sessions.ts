/**
 * Encrypted per-site cookie/session persistence for browser-automation
 * travel booking.
 *
 * Uses the same AES-256-GCM key as the credential vault. Each site gets its
 * own cookie jar entry. The runner reads/writes cookies via JSON so a saved
 * login on one site does not leak to another.
 */
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, mkdirSync, chmodSync } from 'node:fs';
import { dirname } from 'node:path';

export interface CookieJar {
  site: string;
  cookies: unknown[]; // opaque browser-use cookie shape
  updatedAt: string;
}

interface SessionsFile {
  version: 1;
  iv: string;
  tag: string;
  ciphertext: string;
}

const VERSION = 1;
const IV_LEN = 16;
const KEY_LEN = 32;

function encrypt(key: Buffer, plaintext: object): SessionsFile {
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const json = JSON.stringify(plaintext);
  const ciphertext = Buffer.concat([cipher.update(json, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    version: VERSION,
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
    ciphertext: ciphertext.toString('base64'),
  };
}

function decrypt<T>(key: Buffer, file: SessionsFile): T {
  if (file.version !== VERSION) throw new Error(`Unsupported sessions version ${file.version}`);
  const iv = Buffer.from(file.iv, 'base64');
  const tag = Buffer.from(file.tag, 'base64');
  const ciphertext = Buffer.from(file.ciphertext, 'base64');
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return JSON.parse(plaintext.toString('utf8')) as T;
}

export class SessionStore {
  private readonly filePath: string;
  private readonly key: Buffer;
  private jars: CookieJar[] = [];
  private loaded = false;

  constructor(key: Buffer, filePath: string) {
    if (key.length !== KEY_LEN) throw new Error(`Session key must be ${KEY_LEN} bytes`);
    this.key = key;
    this.filePath = filePath;
  }

  static fromVaultKey(vaultKey: Buffer, filePath: string): SessionStore {
    return new SessionStore(vaultKey, filePath);
  }

  unlock(): void {
    if (!existsSync(this.filePath)) {
      this.jars = [];
      this.loaded = true;
      return;
    }
    const raw = readFileSync(this.filePath, 'utf8');
    const file = JSON.parse(raw) as SessionsFile;
    this.jars = decrypt<CookieJar[]>(this.key, file);
    this.loaded = true;
  }

  save(): void {
    mkdirSync(dirname(this.filePath), { recursive: true });
    const file = encrypt(this.key, this.jars);
    writeFileSync(this.filePath, JSON.stringify(file), { mode: 0o600 });
    try {
      chmodSync(this.filePath, 0o600);
    } catch {
      // ignore
    }
  }

  private ensureLoaded(): void {
    if (!this.loaded) this.unlock();
  }

  getCookies(site: string): unknown[] {
    this.ensureLoaded();
    return this.jars.find((j) => j.site === site)?.cookies ?? [];
  }

  setCookies(site: string, cookies: unknown[]): void {
    this.ensureLoaded();
    const idx = this.jars.findIndex((j) => j.site === site);
    const jar: CookieJar = { site, cookies, updatedAt: new Date().toISOString() };
    if (idx >= 0) this.jars[idx] = jar;
    else this.jars.push(jar);
    this.save();
  }

  clear(site: string): boolean {
    this.ensureLoaded();
    const before = this.jars.length;
    this.jars = this.jars.filter((j) => j.site !== site);
    if (this.jars.length !== before) {
      this.save();
      return true;
    }
    return false;
  }

  list(): { site: string; updatedAt: string }[] {
    this.ensureLoaded();
    return this.jars.map(({ site, updatedAt }) => ({ site, updatedAt }));
  }
}
