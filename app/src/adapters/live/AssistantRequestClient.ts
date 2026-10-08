import type { AssistantAttachment } from '../interfaces';
import type { RequestView } from '../../domain/assistantRequest';
const KEY = 'eaios.assistant.requestReceipts';
const ACTIVE = new Set(['accepted', 'running', 'reconnecting', 'cancelling']);
const CACHE_BYTES = 1500000;
/** Browser cache is a bounded, explicitly stale display checkpoint. Server receipts and
 * Hermes remain authoritative. Evict only terminal display copies, never active IDs. */
export class AssistantRequestClient {
  private receipts(): RequestView[] { try { const rows = JSON.parse(localStorage.getItem(KEY) ?? '[]'); return Array.isArray(rows) ? rows : []; } catch { return []; } }
  cached(): RequestView[] { return this.receipts().map(r => ({ ...r, stale: true })); }
  private save(rows: RequestView[]) {
    const compact = rows.map(r => ({ ...r, text: r.revision === 0 ? r.text : r.text.slice(0, 4096), response: r.response.slice(0, 8192), artifacts: r.artifacts?.slice(0, 20), taskIds: r.taskIds?.slice(0, 20), cacheLimited: r.cacheLimited || r.text.length > 4096 || r.response.length > 8192 || (r.artifacts?.length ?? 0) > 20, error: r.error?.slice(0, 1000) }));
    const active = compact.filter(r => ACTIVE.has(r.state));
    if (active.length > 32 || new Blob([JSON.stringify(active)]).size > CACHE_BYTES) throw new Error('Active recovery cache full; existing receipts preserved');
    const result = [...active];
    for (const r of compact.filter(r => !ACTIVE.has(r.state)).sort((a,b) => b.createdAt.localeCompare(a.createdAt)).slice(0,20)) {
      if (new Blob([JSON.stringify([...result,r])]).size > CACHE_BYTES) break;
      result.push(r);
    }
    localStorage.setItem(KEY, JSON.stringify(result));
  }
  private merge(incoming: RequestView[]): RequestView[] {
    const rows = new Map(this.receipts().map(r => [r.id, { ...r, stale: true }]));
    for (const r of incoming) { const previous = rows.get(r.id); if (!previous || r.revision >= previous.revision) rows.set(r.id, { ...r, stale: false, cacheLimited: false }); }
    return [...rows.values()].sort((a,b) => a.createdAt.localeCompare(b.createdAt));
  }
  private async fetch(url: string, init: RequestInit = {}) {
    const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 10000);
    try { const response = await fetch(url, { ...init, signal: controller.signal }); const body = await response.text(); return { ok: response.ok, status: response.status, json: async () => JSON.parse(body) }; }
    finally { clearTimeout(timer); }
  }
  async create(text: string, attachments: AssistantAttachment[] = [], conversation?: { id: string; profile?: string }): Promise<RequestView> {
    const id = crypto.randomUUID(), now = new Date().toISOString();
    const pending: RequestView = { id, conversationId: conversation?.id, profile: conversation?.profile, text: text || 'Attached documents', state: 'reconnecting', revision: 0, response: '', progress: 'Confirming acceptance', createdAt: now, updatedAt: now };
    this.save([...this.receipts(),pending]); // Fail before transmission if recovery storage is unavailable.
    try {
      const response = await this.fetch('/api/assistant/requests', { method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({id,text,attachments,...(conversation ? {conversation} : {})}) });
      if ([400,409,429].includes(response.status)) {
        const rejected = { ...pending, state:'interrupted' as const, progress:'Not accepted', error: response.status === 429 ? 'Request capacity reached. Existing requests were preserved; review/export before adding more.' : 'Request rejected before acceptance. Review the input.' };
        this.save(this.merge([rejected])); return rejected;
      }
      if (!response.ok) throw new Error('Uncertain acceptance');
      const row = await response.json() as RequestView; if (row.id !== id) throw new Error('Invalid receipt');
      this.save(this.merge([row])); return row;
    } catch { return { ...pending, error:'Acceptance is uncertain. Checking the same ID; nothing will be resent.' }; }
  }
  async list(): Promise<RequestView[]> {
    const response = await this.fetch('/api/assistant/requests'); if (!response.ok) throw new Error('Connection lost — cached state may be stale.');
    const data = await response.json() as {requests?:RequestView[]}; if (!Array.isArray(data.requests)) throw new Error('Invalid status response');
    const received = new Set(data.requests.map(r => r.id));
    const missing = this.receipts().filter(r => ACTIVE.has(r.state) && !received.has(r.id));
    // At most four extra lookups per tick, rotating so old receipts cannot starve new ones.
    const batch = missing.length ? Array.from({length:Math.min(4,missing.length)},(_,i)=>missing[(this.cursor+i)%missing.length]) : [];
    this.cursor += batch.length;
    for (const cached of batch) {
      const lookup = await this.fetch(`/api/assistant/requests/${encodeURIComponent(cached.id)}`);
      if (lookup.ok) data.requests.push(await lookup.json() as RequestView);
      // A 404 is not permission to resend, nor a reason to erase cached context.
    }
    const merged = this.merge(data.requests); this.save(merged); return merged;
  }
  private cursor = 0;
  async cancel(id:string) {
    const response = await this.fetch(`/api/assistant/requests/${encodeURIComponent(id)}/cancel`, {method:'POST',headers:{'content-type':'application/json'},body:'{}'});
    if (!response.ok) throw new Error('Cancellation not confirmed. Work may still be running.');
    const row = await response.json() as RequestView; this.save(this.merge([row])); return row;
  }
}
