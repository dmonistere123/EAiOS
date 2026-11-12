import type { Approval, WorkItem } from './types.ts';
import type { HumanDelegation } from './humanDelegation.ts';
import type { InsightReport } from './insights.ts';
export type AttentionKind = 'approvals' | 'delegated' | 'scheduled' | 'delivered';
export interface AttentionItem {
  id: string; title: string; status: string; at: string; kinds: AttentionKind[];
  route: string; detail?: string; reviewKey?: string; workItemId?: string;
}
export interface RecentScheduleRun {
  id: string; jobId: string; title: string; profile: string; status: string;
  at: string; finishedAt?: string; deliveryOutcome?: string; workItemId?: string;
}
export interface TodayActivity {
  runs: RecentScheduleRun[]; reviewed: string[]; report: InsightReport | null;
  links: Record<string, string[]>; warnings: string[];
}
export interface OutlookMeeting {
  id: string; title: string; startsAt: string; endsAt: string; allDay: boolean;
  location?: string; url?: string;
}
export interface TodayCalendar {
  email: string; events: OutlookMeeting[]; error?: string;
}
export interface TodayMeetings { calendars: TodayCalendar[]; fetchedAt: string }
export const inLastDay = (at: string, now: number) => Number.isFinite(Date.parse(at)) && Date.parse(at) > now - 86400000 && Date.parse(at) <= now;
export const needsDecision = (a: Approval) => !a.archived && (a.status === 'pending' || (a.status === 'approved' && a.executionState === 'blocked'));
export const recentApproval = (a: Approval, now: number) => !a.archived && inLastDay(a.updatedAt ?? a.submittedAt,now);
export const finishedRun = (status: string) => ['completed','complete','done','success','succeeded','ok','skipped','cancelled','canceled'].includes(status.toLowerCase());
/** Source identities, not similar titles, are the only basis for merging records. */
export function attentionItems(work: WorkItem[], approvals: Approval[], humans: HumanDelegation[], activity: TodayActivity, now: number) {
  const items: AttentionItem[] = [];
  const covered = new Set<string>();
  for (const a of approvals.filter(a=>needsDecision(a)&&recentApproval(a,now))) {
    items.push({id:`approval:${a.id}`, title:a.targetObject || 'Approval requested', status:a.status === 'pending' ? 'Needs decision' : 'Execution blocked', at:a.updatedAt??a.submittedAt, kinds:['approvals'], route:`/approvals?focus=${encodeURIComponent(a.id)}`});
    covered.add(a.workItemId);
    for (const parent of activity.links[a.workItemId] ?? []) covered.add(parent);
    if (a.humanDelegation) covered.add(`human:${a.humanDelegation.id}`);
  }
  for (const h of humans) {
    if (covered.has(`human:${h.id}`) || covered.has(h.workItemId)) continue;
    if (['draft','rejected','declined','cancelled','completed'].includes(h.status) || !inLastDay(h.updatedAt, now)) continue;
    const title = work.find(w=>w.id===h.workItemId)?.title ?? h.package?.subject ?? 'Human delegation';
    items.push({id:`human:${h.id}`, title, status:h.status.replaceAll('_',' '), at:h.updatedAt, kinds:['delegated'], route:'/human-assistant', detail:h.instructions, workItemId:h.workItemId});
    covered.add(h.workItemId);
  }
  for (const a of approvals.filter(a=>recentApproval(a,now) && a.status==='approved' && ['queued','running','failed'].includes(a.executionState ?? ''))) {
    if (covered.has(a.workItemId)) continue;
    items.push({id:`execution:${a.id}`, title:a.targetObject || 'Approved action', status:a.executionState ?? 'queued', at:a.updatedAt??a.submittedAt, kinds:['delegated'], route:`/approvals?focus=${encodeURIComponent(a.id)}`});
    covered.add(a.workItemId);
    for (const parent of activity.links[a.workItemId] ?? []) covered.add(parent);
  }
  for (const w of work) {
    if (covered.has(w.id)) continue;
    if (w.ownerType==='agent' && !['none','unassigned','null'].includes(w.ownerId?.trim().toLowerCase()??'') && !['complete','cancelled'].includes(w.state) && inLastDay(w.updatedAt,now)) items.push({id:`work:${w.id}`, title:w.title, status:w.state.replaceAll('_',' '), at:w.updatedAt, kinds:['delegated'], route:'/staff', detail:w.summary, workItemId:w.id});
  }
  for (const r of activity.runs.filter(r=>!finishedRun(r.status)&&inLastDay(r.finishedAt??r.at,now))) {
    const match = r.workItemId ? items.find(i=>i.workItemId===r.workItemId) : undefined;
    if (match) { match.kinds.push('scheduled'); continue; }
    items.push({id:`run:${r.id}`, title:r.title, status:r.status, at:r.finishedAt ?? r.at, kinds:['scheduled'], route:'/schedule', detail:`${r.profile} · Started ${r.at}${r.finishedAt ? ` · Finished ${r.finishedAt}` : ''}${r.deliveryOutcome ? ` · Delivery: ${r.deliveryOutcome}` : ''}`});
  }
  items.sort((a,b)=>Number(!a.kinds.includes('approvals'))-Number(!b.kinds.includes('approvals')) || Date.parse(b.at)-Date.parse(a.at));
  return { queue:items };
}
export function localDayRange(now = new Date()) {
  const start = new Date(now); start.setHours(0,0,0,0);
  const end = new Date(start); end.setDate(end.getDate()+1);
  return {start:start.toISOString(),end:end.toISOString()};
}
