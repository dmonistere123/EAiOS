import { useEffect, useRef, useState } from 'react';
import { apiKeys, adapterMode } from '../adapters';
import { API_KEY_SCOPES, type ApiKeyScope, type ApiKeySettings, type ApiKeyStatus } from '../domain/apiKeys';
import { Card, SectionTitle, StateBadge } from './ui';

function KeyRow({ row, scope, version, onSaved, disabled, social = false }: { social?: boolean; row: ApiKeyStatus; scope: ApiKeyScope; version: string; onSaved: () => Promise<void>; disabled: boolean }) {
  const [value, setValue] = useState('');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const save = async () => {
    setSaving(true); setError(''); setMessage('');
    try {
      await apiKeys.save(scope, row.key, value.trim(), version);
      setValue('');
      setMessage(social ? 'Saved. Social Media will use this key on the next request. No restart is needed.' : scope === 'app' ? 'Saved. The next request will use this key. Provider access has not been tested.' : scope === 'podcasts' ? 'Saved. Restart the podcast service to apply this key.' : 'Saved. Restart Hermes to apply this key to agents and schedules.');
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
  const [section, setSection] = useState<ApiKeyScope | 'social'>(() => window.location.hash === '#social-media' ? 'social' : 'app');
  const scope: ApiKeyScope = section === 'social' ? 'hermes' : section;
  const selectedScope = useRef<ApiKeyScope>(scope);
  const [data, setData] = useState<ApiKeySettings | null>(null);
  const [error, setError] = useState('');
  const [refresh, setRefresh] = useState(0);
  const preview = import.meta.env.VITE_SOCIAL_PREVIEW === '1';
  const live = adapterMode === 'live' || preview;
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
  return <div id="social-media" className="lg:col-span-2"><Card className="p-5">
    <SectionTitle>API keys &amp; services</SectionTitle>
    <p className="mb-3 text-sm text-ink-dim">Add or replace provider keys on this machine. Existing keys stay hidden and are never sent back to your browser. “Saved” means stored, not verified with the provider.</p>
    <label htmlFor="api-key-section" className="text-xs text-ink-dim">Used by</label>
    <select id="api-key-section" value={section} onChange={e => { const next = e.target.value as ApiKeyScope | 'social'; setData(null); setError(''); selectedScope.current = next === 'social' ? 'hermes' : next; setSection(next); setRefresh(n => n + 1); }} className="ml-2 rounded-lg border border-edge bg-canvas px-3 py-2 text-sm text-ink">
      <option value="social">Social Media</option>
      {Object.entries(API_KEY_SCOPES).map(([id, info]) => <option key={id} value={id}>{info.label}</option>)}
    </select>
    {live && <button onClick={reloadStatus} className="ml-3 text-xs text-signal underline">Reload status</button>}
    {preview && <p className="mt-3 text-xs text-warn">Isolated test preview: saved keys stay in this preview, separate from production.</p>}
    <p className="my-3 text-xs text-ink-dim">{section === 'social' ? 'OpenRouter writes posts; OpenAI creates images. These are the same shared keys used by Assistant & tools, not separate copies. Enter them once; Social Media uses saved changes immediately.' : API_KEY_SCOPES[scope].help}</p>
    {section === 'social' && <div className="mb-3 flex flex-wrap gap-4 text-xs text-signal"><a href="https://openrouter.ai/settings/keys" target="_blank" rel="noopener noreferrer">Get an OpenRouter key ↗</a><a href="https://platform.openai.com/api-keys" target="_blank" rel="noopener noreferrer">Get an OpenAI key ↗</a><a href="/social">Return to Social Media →</a></div>}
    {!live ? <p className="text-sm text-warn">Key editing is unavailable in the mock preview. Use the connected EAiOS application.</p> : <>
      {error && <div role="alert" className="mb-3 text-sm text-warn">{error} <button onClick={reloadStatus} className="underline">Reload key settings</button></div>}
      {!data && !error && <p className="text-sm text-ink-dim">Loading key status…</p>}
      {data && data.scope === scope && <div className="grid gap-3 md:grid-cols-2">{data.keys.filter(row => section !== 'social' || ['OPENROUTER_API_KEY', 'OPENAI_API_KEY'].includes(row.key)).map(row => <KeyRow social={section === 'social'} key={`${section}-${row.key}`} row={row} scope={scope} version={data.version} onSaved={reloadAfterSave} disabled={!!error} />)}</div>}
    </>}
    <p className="mt-4 text-xs text-ink-faint">Signing in to Google, Gmail and other connected accounts still happens in Connections. Agent-specific keys stay in Agents. No background services restart automatically.</p>
  </Card></div>;
}
