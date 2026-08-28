/**
 * Contextual right rail (D-B4, beta plan W2): the mounted page may DECLARE
 * its rail sections; AppShell renders them instead of the default
 * watchtower. Pages without a declaration keep the default rail.
 *
 * One page is mounted at a time, so a single module-level declaration
 * suffices — no route registry. The declaring page owns its data and
 * lifecycle; the declaration clears on unmount.
 */
import { useEffect, useSyncExternalStore } from 'react';
import type { ReactNode } from 'react';

export interface RailSectionDef {
  key: string;
  title: string;
  count?: number;
  node: ReactNode;
}

let current: RailSectionDef[] | null = null;
const listeners = new Set<() => void>();

function setCurrent(next: RailSectionDef[] | null) {
  if (current === next) return;
  current = next;
  listeners.forEach((l) => l());
}

export function subscribeRail(fn: () => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function getRail() {
  return current;
}

export function useRailDeclaration(): RailSectionDef[] | null {
  return useSyncExternalStore(subscribeRail, getRail);
}

/**
 * Declare this page's rail sections. Sets on mount / when the array identity
 * changes, clears on unmount. Pass a memoized array (useMemo) so unrelated
 * renders don't re-run the effect.
 */
export function usePageRail(sections: RailSectionDef[]) {
  useEffect(() => {
    setCurrent(sections);
    return () => setCurrent(null);
  }, [sections]);
}

/** Test hook: reset any leaked declaration between tests. */
export function resetRailForTests() {
  setCurrent(null);
}
