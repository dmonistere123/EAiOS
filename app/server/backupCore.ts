/**
 * Backup core — archives the Hermes home, EAiOS repo, and EAiOS data root to a
 * tar.gz on removable media. Runs as an async job: startBackupJob() returns
 * immediately and the tar runs in the background; listJobs() reports progress
 * (archive size growth) and completion.
 *
 * Ollama LLM model weights are NEVER included (task requirement). The Hermes
 * agent runtime, node runtime, LSP servers, node_modules, build output, and
 * the sidecar venv are excluded because the EAiOS/Hermes installers recreate
 * them; they would multiply archive size for zero restore value. The Hermes
 * browser profile IS included — it holds logged-in sessions that are painful
 * to restore by hand.
 */
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { mkdir, open, readdir, readFile, stat, unlink, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve, sep } from 'node:path';
import { randomUUID } from 'node:crypto';

export interface RemovableMedia {
  path: string;
  label?: string;
  sizeBytes?: number;
  usedBytes?: number;
  availableBytes?: number;
  device?: string;
  removable: boolean;
}

export interface BackupSourceInfo {
  name: string;
  path: string;
}

export interface BackupPlan {
  sources: BackupSourceInfo[];
  exclusions: string[];
}

export interface BackupJob {
  id: string;
  target: string;
  status: 'running' | 'done' | 'error';
  startedAt: string;
  finishedAt?: string;
  archivePath?: string;
  archiveSizeBytes?: number;
  /** tar exit 1 = some files changed while being read (normal on a live box). */
  warning?: string;
  error?: string;
  sources: BackupSourceInfo[];
  exclusions: string[];
}

export interface BackupRoots {
  hermesHome: string;
  eaiosRoot: string;
  eaiosDataRoot: string;
  systemdUser: string;
}

export class BackupRequestError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/** Human-readable exclusion descriptions, surfaced in the UI. */
const EXCLUSION_LABELS = [
  'Ollama LLM model weights (~/.ollama/models, ~/.local/ollama)',
  'Hermes runtime, node runtime, LSP servers, and caches (reinstalled by the installer)',
  'app/node_modules, app/dist, and sidecar/.venv (rebuilt by npm ci / uv)',
];

/** Shell out to lsblk to discover removable block devices and their mountpoints. */
export function listRemovableMedia(): RemovableMedia[] {
  try {
    const out = execFileSync('lsblk', ['-J', '-o', 'NAME,SIZE,TYPE,MOUNTPOINT,RM,LABEL,FSUSED,FSAVAIL'], { encoding: 'utf8' });
    const parsed = JSON.parse(out) as { blockdevices?: unknown[] };
    const found: RemovableMedia[] = [];
    const walk = (devices: unknown[]) => {
      for (const d of devices ?? []) {
        const dev = d as Record<string, unknown>;
        const children = (dev.children ?? []) as Record<string, unknown>[];
        if (children.length) walk(children);
        const mountpoint = typeof dev.mountpoint === 'string' ? dev.mountpoint : undefined;
        if (!mountpoint) continue;
        const removable = dev.rm === true || dev.rm === '1' || dev.rm === 1;
        // Keep removable devices or anything mounted under /media /run/media /mnt
        const wellKnown = /^\/(media|run\/media|mnt)(\/|$)/.test(mountpoint);
        if (!removable && !wellKnown) continue;
        found.push({
          path: mountpoint,
          label: typeof dev.label === 'string' && dev.label ? dev.label : basename(mountpoint),
          device: typeof dev.name === 'string' ? `/dev/${dev.name}` : undefined,
          removable,
          sizeBytes: parseByteString(String(dev.size ?? '0')),
          usedBytes: parseByteString(String(dev.fsused ?? '0')),
          availableBytes: parseByteString(String(dev.fsavail ?? '0')),
        });
      }
    };
    walk(parsed.blockdevices ?? []);
    return found;
  } catch {
    return [];
  }
}

/**
 * Fallback scan of common mount parent directories. An entry only counts when
 * it is an actual mountpoint (its device differs from its parent's) — udisks
 * creates plain per-user dirs like /media/<user> on the root filesystem, and
 * those must NOT be offered as backup targets. USB drives mount one level
 * deeper (/media/<user>/<label>), so scan two levels.
 */
export async function scanMountParents(): Promise<RemovableMedia[]> {
  const found: RemovableMedia[] = [];
  for (const parent of ['/media', '/run/media', '/mnt']) {
    try {
      const entries = await readdir(parent, { withFileTypes: true });
      for (const e of entries) {
        if (!e.isDirectory()) continue;
        const path = join(parent, e.name);
        if (await isMountPoint(path)) {
          const info = await mediaInfo(path);
          if (info) found.push(info);
          continue;
        }
        // One level deeper: /media/<user>/<label>
        try {
          const children = await readdir(path, { withFileTypes: true });
          for (const c of children) {
            if (!c.isDirectory()) continue;
            const childPath = join(path, c.name);
            if (!await isMountPoint(childPath)) continue;
            const info = await mediaInfo(childPath);
            if (info) found.push(info);
          }
        } catch { /* unreadable subdir */ }
      }
    } catch { /* ignore unreadable parent */ }
  }
  return found;
}

