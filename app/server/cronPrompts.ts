import { readFileSync, realpathSync } from 'node:fs';
import { join, sep } from 'node:path';

/** Read-only projection: never expose provider snapshots or mutate scheduler data. */
export function readCronPrompts(home: string, profile?: string) {
  if (profile && !/^[a-zA-Z0-9_-]+$/.test(profile)) throw new Error('Invalid profile');
  const root = realpathSync(home);
  const path = realpathSync(join(root, ...(profile && profile !== 'default' ? ['profiles', profile] : []), 'cron', 'jobs.json'));
  if (!path.startsWith(root + sep)) throw new Error('Schedule store outside Hermes home');
  const data = JSON.parse(readFileSync(path, 'utf8'));
  const rows = Array.isArray(data) ? data : data.jobs;
  if (!Array.isArray(rows)) throw new Error('Unrecognized schedule store');
  return { jobs: rows.flatMap((job: Record<string, unknown>) => typeof job.id === 'string' && typeof job.prompt === 'string'
    ? [{ id: job.id, prompt: job.prompt }] : []) };
}
