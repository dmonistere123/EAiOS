/** Persist release notes only after the installer has recorded success.
 * Reconciliation in the new server also supports upgrades launched by old installers.
 */
import { constants, closeSync, existsSync, fstatSync, mkdirSync, openSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { BuildVersion } from './apiCore.ts';

type Context = { eaiosRoot: string; hermesHome: string; buildVersion?: BuildVersion | null };
const idPattern = /^release-\d+\.\d+\.\d+-[a-f0-9]{40}$/;
const folder = (ctx: Context) => join(ctx.hermesHome, 'eaios', 'release-notes');

function readRegular(path: string) {
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.size > 1024 * 1024) throw new Error('Invalid release note file');
    return { content: readFileSync(fd, 'utf8'), stat };
  } finally { closeSync(fd); }
}

export function reconcileReleaseArtifact(ctx: Context): boolean {
  const build = ctx.buildVersion;
  if (!build || build.releaseChannel !== 'stable' || build.dirty === true || !/^\d+\.\d+\.\d+$/.test(build.version) || !/^[a-f0-9]{40}$/.test(build.gitSha ?? '')) return false;
  const id = `release-${build.version}-${build.gitSha}`;
  if (existsSync(join(folder(ctx), `${id}.md`))) return true;
  let finishedAt: string | undefined;
  try {
    const status = JSON.parse(readFileSync(join(ctx.hermesHome, 'eaios', 'install-status.json'), 'utf8'));
    if (status.status === 'succeeded' && status.version === build.version && status.gitSha === build.gitSha) finishedAt = status.finishedAt;
  } catch { /* CLI installations use the update journal instead. */ }
  if (!finishedAt && existsSync(join(ctx.hermesHome, 'state.db'))) {
    const db = new DatabaseSync(join(ctx.hermesHome, 'state.db'), { readOnly: true });
    try {
      const row = db.prepare("SELECT finished_at FROM eaios_update_log WHERE success=1 AND action IN ('update','update-to') AND new_git_sha=? AND new_version=? AND finished_at IS NOT NULL ORDER BY id DESC LIMIT 1").get(build.gitSha, build.version);
      if (row) finishedAt = new Date(Number(row.finished_at) * 1000).toISOString();
    } catch { /* Older databases may have no update journal. */ }
    finally { db.close(); }
  }
  if (!finishedAt || !Number.isFinite(Date.parse(finishedAt))) return false;
  const notes = readRegular(join(ctx.eaiosRoot, 'docs', `RELEASE-NOTES-v${build.version}.md`)).content;
  const content = `# EAiOS v${build.version} — Installed update\n\nInstalled successfully: ${new Date(finishedAt).toISOString()}\n\nRelease revision: ${build.gitSha}\n\nThis report is saved locally for reference. Customer agents, instructions, skills, credentials, and conversations remain in their existing locations.\n\n---\n\n${notes}`;
  mkdirSync(folder(ctx), { recursive: true, mode: 0o700 });
  // Exclusive creation: two dashboard processes cannot overwrite each other's report.
  try { writeFileSync(join(folder(ctx), `${id}.md`), content, { flag: 'wx', mode: 0o600 }); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
  return true;
}

export function releaseArtifact(ctx: Context, id: string) {
  if (!idPattern.test(id)) return null;
  try {
    const { content, stat } = readRegular(join(folder(ctx), `${id}.md`));
    return { content, stat, filename: `EAiOS-v${id.split('-')[1]}-Whats-New.md` };
  } catch { return null; }
}

export function listReleaseArtifacts(ctx: Context) {
  if (!existsSync(folder(ctx))) return [];
  return readdirSync(folder(ctx)).flatMap(file => {
    const id = file.replace(/\.md$/, '');
    if (file !== `${id}.md`) return [];
    const rec = releaseArtifact(ctx, id);
    return rec ? [{ id, taskId: '', taskTitle: 'Installed application update', name: rec.filename,
      mimeType: 'text/markdown', sizeBytes: Buffer.byteLength(rec.content), uploadedBy: 'EAiOS Installer',
      agentId: 'EAiOS Installer', taskStatus: 'done', createdAt: rec.stat.birthtime.toISOString(),
      previewAvailable: true, downloadUrl: `/api/artifacts/${id}/raw` }] : [];
  }).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
