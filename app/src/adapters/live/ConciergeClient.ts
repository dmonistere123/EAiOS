import { CONCIERGE_LIMITS as LIMIT, validConciergeHistory, validConciergeInfo } from '../../domain/concierge';
import type { ConciergeInfo, ConciergeTurn } from '../../domain/concierge';
import type { AssistantEvent, AuditResult, ChatMessage } from '../../domain/types';

export const CONCIERGE_STORAGE = 'eaios.concierge.text.v1';
/** Browser-owned completed pairs only. No Hermes session, implicit submit or replay. */
export class ConciergeClient {
  private info?: ConciergeInfo;
  private rows: ConciergeTurn[] = [];
  private listeners = new Set<(event: AssistantEvent) => void>();
  private controller?: AbortController;
  subscribe(fn: (event: AssistantEvent) => void) { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; }
  private emit(event: AssistantEvent) { this.listeners.forEach(fn => fn(event)); }
  cancel() { this.controller?.abort(); }
  private async prepare(signal?: AbortSignal) {
    const response = await fetch('/api/concierge/context', { cache: 'no-store', signal: AbortSignal.any([AbortSignal.timeout(10000), ...(signal ? [signal] : [])]) });
    if (!response.ok) throw new Error('Concierge is unavailable. Ask your administrator to check its model configuration and credentials.');
    const data: unknown = await response.json();
    if (!validConciergeInfo(data)) throw new Error('Concierge configuration is unavailable.');
    if (this.info?.revision !== data.revision) {
      this.rows = [];
      try {
        const raw = localStorage.getItem(CONCIERGE_STORAGE);
        const saved = raw && raw.length < 160000 ? JSON.parse(raw) : null;
        if (saved?.revision === data.revision && validConciergeHistory(saved.history)) this.rows = saved.history;
      } catch { /* Corrupt/unavailable local storage never triggers a submit. */ }
    }
    this.info = data;
    return data;
  }
  async history(): Promise<ChatMessage[]> {
    await this.prepare();
    return this.rows.map((row, i) => ({ id: `concierge-${i}`, role: row.role === 'user' ? 'you' : 'ally', text: row.content, at: '' }));
  }
  async newChat(): Promise<AuditResult> {
    if (this.controller) return this.failure('Cancel the current reply before starting a new chat.');
    this.rows = [];
    try { localStorage.removeItem(CONCIERGE_STORAGE); }
    catch { return this.failure('Could not clear saved Concierge history. Check browser storage permissions.'); }
    return { ok: true, auditEventId: 'concierge-new' };
  }
  private failure(message: string): AuditResult {
    return { ok: false, auditEventId: 'concierge-failed', error: { code: 'concierge_failed', safeMessage: message, retryable: true } };
  }
  async send(text: string, currentRoute: string): Promise<AuditResult> {
    if (this.controller) return this.failure('A Concierge reply is already in progress.');
    if (!text.trim() || text.length > LIMIT.question) return this.failure('Use a question of at most 4,000 characters.');
    const controller = new AbortController(); this.controller = controller;
    this.emit({ kind: 'start' });
    try {
      const info = await this.prepare(controller.signal);
      controller.signal.throwIfAborted();
      const response = await fetch('/api/concierge/chat', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(50000)]),
        body: JSON.stringify({ revision: info.revision, history: this.rows, message: text, currentRoute }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(typeof result?.error === 'string' ? result.error : 'Concierge could not answer. No retry was sent.');
      if (result?.revision !== info.revision || typeof result?.answer !== 'string' || !result.answer.trim() || result.answer.length > LIMIT.answer) {
        throw new Error('Concierge returned an invalid reply. No retry was sent.');
      }
      controller.signal.throwIfAborted();
      this.rows = [...this.rows, { role: 'user', content: text }, { role: 'assistant', content: result.answer }];
      while (!validConciergeHistory(this.rows as unknown)) this.rows.splice(0, 2);
      let persisted = true;
      try { localStorage.setItem(CONCIERGE_STORAGE, JSON.stringify({ revision: info.revision, history: this.rows })); }
      catch { persisted = false; }
      this.emit({ kind: 'complete', text: result.answer });
      if (!persisted) this.emit({ kind: 'error', message: 'Reply received, but browser history could not be saved. Keep this tab open to retain it.' });
      return { ok: true, auditEventId: 'concierge-reply' };
    } catch (error) {
      const message = controller.signal.aborted
        ? 'Concierge request cancelled. The provider may already have processed it; no retry was sent.'
        : error instanceof Error && error.name !== 'TypeError' && error.name !== 'TimeoutError' && error.name !== 'SyntaxError'
          ? error.message : 'Concierge lost the connection or timed out. The provider may have processed the request; no retry was sent.';
      this.emit({ kind: 'error', message });
      return this.failure(message);
    } finally { this.controller = undefined; }
  }
}
