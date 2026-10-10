/** Social Studio drafts are plans, never evidence of publication. */
export const SOCIAL_NETWORKS = ['linkedin', 'x', 'snapchat'] as const;
export type SocialNetwork = typeof SOCIAL_NETWORKS[number];
export const NETWORK_LABELS: Record<SocialNetwork, string> = { linkedin: 'LinkedIn', x: 'X', snapchat: 'Snapchat' };
export interface SocialBrief {
  subject: string;
  voice: string;
  identity: string;
  networks: SocialNetwork[];
  days: number[];
  startDate: string;
  endDate?: string;
  time: string;
  timeZone: string;
  count: number;
  imageStyle: 'graphic' | 'photo' | 'none';
  kind: 'post' | 'blog';
  sourceUrl?: string;
  sourceText?: string;
}
export interface SocialPost {
  id: string;
  revision: number;
  title: string;
  copy: string;
  network: SocialNetwork | 'blog';
  identity: string;
  plannedDate: string;
  time: string;
  timeZone: string;
  imagePrompt: string;
  imageVersion?: string;
  status: 'draft' | 'reviewed' | 'published' | 'archived';
  sourceUrl?: string;
  createdAt: string;
  publishedAt?: string;
  publishedUrl?: string;
}
export interface SocialBoard { posts: SocialPost[]; brief: SocialBrief | null; }
export interface SocialCapabilities { text: boolean; images: boolean; composio: boolean; publishing: false; }
export function plannedDates(start: string, days: number[], count: number): string[] {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start)) throw new Error('Choose a valid start date.');
  const date = new Date(start + 'T12:00:00Z');
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== start) throw new Error('Choose a valid start date.');
  if (!days.length || days.some(d => !Number.isInteger(d) || d < 0 || d > 6) || !Number.isInteger(count) || count < 1 || count > 31) throw new Error('Choose posting days and between one and 31 dates.');
  const result: string[] = [];
  while (result.length < count) {
    if (days.includes(date.getUTCDay())) result.push(date.toISOString().slice(0, 10));
    date.setUTCDate(date.getUTCDate() + 1);
  }
  return result;
}
export function socialHistory(posts: SocialPost[], now = Date.now()) {
  return posts.filter(p => p.status === 'published' && p.publishedAt && now - Date.parse(p.publishedAt) < 30 * 86400000);
}
export function socialArchive(posts: SocialPost[], now = Date.now()) {
  return posts.filter(p => p.status === 'archived' || (p.status === 'published' && p.publishedAt && now - Date.parse(p.publishedAt) >= 30 * 86400000));
}

export const SOCIAL_LIMITS = { linkedin: 850, x: 280, snapchat: 250, blog: 12000 };
/** Conservative X count: wide characters count twice; URLs reserve at least 23. */
export function socialCopyLength(copy: string, network: SocialPost['network']) {
  if (network !== 'x') return [...copy].length;
  const weight = (s: string) => [...s].reduce((n,c) => n + (c.codePointAt(0)! <= 0x10ff || (c.codePointAt(0)! >= 0x2000 && c.codePointAt(0)! <= 0x200d) || (c.codePointAt(0)! >= 0x2010 && c.codePointAt(0)! <= 0x201f) || (c.codePointAt(0)! >= 0x2032 && c.codePointAt(0)! <= 0x2037) ? 1 : 2), 0);
  return copy.split(/(https?:\/\/[^\s]+)/g).reduce((n,part) => n + (/^https?:\/\//.test(part) ? Math.max(23,weight(part)) : weight(part)), 0);
}
export function socialDates(brief: SocialBrief): string[] {
  if (!brief.endDate || brief.kind === 'blog') return plannedDates(brief.startDate, brief.days, brief.count);
  plannedDates(brief.startDate,brief.days,1);
  plannedDates(brief.endDate,[0,1,2,3,4,5,6],1);
  const span = (Date.parse(brief.endDate)-Date.parse(brief.startDate))/86400000;
  if (span < 0 || span > 30) throw new Error('Choose an end date within 31 days of the start date.');
  const dates = plannedDates(brief.startDate,brief.days,31).filter(d=>d<=brief.endDate!);
  if (!dates.length) throw new Error('Choose a date range that includes your posting days.');
  return dates;
}
export function socialPlan(brief: SocialBrief) {
  const angles = ['a practical first step','a common mistake to avoid','a question to discuss','a short checklist','a clearly hypothetical example','a useful measurement','a tradeoff to consider','a team exercise','a misconception to challenge','a process improvement','an actionable reflection','a next step for the reader'];
  return socialDates(brief).map((date,index)=>({date,angle:angles[index%angles.length],instruction:`Installment ${index+1}: explore a new subtopic of the monthly theme with a fresh takeaway and opening.`}));
}
