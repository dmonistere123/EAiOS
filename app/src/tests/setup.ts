import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';
import { resetRailForTests } from '../state/rail';

// Pages declare rail sections into a module-level store (W2); clear any
// leaked declaration between tests so suites stay independent.
afterEach(() => resetRailForTests());

// Unmount React trees between tests so background runtime refreshes don't
// trigger act(...) warnings on still-mounted components.
afterEach(() => cleanup());

// Node-environment suites (e.g. authoring-store) have no DOM — guards below.
if (typeof window !== 'undefined') {
  /**
   * Node 26 ships its own `localStorage` getter (internal/webstorage) that
   * returns `undefined` unless a --localstorage-file is configured, and it
   * shadows jsdom's storage when vitest populates the test global. Rebind to
   * jsdom's real backing store (`window._localStorage`) so code under test —
   * the 6.4a assistant session persists its stored id in localStorage — sees
   * browser-faithful behavior.
   */
  const backing = (window as unknown as { _localStorage?: Storage })._localStorage;
  if (backing) {
    Object.defineProperty(window, 'localStorage', { value: backing, configurable: true });
  }
}

// jsdom doesn't implement Element.scrollTo (the Assistant page auto-scrolls).
if (typeof Element !== 'undefined' && !Element.prototype.scrollTo) {
  Element.prototype.scrollTo = () => undefined;
}
