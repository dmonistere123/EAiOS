import { useEffect, useRef, useState } from 'react';

const button = 'rounded-lg border border-edge px-3 py-2 text-sm disabled:opacity-40';
type Item = { id: string };
/** Selection is confined to the rendered window and the current filter scope. */
export function useBulkDelete<T extends Item>({ rows, scope, label, name, kind, eligible, remove, refresh, explanation, disabled = false }: {
  rows: T[]; scope: string; label: string; name: (item: T) => string; kind: (item: T) => string;
  eligible: (item: T) => boolean; remove: (item: T) => Promise<unknown>; refresh: () => Promise<unknown>;
  explanation: string; disabled?: boolean;
}) {
  const [selection, setSelection] = useState<{ scope: string; ids: string[] }>({ scope, ids: [] });
  const [confirmation, setConfirmation] = useState<{ scope: string; items: T[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState<{ text: string; errors: string[] } | null>(null);
  const running = useRef(false), mounted = useRef(true);
  const dialog = useRef<HTMLDialogElement>(null);
  const currentScope = useRef(scope);
  useEffect(() => { currentScope.current = scope; }, [scope]);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const available = rows.filter(eligible);
  const ids = selection.scope === scope ? selection.ids.filter(id => available.some(row => row.id === id)) : [];
  // Reconcile removals and filter changes so an old selection cannot reappear.
  const key = JSON.stringify([scope, available.map(row => row.id)]);
  useEffect(() => {
    setSelection(old => ({ scope, ids: old.scope === scope ? old.ids.filter(id => available.some(row => row.id === id)) : [] }));
    setConfirmation(null);
    // Only scope/membership changes invalidate a reviewed snapshot; revision checks remain server-side.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  const pending = confirmation?.scope === scope ? confirmation.items : [];
  useEffect(() => {
    const node = dialog.current;
    if (pending.length && node && !node.open) node.showModal();
    else if (!pending.length) node?.close();
  }, [confirmation, scope, pending.length]);
  const locked = disabled || busy;
  function open(items: T[]) { if (!locked && items.length) { setReport(null); setConfirmation({ scope, items: items.filter(eligible) }); } }
  function toggle(id: string) { if (!locked) setSelection({ scope, ids: ids.includes(id) ? ids.filter(x => x !== id) : [...ids, id] }); }
  async function execute() {
    if (running.current || disabled || !pending.length) return;
    running.current = true; setBusy(true);
    const errors: string[] = []; let succeeded = 0, attempted = 0;
    for (const item of pending) {
      if (!mounted.current || currentScope.current !== scope) break; // navigation stops unsent requests; an in-flight request may finish
      attempted++;
      try { await remove(item); succeeded++; }
      catch (error) { errors.push(`${name(item)}: ${error instanceof Error ? error.message : 'Deletion could not be confirmed. Refresh before retrying.'}`); }
    }
    if (mounted.current) {
      setSelection({ scope, ids: [] }); setConfirmation(null);
      try { await refresh(); } catch { errors.push('The list could not refresh. Reload before selecting more items.'); }
      setReport({ text: `${succeeded} of ${attempted} ${label} deleted. Selection cleared.`, errors });
      setBusy(false);
    }
    running.current = false;
  }
  const types = [...new Set(pending.map(kind))].map(type => `${pending.filter(item => kind(item) === type).length} ${type}`).join(', ');
  return {
    busy, open,
    checkbox: (item: T) => <input type="checkbox" aria-label={`Select ${name(item)}`} checked={ids.includes(item.id)} disabled={locked || !eligible(item)} onChange={() => toggle(item.id)} />,
    toolbar: <div className="sticky top-0 z-10 mb-3 rounded-lg border border-edge bg-canvas-raised p-3">
      <div className="flex flex-wrap items-center gap-3"><button className={button} disabled={locked || !available.length} onClick={() => setSelection({ scope, ids: available.map(row => row.id) })}>Select all shown ({available.length})</button>
        <span role="status">{ids.length} selected</span><button className={button} disabled={locked || !ids.length} onClick={() => setSelection({ scope, ids: [] })}>Clear selection</button>
        <button className={button+' text-risk'} disabled={locked || !ids.length} onClick={() => open(available.filter(row => ids.includes(row.id)))}>Delete selected</button></div>
      <p className="mt-2 text-xs text-ink-dim">Only eligible {label} currently shown in this list are selected. Hidden items are excluded.</p>
      {report && <div role={report.errors.length ? 'alert' : 'status'} className="mt-2 text-sm"><p>{report.text}</p>{report.errors.length > 0 && <><p>Some deletions could not be confirmed. Refresh and review before retrying.</p><ul className="max-h-48 overflow-auto">{report.errors.map((error, i) => <li key={i}>{error}</li>)}</ul></>}</div>}
    </div>,
    confirmation: <dialog ref={dialog} aria-labelledby={`delete-${label}-title`} onCancel={e => { e.preventDefault(); if (!running.current) setConfirmation(null); }} className="fixed inset-0 m-auto max-h-[85vh] w-[min(36rem,95vw)] overflow-y-auto rounded-xl border border-edge bg-canvas-raised p-6 text-ink backdrop:bg-black/60">
      <h2 id={`delete-${label}-title`} className="text-lg font-semibold">Delete {pending.length} {label}?</h2>
      <p className="my-3 text-sm">{types}</p><p className="text-sm text-ink-dim">{explanation}</p>
      <ul className="my-4 max-h-48 list-disc overflow-y-auto pl-5 text-sm">{pending.map(item => <li className="break-words" key={item.id}>{name(item)}</li>)}</ul>
      <div className="flex gap-3"><button autoFocus className={button} disabled={busy} onClick={() => setConfirmation(null)}>Cancel</button><button className={button+' text-risk'} disabled={locked} onClick={() => void execute()}>{busy ? 'Deleting…' : 'Delete permanently'}</button></div>
    </dialog>,
  };
}