async function isMountPoint(path: string): Promise<boolean> {
  try {
    const s = await stat(path);
    const parent = await stat(dirname(path));
    return s.dev !== parent.dev;
  } catch {
    return false;
  }
}

/** Extra roots from EAIOS_BACKUP_MEDIA_ROOTS (colon-separated) — testing/demo override. */
async function envMediaRoots(): Promise<RemovableMedia[]> {
  const raw = process.env.EAIOS_BACKUP_MEDIA_ROOTS;
  if (!raw) return [];
  const found: RemovableMedia[] = [];
  for (const p of raw.split(':').map((s) => s.trim()).filter(Boolean)) {
    const info = await mediaInfo(p);
    if (info) found.push({ ...info, label: `${basename(p)} (configured)` });
  }
  return found;
}

/** Union of lsblk detection, mount-parent scan, and configured extra roots. */
export async function detectMedia(): Promise<RemovableMedia[]> {
  const byPath = new Map<string, RemovableMedia>();
  for (const m of listRemovableMedia()) byPath.set(m.path, m);
  for (const m of await scanMountParents()) if (!byPath.has(m.path)) byPath.set(m.path, m);
  for (const m of await envMediaRoots()) if (!byPath.has(m.path)) byPath.set(m.path, m);
  return [...byPath.values()].sort((a, b) => a.path.localeCompare(b.path));
}

async function mediaInfo(path: string): Promise<RemovableMedia | null> {
  try {
    const s = await stat(path);
    if (!s.isDirectory()) return null;
    const out = execFileSync('df', ['-B1', '--output=source,size,used,avail', path], { encoding: 'utf8' });
    const lines = out.trim().split('\n');
    const data = lines[1]?.trim().split(/\s+/);
    return {
      path,
      label: basename(path),
      device: data?.[0],
      removable: true,
      sizeBytes: parseInt(data?.[1] ?? '0', 10) || undefined,
      usedBytes: parseInt(data?.[2] ?? '0', 10) || undefined,
      availableBytes: parseInt(data?.[3] ?? '0', 10) || undefined,
    };
  } catch {
    return null;
  }
}

function parseByteString(s: string): number | undefined {
  if (!s) return undefined;
  const match = s.trim().match(/^([0-9.]+)\s*([KMGTPEZY]?)(i?B?)?$/i);
  if (!match) return undefined;
  const base = parseFloat(match[1]);
  if (!Number.isFinite(base)) return undefined;
  const unit = match[2].toUpperCase();
  const exp = { '': 0, K: 1, M: 2, G: 3, T: 4, P: 5, E: 6, Z: 7, Y: 8 }[unit] ?? 0;
  const mult = match[3]?.startsWith('i') ? 1024 : 1000;
  return Math.round(base * mult ** exp);
}

/**
 * Resolve the backup plan: deduplicated source list (EAiOS repo and data root
 * are the same directory on this box) plus tar exclude patterns. Patterns
 * without '/' match any path component (GNU tar semantics); patterns with '/'
 * match a leading directory of an archive member.
 */
export function getBackupPlan(roots: BackupRoots): BackupPlan {
  const sources: BackupSourceInfo[] = [{ name: 'Hermes home', path: roots.hermesHome }];
  const seen = new Set([resolve(roots.hermesHome)]);
  const add = (name: string, path: string) => {
    const r = resolve(path);
    if (seen.has(r)) return;
    seen.add(r);
    sources.push({ name, path });
  };
  add('EAiOS application', roots.eaiosRoot);
  add('EAiOS data', roots.eaiosDataRoot);
  add('User systemd services', roots.systemdUser);

  const hh = basename(roots.hermesHome);
  const exclusions = [
    '.ollama',
    'ollama',
    'node_modules',
    'dist',
    '.venv',
    `${hh}/hermes-agent`,
    `${hh}/node`,
    `${hh}/lsp`,
    `${hh}/cache`,
  ];
  return { sources, exclusions };
}

/** Plan with human-readable exclusion labels for the UI. */
export function describeBackupPlan(roots: BackupRoots): BackupPlan & { exclusionLabels: string[] } {
  return { ...getBackupPlan(roots), exclusionLabels: EXCLUSION_LABELS };
}

/* ------------------------------------------------------------------ */
/* Job management                                                      */
/* ------------------------------------------------------------------ */

const HISTORY_LIMIT = 20;
const jobs: BackupJob[] = [];
const running = new Map<string, ChildProcess>();
let historyLoadedFrom: string | null = null;

function historyFile(roots: BackupRoots): string {
  return join(roots.hermesHome, 'eaios', 'backup-jobs.json');
}

