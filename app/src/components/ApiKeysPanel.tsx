import { useEffect, useRef, useState } from 'react';
import { apiKeys, adapterMode } from '../adapters';
import { API_KEY_SCOPES, type ApiKeyScope, type ApiKeySettings, type ApiKeyStatus } from '../domain/apiKeys';
import { Card, SectionTitle, StateBadge } from './ui';

function KeyRow({ row, scope, version, onSaved, disabled }: { row: ApiKeyStatus; scope: ApiKeyScope; version: string; onSaved: () => Promise<void>; disabled: boolean }) {
  const [value, setValue] = useState('');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const save = async () => {
    setSaving(true); setError(''); setMessage('');
    try {
      await apiKeys.save(scope, row.key, value.trim(), version);
      setValue('');
      setMessage(scope === 'app' ? 'Saved. The next request will use this key. Provider access has not been tested.' : scope === 'podcasts' ? 'Saved. Restart the podcast service to apply this key.' : 'Saved. Restart Hermes to apply this key to agents and schedules.');
      await onSaved();
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not save the key.'); }
    finally { setSaving(false); }
  };
  return <form onSubmit={e => { e.preventDefault(); void save(); }} className="rounded-lg border border-edge bg-canvas p-4">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <label htmlFor={`key-${row.key}`} className="text-sm font-medium text-ink">{row.name}</label>
      <div className="flex gap-2"><StateBadge label={row.source === 'saved' ? 'Saved' : row.source === 'inherited' ? 'Shared key' : row.source === 'environment' ? 'Service environment' : 'Not configured'} tone={row.configured ? 'ok' : 'neutral'} />{row.mode && <StateBadge label={row.mode === 'test' ? 'Test mode' : 'Live key'} tone={row.mode === 'test' ? 'neutral' : 'warn'} />}</div>
    </div>
    <p className="mt-1 text-xs text-ink-dim">{row.description}</p>
    <div className="mt-3 flex flex-wrap gap-2">
      <input id={`key-${row.key}`} type="password" autoComplete="new-password" spellCheck={false} value={value} onChange={e => { setValue(e.target.value); setMessage(''); setError(''); }} disabled={disabled || saving} placeholder={row.configured ? 'Paste a replacement key' : 'Paste an API key'} className="min-w-0 flex-1 rounded-lg border border-edge bg-panel px-3 py-2 text-sm text-ink" />
      <button type="submit" disabled={disabled || saving || !value.trim()} className="rounded-lg bg-signal px-3 py-2 text-sm font-semibold text-canvas disabled:opacity-50">{saving ? 'Saving…' : 'Save key'}</button>
    </div>
    {message && <p role="status" className="mt-2 text-xs text-ok">{message}</p>}
    {error && <p role="alert" className="mt-2 text-xs text-warn">{error}</p>}
  </form>;
}

export function ApiKeysPanel() {
  const [scope, setScope] = useState<ApiKeyScope>('app');
  const selectedScope = useRef<ApiKeyScope>('app');
  const [data, setData] = useState<ApiKeySettings | null>(null);
  const [error, setError] = useState('');
  const [refresh, setRefresh] = useState(0);
  const live = adapterMode === 'live';
  useEffect(() => {
    let active = true;
    if (live) void apiKeys.list(scope).then(result => { if (active) setData(result); }).catch(() => { if (active) setError('API key settings are unavailable. Reload to try again.'); });
    return () => { active = false; };
  }, [scope, refresh, live]);
  const reloadStatus = () => { setData(null); setError(''); setRefresh(n => n + 1); };
  const reloadAfterSave = async () => {
    try { const updated = await apiKeys.list(scope); if (selectedScope.current === scope) setData(updated); }
    catch { if (selectedScope.current === scope) setError('The key was saved, but status could not be refreshed. Reload before saving another key.'); }
  };
  return <Card className="p-5 lg:col-span-2">
    <SectionTitle>API keys &amp; services</SectionTitle>
    <p className="mb-3 text-sm text-ink-dim">Add or replace provider keys on this machine. Existing keys stay hidden and are never sent back to your browser. “Saved” means stored, not verified with the provider.</p>
    <label htmlFor="api-key-section" className="text-xs text-ink-dim">Used by</label>
    <select id="api-key-section" value={scope} onChange={e => { setData(null); setError(''); selectedScope.current = e.target.value as ApiKeyScope; setScope(selectedScope.current); }} className="ml-2 rounded-lg border border-edge bg-canvas px-3 py-2 text-sm text-ink">
      {Object.entries(API_KEY_SCOPES).map(([id, info]) => <option key={id} value={id}>{info.label}</option>)}
    </select>
    {live && <button onClick={reloadStatus} className="ml-3 text-xs text-signal underline">Reload status</button>}
    <p className="my-3 text-xs text-ink-dim">{API_KEY_SCOPES[scope].help}</p>
    {!live ? <p className="text-sm text-warn">Key editing is unavailable in the mock preview. Use the connected EAiOS application.</p> : <>
      {error && <div role="alert" className="mb-3 text-sm text-warn">{error} <button onClick={reloadStatus} className="underline">Reload key settings</button></div>}
      {!data && !error && <p className="text-sm text-ink-dim">Loading key status…</p>}
      {data && data.scope === scope && <div className="grid gap-3 md:grid-cols-2">{data.keys.map(row => <KeyRow key={`${scope}-${row.key}`} row={row} scope={scope} version={data.version} onSaved={reloadAfterSave} disabled={!!error} />)}</div>}
    </>}
    <p className="mt-4 text-xs text-ink-faint">Signing in to Google, Gmail and other connected accounts still happens in Connections. Agent-specific keys stay in Agents. No background services restart automatically.</p>
  </Card>;
}
