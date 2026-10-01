/** Backup — archive Hermes + EAiOS to removable media (USB). Ollama models excluded. */
import { useEffect, useState } from 'react';
import { Card, SectionTitle, StateBadge } from '../components/ui';
import { hermes } from '../adapters';
import { toast } from '../state/runtime';
import type { BackupMedia, BackupJobStatus } from '../adapters/interfaces';

function humanSize(bytes?: number): string {
  if (bytes === undefined || bytes === null || bytes === 0) return 'unknown';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(units.length - 1, Math.floor(Math.log10(bytes) / 3));
  return `${(bytes / 1000 ** i).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

export default function Backup() {
  const [media, setMedia] = useState<BackupMedia[]>([]);
  const [loading, setLoading] = useState(true);
  const [job, setJob] = useState<BackupJobStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = async () => {
    setLoading(true);
    setError(null);
    try {
      const m = await hermes.listBackupMedia();
      setMedia(m);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not list media');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
  }, []);

  useEffect(() => {
    if (!job || job.status === 'done' || job.status === 'error' || job.status === 'failed') return;
    const timer = setInterval(() => {
      void hermes.getBackupStatus(job.id)
        .then((status) => {
          setJob(status);
          if (status.status === 'done') {
            toast('ok', `Backup written: ${status.archivePath} (${status.archiveSize})`);
          } else if (status.status === 'error' || status.status === 'failed') {
            const msg = status.error ?? 'Backup failed';
            setError(msg);
            toast('error', msg);
          }
        })
        .catch((e) => {
          const msg = e instanceof Error ? e.message : 'Backup status check failed';
          setError(msg);
          toast('error', msg);
        });
    }, 1000);
    return () => clearInterval(timer);
  }, [job]);

  const run = async (target: BackupMedia) => {
    setError(null);
    try {
      const started = await hermes.startBackup(target.path);
      setJob({
        id: started.jobId,
        status: 'running',
        progress: { phase: 'starting', percent: 0 },
        startedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Backup failed to start';
      setError(msg);
      toast('error', msg);
    }
  };

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Backup</h1>
        <p className="mt-1 text-sm text-ink-dim">Archive Hermes and EAiOS to removable media. Ollama model weights are not included.</p>
      </header>

      <Card className="p-5">
        <SectionTitle right={<StateBadge label="offline-safe" tone="ok" />}>What gets backed up</SectionTitle>
        <ul className="space-y-2 text-sm text-ink-dim">
          <li className="flex items-start gap-2"><span className="text-ok">✓</span> Hermes home directory (~/.hermes) — profiles, skills, state, kanban, memories</li>
          <li className="flex items-start gap-2"><span className="text-ok">✓</span> EAiOS application directory (~/eaios) — repo, playbooks, code</li>
          <li className="flex items-start gap-2"><span className="text-ok">✓</span> EAiOS data — settings, dismissed items, update log</li>
          <li className="flex items-start gap-2"><span className="text-ok">✓</span> User systemd services — Ollama, eaios-hermes-serve, eaios-server, etc.</li>
          <li className="flex items-start gap-2"><span className="text-risk">✗</span> Ollama LLM models — excluded to keep the archive portable</li>
        </ul>
      </Card>

      <Card className="p-5">
        <div className="flex items-center justify-between">
          <SectionTitle>Removable media</SectionTitle>
          <button onClick={refresh} disabled={loading || job?.status === 'running'} className="rounded-lg border border-edge px-3 py-1.5 text-xs font-medium text-ink-dim hover:bg-canvas-overlay disabled:opacity-50">
            {loading ? 'Scanning…' : 'Refresh'}
          </button>
        </div>

        {job?.status === 'running' && (
          <div className="mt-4 rounded-lg border border-signal/30 bg-signal/5 p-4 text-sm">
            <div className="font-medium text-signal">Backup in progress…</div>
            <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-canvas-overlay">
              <div className="h-full w-full bg-signal/60 animate-pulse" />
            </div>
            <div className="mt-1 text-xs text-ink-faint">
              {job.archiveSize ? `${job.archiveSize} written so far — ` : ''}{job.progress?.phase ?? 'packing'} (large archives take several minutes)
            </div>
          </div>
        )}

        {media.length === 0 ? (
          <div className="mt-4 rounded-lg border border-warn/30 bg-warn/5 p-4 text-sm">
            <div className="font-medium text-warn">No removable media detected</div>
            <p className="mt-1 text-ink-dim">Insert a USB drive and click Refresh. If it is already mounted under /media or /mnt, it will appear automatically.</p>
          </div>
        ) : (
          <ul className="mt-4 space-y-2">
            {media.map((m) => (
              <li key={m.path} className="flex items-center justify-between rounded-lg border border-edge bg-canvas p-3">
                <div>
                  <div className="text-sm font-medium text-ink">{m.label}</div>
                  <div className="text-xs text-ink-dim font-mono">{m.path}{m.device ? ` • ${m.device}` : ''}</div>
                  <div className="mt-1 text-xs text-ink-faint">
                    {m.sizeBytes !== undefined && `${humanSize(m.sizeBytes)} total`}
                    {m.availableBytes !== undefined && ` • ${humanSize(m.availableBytes)} free`}
                  </div>
                </div>
                <button
                  onClick={() => void run(m)}
                  disabled={job?.status === 'running'}
                  className="rounded-lg bg-signal px-4 py-2 text-sm font-semibold text-canvas hover:bg-signal/90 disabled:opacity-50"
                >
                  {job?.status === 'running' ? 'Running…' : 'Backup now'}
                </button>
              </li>
            ))}
          </ul>
        )}

        {error && <div className="mt-4 rounded-lg border border-risk/30 bg-risk/5 p-3 text-sm text-risk">{error}</div>}
      </Card>

      {job?.status === 'done' && (
        <Card className="p-5">
          <SectionTitle right={<StateBadge label="complete" tone="ok" />}>Last backup</SectionTitle>
          <div className="space-y-1 text-sm text-ink-dim">
            <div><span className="text-ink-faint">Archive:</span> <span className="font-mono text-ink">{job.archivePath}</span></div>
            <div><span className="text-ink-faint">Size:</span> {job.archiveSize}</div>
            <div><span className="text-ink-faint">Started:</span> {new Date(job.startedAt).toLocaleString()}</div>
            <div><span className="text-ink-faint">Finished:</span> {job.finishedAt ? new Date(job.finishedAt).toLocaleString() : '—'}</div>
          </div>
          <div className="mt-3 text-xs text-ink-faint">
            To restore: extract the tarball and copy each directory back to its original location. Re-install Ollama and pull models separately.
          </div>
        </Card>
      )}
    </div>
  );
}
