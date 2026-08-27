/** Settings — safe config surface + allowlisted .MD/.TXT environment editor. */
import { useEffect, useState } from 'react';
import type { EnvironmentFile } from '../domain/types';
import { hermes } from '../adapters';
import { resetPanePrefs } from '../app/AppShell';
import { toast } from '../state/runtime';
import { Card, SectionTitle, StateBadge } from '../components/ui';

function EnvFileEditor() {
  const [files, setFiles] = useState<{ id: string; name: string }[]>([]);
  const [open, setOpen] = useState<EnvironmentFile | null>(null);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void hermes.listEditableEnvironmentFiles().then((r) => setFiles(r.map((f) => ({ id: f.id, name: f.name }))));
  }, []);

  const openFile = async (id: string) => {
    const f = await hermes.readEnvironmentFile(id);
    setOpen(f);
    setDraft(f.content);
  };

  const save = async () => {
    if (!open) return;
    setSaving(true);
    const res = await hermes.writeEnvironmentFile(open.ref.id, open.version, draft);
    setSaving(false);
    if (res.ok) {
      toast('ok', `${open.ref.name} saved. Audit ${res.auditEventId}.`);
      setOpen(null);
    } else {
      toast('error', res.error?.safeMessage ?? 'Save failed.');
    }
  };

  const changed = open && draft !== open.content;

  return (
    <Card className="p-5">
      <SectionTitle right={<StateBadge label="allowlisted" tone="ok" />}>Environment files</SectionTitle>
      <p className="mb-3 text-xs text-ink-dim">Only explicitly approved .MD/.TXT files are editable. Saves are version-checked and audited. Secrets files are never listed.</p>
      {!open ? (
        <ul className="space-y-1.5">
          {files.map((f) => (
            <li key={f.id}>
              <button onClick={() => openFile(f.id)} className="w-full rounded-lg border border-edge bg-canvas px-3 py-2 text-left font-mono text-xs text-ink hover:border-signal/40">
                {f.name}
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="font-mono text-xs text-signal">{open.ref.name}</span>
            <button onClick={() => setOpen(null)} className="text-xs text-ink-faint hover:text-ink-dim">Close</button>
          </div>
          {changed && (
            <div className="rounded-lg border border-warn/30 bg-warn/5 p-3 text-xs">
              <div className="mb-1 font-medium text-warn">Unsaved changes</div>
              <pre className="max-h-28 overflow-y-auto whitespace-pre-wrap text-ink-dim">{draft.split('\n').filter((l, i) => l !== open.content.split('\n')[i]).map((l) => `+ ${l}`).join('\n') || '(edits)'}</pre>
            </div>
          )}
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={10}
            aria-label={`Editing ${open.ref.name}`}
            className="w-full rounded-lg border border-edge bg-canvas p-3 font-mono text-xs text-ink"
          />
          <button onClick={save} disabled={saving || !changed} className="rounded-lg bg-signal px-4 py-2 text-sm font-semibold text-canvas hover:bg-signal/90 disabled:opacity-50">
            {saving ? 'Saving…' : 'Save (version-checked)'}
          </button>
        </div>
      )}
    </Card>
  );
}

export default function Settings() {
  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="mt-1 text-sm text-ink-dim">The executive-safe slice of Hermes configuration. Everything here is audited.</p>
      </header>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="p-5">
          <SectionTitle right={<StateBadge label="mock — live write lands with agent factory (6.5)" tone="warn" />}>Model defaults</SectionTitle>
          <label className="block text-xs text-ink-dim" htmlFor="def-model">Default model for new agents</label>
          <select id="def-model" disabled className="mt-1 w-full rounded-lg border border-edge bg-canvas px-3 py-2 text-sm text-ink opacity-50">
            <option>kimi-coding / kimi-k3</option>
          </select>
          <p className="mt-2 text-xs text-ink-faint">Model writes go through <code className="text-signal">profiles.configure</code> with the live <code className="text-signal">model.options</code> catalog — arriving with the agent factory, not as a hardcoded list.</p>
        </Card>

        <Card className="p-5">
          <SectionTitle right={<StateBadge label="mock — policy editor not live yet" tone="warn" />}>Approval defaults</SectionTitle>
          {[
            ['External sends (email, messages)', true],
            ['Publishing (web, social)', true],
            ['Deletes & destructive updates', true],
            ['Reads & retrieval', false],
          ].map(([label, on]) => (
            <label key={label as string} className="mt-2 flex items-center justify-between rounded-lg border border-edge bg-canvas px-3 py-2 text-sm text-ink-dim opacity-60">
              {label}
              <input type="checkbox" defaultChecked={on as boolean} disabled className="accent-[#32c5ff]" aria-label={`Require approval: ${label}`} />
            </label>
          ))}
          <p className="mt-2 text-xs text-ink-faint">These reflect the built-in workspace policy (domain/policies.ts). An editable, persisted policy surface is a deferred roadmap item — this card never claimed a save it didn't make.</p>
        </Card>

        <Card className="p-5">
          <SectionTitle>Layout</SectionTitle>
          <p className="text-xs text-ink-dim">Pane widths and collapse state are stored per user. Reset returns to defaults (left 264px, rail 340px).</p>
          <button onClick={resetPanePrefs} className="mt-3 rounded-lg border border-warn/40 px-4 py-2 text-sm font-medium text-warn hover:bg-warn/10">Reset layout preferences</button>
        </Card>

        <EnvFileEditor />
      </div>
    </div>
  );
}
