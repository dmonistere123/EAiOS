export type ErmCategory = 'Customer' | 'Prospect' | 'Partner' | 'Other';
export interface ErmPhone { label: string; value: string }
export interface ErmAddress { label: string; street: string; line2: string; city: string; region: string; postal: string; country: string }
export interface ErmContactInput {
  name: string; company: string; title: string; category: ErmCategory; emails: string[];
  phones: ErmPhone[]; addresses: ErmAddress[]; website: string; preferred: string; tags: string[];
}
export interface ErmContact extends ErmContactInput {
  id: string; version: number; createdAt: string; updatedAt: string; archived: boolean;
  source: 'manual' | 'csv' | 'outlook';
}
export interface ErmNoteInput { title: string; body: string; includeInAI: boolean }
export interface ErmNote extends ErmNoteInput { id: string; contactId: string; version: number; createdAt: string; updatedAt: string }
export interface ErmPage<T> { items: T[]; nextCursor: string | null; hasMore: boolean; total: number }
export interface ErmEvidence { noteId: string; version: number; quote: string }
export interface ErmClaim { text: string; kind: 'observation' | 'suggestion'; evidence: ErmEvidence[] }
export interface ErmAnalysis { overview: ErmClaim[]; recommendations: ErmClaim[]; generatedAt: string; model: string; includedNotes: number; eligibleNotes: number }
export interface ErmJob { id: string; contactId: string; status: 'queued' | 'running' | 'completed' | 'failed'; kind: 'review' | 'question'; result?: ErmAnalysis; error?: string; createdAt: string }
export interface ErmCandidate { id: string; contact?: ErmContactInput; error?: string; existingId?: string; possibleDuplicate?: string }
export interface ErmImportPreview { id: string; source: 'csv' | 'outlook'; items: ErmCandidate[]; nextCursor?: string; account?: string; expiresAt: string }
export interface ErmImportReceipt { imported: number; skipped: number; contactIds: string[] }
export interface ErmStatus { model: { available: boolean; name?: string; reason?: string }; scope: 'single-executive'; evidence: 'notes'; outlook: 'on-demand'; preview?: boolean }
export interface ErmAccount { connectionId: string; email?: string; error?: string }
export const emptyErmContact = (): ErmContactInput => ({ name: '', company: '', title: '', category: 'Customer', emails: [], phones: [], addresses: [], website: '', preferred: '', tags: [] });
export const ERM_FIELDS = ['name','company','title','email','email2','mobile','workPhone','homePhone','street','line2','city','region','postal','country','website','preferred'] as const;
export type ErmCsvField = typeof ERM_FIELDS[number];
export type ErmCsvMapping = Partial<Record<ErmCsvField, string>>;
export class ErmError extends Error {
  status: number; code: string;
  constructor(status: number, code: string, message: string) { super(message); this.status = status; this.code = code; }
}
export function ermText(value: unknown, label: string, max: number, required = false): string {
  if (typeof value !== 'string' || value.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)) throw new ErmError(400, 'invalid_input', `Check ${label}.`);
  const text = value.trim(); if (required && !text) throw new ErmError(400, 'invalid_input', `${label} is required.`); return text;
}
export function validateErmContact(raw: unknown): ErmContactInput {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new ErmError(400, 'invalid_input', 'Provide a contact record.');
  const v = raw as Record<string, unknown>, input = emptyErmContact();
  for (const field of ['name','company','title','website','preferred'] as const) input[field] = ermText(v[field] ?? '', field, field === 'website' ? 1000 : 250, field === 'name');
  if (!['Customer','Prospect','Partner','Other'].includes(String(v.category ?? 'Customer'))) throw new ErmError(400, 'invalid_input', 'Choose a relationship category.');
  input.category = (v.category ?? 'Customer') as ErmCategory;
  const list = (key: string, max: number): unknown[] => { const value = v[key] ?? []; if (!Array.isArray(value) || value.length > max) throw new ErmError(400,'invalid_input',`Too many or invalid ${key}.`); return value; };
  input.emails = [...new Set(list('emails',10).map(e => { const s = ermText(e,'email',320,true); if (!/^[^\s<>@,;]+@[^\s<>@,;]+\.[^\s<>@,;]+$/.test(s)) throw new ErmError(400,'invalid_input','Check the email address.'); return s; }))];
  input.phones = list('phones',10).map(p => { if (!p || typeof p !== 'object') throw new ErmError(400,'invalid_input','Check phone numbers.'); const r = p as ErmPhone; return {label:ermText(r.label,'phone label',60,true),value:ermText(r.value,'phone number',80,true)}; });
  input.addresses = list('addresses',5).map(a => { if (!a || typeof a !== 'object') throw new ErmError(400,'invalid_input','Check addresses.'); const result = {} as ErmAddress; for (const key of ['label','street','line2','city','region','postal','country'] as const) result[key] = ermText((a as ErmAddress)[key] ?? '',key,300,key === 'label'); return result; });
  input.tags = list('tags',20).map(t => ermText(t,'tag',60,true));
  if (input.website) { try { const u = new URL(input.website); if (!['https:','http:'].includes(u.protocol) || u.username || u.password) throw Error(); } catch { throw new ErmError(400,'invalid_input','Website must start with https:// or http://.'); } }
  return input;
}
export function validateErmNote(raw: unknown): ErmNoteInput {
  const v = raw as ErmNoteInput; if (!v || typeof v.includeInAI !== 'boolean') throw new ErmError(400,'invalid_input','Choose whether this note may inform AI reviews.');
  return {title:ermText(v.title,'Note title',180,true),body:ermText(v.body,'Note text',50000,true),includeInAI:v.includeInAI};
}
