/** Staging DCR contracts. Proposed changes are never confirmed records. */
export type DcrKind = 'decision' | 'commitment' | 'relationship';
export type DcrStatus = 'open' | 'blocked' | 'completed' | 'archived';
export interface DcrFields {
  kind: DcrKind; title: string; what: string; why: string; status: DcrStatus;
  owner: string; direction: 'i_owe' | 'owed_to_me' | 'none'; dueDate: string;
  organization: string; email: string; completionEvidence: string;
  priority: 'normal' | 'high'; snoozedUntil: string;
  decisionOptions: string; recommendation: string; decisionOutcome: string; decisionRationale: string; decidedOn: string;
  promisor: string; promisee: string; blockers: string;
  personName: string; role: string; importance: 'not_set' | 'standard' | 'important' | 'key';
  preferences: string; lastInteractionDate: string; lastInteractionNote: string;
}
export interface DcrRecord extends DcrFields {
  id: string; revision: number; updatedAt: string; createdAt: string; sourceIds: string[]; linkedIds: string[];
}
export interface DcrSource { origin?:import('./dcrScanner.ts').ScanOrigin; id: string; title: string; text: string; hash: string; active: boolean; fixture: boolean; createdAt: string; artifact?: {id:string; version:string}; }
export type DcrWorkKind = 'task' | 'human';
export interface DcrArtifact { id:string; title:string; taskTitle:string; }
export interface DcrArtifactPreview extends DcrArtifact { text:string; version:string; }
export interface DcrWork { kind:DcrWorkKind; id:string; title:string; status:string; owner:string; summary:string; version:string; }
export interface DcrWorkLink { recordId:string; kind:DcrWorkKind; id:string; work:DcrWork|null; }
export interface DcrConnections { label:string; artifacts:DcrArtifact[]; work:DcrWork[]; errors:string[]; }
export interface DcrCitation { sourceId: string; quote: string; }
export interface DcrSuggestion { fields: DcrFields; citations: DcrCitation[]; basis: 'source' | 'executive_statement' | 'inference'; }
export interface DcrAnswer { reply: string; citations: DcrCitation[]; suggestions: DcrSuggestion[]; }
export interface DcrRequest {
  id: string; intent?: 'discuss' | 'propose' | 'extract'; recordId: string | null; revision: number | null; prompt: string; sourceIds: string[];
  state: 'running' | 'complete' | 'failed' | 'interrupted' | 'stale'; answer?: DcrAnswer; error?: string;
  createdAt: string; accepted: boolean;
}
export interface DcrHistory { id: number; recordId: string; action: string; at: string; detail: string; }
export interface DcrSnapshot { scanner?:import('./dcrScanner.ts').ScannerStatus; staging?:boolean; workLinks?:DcrWorkLink[]; followUps?:{id:string;recordId:string;status:string;receiptId?:string}[]; records: DcrRecord[]; sources: DcrSource[]; requests: DcrRequest[]; history: DcrHistory[]; assistantName: string; aiAvailable: boolean; }
export function blankDcr(kind: DcrKind = 'commitment'): DcrFields {
  return {kind, title:'', what:'', why:'', status:'open', owner:'', direction:kind==='commitment'?'i_owe':'none', dueDate:'', organization:'', email:'', completionEvidence:'', priority:'normal', snoozedUntil:'', decisionOptions:'', recommendation:'', decisionOutcome:'', decisionRationale:'', decidedOn:'', promisor:'', promisee:'', blockers:'', personName:'', role:'', importance:'not_set', preferences:'', lastInteractionDate:'', lastInteractionNote:''};
}
/** Date-only attention uses calendar days, not elapsed hours or guessed deadlines. */
export function localDcrDate(date=new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
}
export function dcrStatus(record: Pick<DcrFields,'kind'|'status'> & Partial<Pick<DcrFields,'decisionOutcome'>>): string {
  if (record.status === 'completed') return record.kind === 'decision' ? record.decisionOutcome === '' ? 'Closed · decision details missing' : 'Decision recorded' : record.kind === 'commitment' ? 'Fulfilled' : 'Closed';
  return record.status[0].toUpperCase()+record.status.slice(1);
}
export function dcrAttention(record: DcrRecord, today: string, dueSoonDays=7): string | null {
  if (record.status === 'completed' || record.status === 'archived' || record.snoozedUntil > today) return null;
  if (record.priority === 'high') return 'Pinned by you';
  if (record.dueDate && record.dueDate < today) return record.kind === 'relationship' ? 'Follow-up overdue' : 'Overdue · follow up';
  if (record.status === 'blocked' || record.blockers) return 'Blocked · needs your help';
  if (record.dueDate === today) return record.kind === 'relationship' ? 'Follow-up today' : 'Due today';
  const end=new Date(today+'T12:00:00Z'); end.setUTCDate(end.getUTCDate()+dueSoonDays);
  if (record.dueDate && record.dueDate <= end.toISOString().slice(0,10)) return record.kind === 'relationship' ? 'Follow-up due soon' : 'Due soon';
  if (record.kind === 'decision') return 'Decision needed';
  if (!record.owner && record.kind === 'commitment') return 'Confirm who owns this promise';
  return null;
}
export function dcrAttentionRank(record:DcrRecord,today:string):number {
  if(record.priority==='high')return 0;
  if(record.dueDate && record.dueDate<today)return 1;
  if(record.status==='blocked'||record.blockers)return 2;
  if(record.dueDate===today)return 3;
  return record.kind==='decision'?5:4;
}

export function dcrCitationTitle(snapshot:DcrSnapshot,sourceId:string):string {
  const source=snapshot.sources.find(s=>s.id===sourceId);if(source)return source.title;
  const link=snapshot.workLinks?.find(l=>`work:${l.kind}:${l.id}`===sourceId&&l.work);
  return link?`Linked ${link.kind==='human'?'HI delegation':'agent task'} report · ${link.work!.title}`:'Source unavailable';
}
