import type { AssistantAttachment } from '../interfaces';
import type { RequestView } from '../../domain/assistantRequest';
const KEY = 'eaios.assistant.requestReceipts';
/** Persist an ID before transmitting. A failed acknowledgement is reconciled by GET,
 * never by issuing another POST. New user submissions always get a new ID/session. */
export class AssistantRequestClient {
  private receipts(): RequestView[] { try { return JSON.parse(localStorage.getItem(KEY) ?? '[]'); } catch { return []; } }
  private save(rows: RequestView[]) { localStorage.setItem(KEY, JSON.stringify(rows)); }
  private async fetch(url: string, init: RequestInit = {}) {
    const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 10000);
    try {
      const response = await fetch(url, { ...init, signal: controller.signal });
      const body = await response.text(); // Keep the deadline through body delivery, not just headers.
      return { ok: response.ok, status: response.status, json: async () => JSON.parse(body) };
    } finally { clearTimeout(timer); }
  }
  async create(text: string, attachments: AssistantAttachment[] = []): Promise<RequestView> {
    const id = crypto.randomUUID(); const now = new Date().toISOString();
    const pending: RequestView = { id, text: text || 'Attached documents', state: 'reconnecting', revision: 0, response: '', progress: 'Confirming acceptance', createdAt: now, updatedAt: now };
    // If browser storage is unavailable, fail before sending rather than lose the receipt.
    this.save([...this.receipts(), pending]);
    try {
      const res = await this.fetch('/api/assistant/requests', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id, text, attachments }) });
      if (res.status === 400) { const result = { ...pending, state: 'interrupted' as const, error: 'The request was rejected before acceptance. Review the input.', progress: 'Not accepted' }; this.save(this.receipts().map(r => r.id === id ? result : r)); return result; }
      if (!res.ok) throw new Error('Acceptance uncertain');
      const row = await res.json() as RequestView;
      if (row.id !== id) throw new Error('Invalid receipt');
      return row;
    } catch {
      return { ...pending, error: 'Acceptance is uncertain. Checking the same request ID; nothing will be resent.' };
    }
  }
  async list(): Promise<RequestView[]> {
    const res = await this.fetch('/api/assistant/requests'); if (!res.ok) throw new Error('Connection lost — checking status. Work may still be running.');
    const data = await res.json() as { requests?: RequestView[] }; if (!Array.isArray(data.requests)) throw new Error('Invalid request status response');
    const received = new Set(data.requests.map(r => r.id));
    const unresolved = this.receipts().filter(r => !received.has(r.id));
    // Ask by ID as well: older receipts may be outside the server's recent-list window.
    const remaining: RequestView[] = [];
    for (const receipt of unresolved) {
      if (receipt.state === 'interrupted') { remaining.push(receipt); continue; }
      const lookup = await this.fetch(`/api/assistant/requests/${receipt.id}`);
      if (lookup.ok) data.requests.push(await lookup.json() as RequestView);
      else remaining.push({ ...receipt, progress: 'Acceptance not confirmed', error: 'No receipt is visible yet. Do not resend while the original outcome is uncertain.' });
    }
    this.save(remaining);
    return [...data.requests, ...remaining].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }
  async cancel(id: string) {
    const res = await this.fetch(`/api/assistant/requests/${encodeURIComponent(id)}/cancel`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    if (!res.ok) throw new Error('Cancellation not confirmed. Work may still be running.');
    return res.json() as Promise<RequestView>;
  }
}