async function loadHistory(roots: BackupRoots): Promise<void> {
  const file = historyFile(roots);
  if (historyLoadedFrom === file) return;
  historyLoadedFrom = file;
  try {
    const raw = await readFile(file, 'utf8');
    const past = JSON.parse(raw) as BackupJob[];
    for (const j of past) {
      if (j.status === 'running') {
        // A job that was running when the server last stopped can never finish.
        j.status = 'error';
        j.error = 'Backup interrupted by a server restart.';
        j.finishedAt = j.finishedAt ?? j.startedAt;
      }
      if (!jobs.some((existing) => existing.id === j.id)) jobs.push(j);
    }
  } catch { /* no history yet — fine */ }
}

async function saveHistory(roots: BackupRoots): Promise<void> {
  try {
    const finished = jobs.filter((j) => j.status !== 'running').slice(-HISTORY_LIMIT);
    await mkdir(dirname(historyFile(roots)), { recursive: true });
    await writeFile(historyFile(roots), JSON.stringify(finished, null, 2));
  } catch { /* history is best-effort */ }
}

/** Current job list, running first, then most recent. Refreshes archive sizes. */
export async function listJobs(roots: BackupRoots): Promise<BackupJob[]> {
  await loadHistory(roots);
  for (const j of jobs) {
    if (j.status === 'running' && j.archivePath) {
      try {
        j.archiveSizeBytes = (await stat(j.archivePath)).size;
      } catch { /* archive not created yet */ }
    }
  }
  return [...jobs].sort((a, b) => {
    if (a.status === 'running' && b.status !== 'running') return -1;
    if (b.status === 'running' && a.status !== 'running') return 1;
    return b.startedAt.localeCompare(a.startedAt);
  });
}

/**
 * Start a background backup job to `target` (a detected removable-media path,
 * or a directory inside one). Throws BackupRequestError on validation
 * failures; only one backup may run at a time.
 */
export async function startBackupJob(target: string, roots: BackupRoots): Promise<BackupJob> {
  await loadHistory(roots);
  if (running.size > 0) {
    throw new BackupRequestError(409, 'A backup is already running. Wait for it to finish.');
  }
  const clean = String(target ?? '').trim();
  if (!clean) throw new BackupRequestError(400, 'target is required');

  const media = await detectMedia();
  const resolvedTarget = resolve(clean);
  const allowed = media.some((m) => {
    const root = resolve(m.path);
    return resolvedTarget === root || resolvedTarget.startsWith(root + sep);
  });
  if (!allowed) {
    throw new BackupRequestError(400, 'Target must be a detected removable-media mount (insert a USB drive and rescan).');
  }
  if (!await isWritable(resolvedTarget)) {
    throw new BackupRequestError(400, `Target directory is not writable: ${resolvedTarget}`);
  }

  const plan = getBackupPlan(roots);
  const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);
  const archivePath = join(resolvedTarget, `eaios-backup-${stamp}.tar.gz`);

  const args: string[] = ['-czf', archivePath];
  for (const ex of plan.exclusions) args.push(`--exclude=${ex}`);
  for (const s of plan.sources) args.push('-C', dirname(resolve(s.path)), basename(resolve(s.path)));

  const job: BackupJob = {
    id: randomUUID(),
    target: resolvedTarget,
    status: 'running',
    startedAt: new Date().toISOString(),
    archivePath,
    archiveSizeBytes: 0,
    sources: plan.sources,
    exclusions: plan.exclusions,
  };
  jobs.push(job);

  const child = spawn('tar', args, { stdio: ['ignore', 'ignore', 'pipe'] });
  let stderr = '';
  child.stderr?.on('data', (chunk) => { stderr += String(chunk); });
  running.set(job.id, child);
  child.on('error', (e) => {
    void finishJob(job, roots, 2, `failed to start tar: ${e.message}`);
  });
  child.on('exit', (code) => {
    void finishJob(job, roots, code ?? 2, stderr.trim());
  });
  return job;
}

async function finishJob(job: BackupJob, roots: BackupRoots, code: number, detail: string): Promise<void> {
  running.delete(job.id);
  job.finishedAt = new Date().toISOString();
  // GNU tar: 0 = clean, 1 = "some files differ" (expected on a live box — a
  // database changed while being read), 2 = fatal.
  if (code === 0 || code === 1) {
    try {
      job.archiveSizeBytes = job.archivePath ? (await stat(job.archivePath)).size : undefined;
    } catch { /* keep last known size */ }
    job.status = 'done';
    if (code === 1) job.warning = 'Some files changed while being read (normal on a running system); the archive contains the version read first.';
  } else {
    job.status = 'error';
    job.error = `tar exited with code ${code}${detail ? `: ${detail.slice(0, 300)}` : ''}`;
    if (job.archivePath) await unlink(job.archivePath).catch(() => undefined);
  }
  await saveHistory(roots);
}

async function isWritable(dir: string): Promise<boolean> {
  const probe = join(dir, `.write-test-${Date.now()}`);
  try {
    const fh = await open(probe, 'w');
    await fh.close();
    await unlink(probe);
    return true;
  } catch {
    return false;
  }
}

/** Resolve a human-readable size from bytes. */
export function humanSize(bytes?: number): string {
  if (bytes === undefined || bytes === null || bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(units.length - 1, Math.floor(Math.log10(bytes) / 3));
  return `${(bytes / 1000 ** i).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}
