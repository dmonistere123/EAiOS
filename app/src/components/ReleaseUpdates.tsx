import { useEffect, useState } from 'react';
import type { ReleaseUpdateInfo } from '../domain/types';
import { hermes } from '../adapters';
import { Card, SectionTitle } from './ui';
import { toast } from '../state/runtime';

const labels: Record<ReleaseUpdateInfo['status'], string> = {
  not_checked: 'Not checked yet', check_failed: 'Check failed', no_releases: 'No releases published',
  current: 'You are up to date', ahead: 'This box is newer than the published release', available: 'Update available',
};
export function ReleaseUpdates() {
  const [info, setInfo] = useState<ReleaseUpdateInfo | null>(null);
  const [checking, setChecking] = useState(false);
  const [starting, setStarting] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState('');
  const busy = starting || ['queued', 'installing'].includes(info?.install?.status ?? '');
  useEffect(() => {
    let alive = true;
    void hermes.getReleaseUpdateInfo().then(value => { if (alive) setInfo(value); }).catch(() => { if (alive) setError('Release status unavailable. Try checking again.'); });
    return () => { alive = false; };
  }, []);
  useEffect(() => {
    if (!busy) return;
    let alive = true;
    const timer = window.setInterval(() => {
      void hermes.getReleaseUpdateInfo().then(value => { if (alive) { setInfo(value); setError(''); } }).catch(() => { if (alive) setError('The dashboard is reconnecting. Installation continues separately.'); });
    }, 3000);
    return () => { alive = false; window.clearInterval(timer); };
  }, [busy]);
  const check = async () => {
    setChecking(true); setError(''); setConfirming(false);
    try { setInfo(await hermes.checkForUpdates()); } catch { setError('Unable to check for updates. Try again when this box is connected.'); }
    finally { setChecking(false); }
  };
  const install = async () => {
    if (!info?.release) return;
    setStarting(true); setConfirming(false); setError('');
    try {
      const result = await hermes.installReleaseUpdate(info.release.id);
      if (!result.ok) { setError(result.error?.safeMessage ?? 'Could not start installation'); return; }
      // Keep polling even if the first refresh coincides with a restart.
      setInfo(previous => previous ? { ...previous, install: { status: 'queued', releaseId: info.release!.id, stage: 'Starting installation' } } : previous);
      toast('ok', 'Installation started. The dashboard will briefly reconnect.');
    } catch { setError('Could not start installation. Check the box status before retrying.'); } finally { setStarting(false); }
  };
  return <Card className="p-5">
    <SectionTitle right={<button type="button" disabled={checking || busy} onClick={() => void check()} className="rounded-lg border border-edge px-3 py-2 text-xs font-medium disabled:opacity-50">{checking ? 'Checking…' : 'Check for updates'}</button>}>Release updates</SectionTitle>
    <p className="text-xs text-ink-dim">Checks GitHub weekly. Installing an update is always your choice.</p>
    <div role="status" aria-live="polite" className="mt-3 text-sm">{checking ? 'Checking GitHub releases…' : info ? labels[info.status] : error ? 'Status unavailable' : 'Loading release status…'}</div>
    {info?.lastCheckedAt && <p className="mt-1 text-xs text-ink-dim">Last attempt: {new Date(info.lastCheckedAt).toLocaleString()}</p>}
    {info?.lastSuccessfulCheckAt && <p className="mt-1 text-xs text-ink-dim">Last successful check: {new Date(info.lastSuccessfulCheckAt).toLocaleString()}</p>}
    {(error || info?.error) && <p role="alert" className="mt-2 text-xs text-warn">{error || info?.error}</p>}
    {info?.release && <div className="mt-3 rounded-lg border border-edge bg-canvas p-3">
      <a href={info.release.url} target="_blank" rel="noreferrer" className="text-sm font-medium text-signal">{info.release.name}</a>
      <div className="mt-1 text-xs text-ink-dim">Published version: {info.release.version}</div>
      {info.release.notes && <details className="mt-2 text-xs"><summary className="cursor-pointer text-ink-dim">Release notes</summary><p className="mt-2 whitespace-pre-wrap text-ink-dim">{info.release.notes}</p></details>}
      {info.status === 'available' && !busy && !confirming && <button type="button" onClick={() => setConfirming(true)} className="mt-3 rounded-lg bg-signal px-4 py-2 text-xs font-semibold text-canvas">Install update</button>}
      {confirming && <div className="mt-3 text-xs">
        <p>Your saved data and credentials stay on this box. The dashboard will briefly reconnect. Finish active work and podcast generation first.</p>
        <div className="mt-2 flex gap-2"><button type="button" onClick={() => void install()} className="rounded-lg bg-signal px-3 py-2 font-semibold text-canvas">Install {info.release.version}</button><button type="button" onClick={() => setConfirming(false)} className="rounded-lg border border-edge px-3 py-2">Cancel</button></div>
      </div>}
    </div>}
    {busy && <p role="status" className="mt-3 text-xs text-ink-dim">{info?.install?.stage ?? 'Starting installation'}…</p>}
    {info?.install?.status === 'succeeded' && <p className="mt-3 text-xs text-ok">Update installed{info.install.version ? `: ${info.install.version}` : ''}. Your saved data was retained.</p>}
    {info?.install?.status === 'failed' && <p role="alert" className="mt-3 text-xs text-warn">{info.install.error ?? 'Installation failed. Check the box status before retrying.'}</p>}
  </Card>;
}
