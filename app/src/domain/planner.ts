export const lanes = ['one', 'three', 'five', 'backlog'] as const;
export type Lane = typeof lanes[number];
export const laneLabels: Record<Lane,string> = {one:'The One',three:'The Three',five:'The Five',backlog:'Backlog'};
export const limits = {one:1,three:3,five:5,backlog:Infinity};
export const quickHits = ['Exercise','Read 15m','Write 15m','Pray','Birthdays','Give Praise','Gain Allygnment'] as const;
export type TaskState = 'not_started'|'in_progress'|'blocked'|'done';
export type TaskSource = {kind:'crm-follow-up'; contactId:string; noteId:string};
export const repeatLabels={none:'Does not repeat',daily:'Daily',weekdays:'Weekdays',weekly:'Weekly',monthly:'Monthly'} as const;
export type RepeatKind=Exclude<keyof typeof repeatLabels,'none'>;
export interface RepeatRule {kind:RepeatKind; startsOn:string; endsOn:string}
export interface Task {
  id:string; day:string; lane:Lane; rank:number; title:string; detail:string; due:string;
  state:TaskState; archived:boolean; parentId:string|null; carryAge:number; createdAt:string; revision:number;
  source:TaskSource|null;
  shareable?:boolean; repeat?:RepeatRule; occurrence?:{sourceId:string;day:string};
}
export const dayRatings = {great:"Great Day",good:"Good Day",difficult:"Difficult Day"} as const;
export type DayRating = keyof typeof dayRatings;
export interface Journal {notes:string; entries:{id:string; at:string; text:string}[]; hits:string[]; gratitude:string; reflection:string; legacy:string; rating:DayRating|number|null; revision:number}
export interface TimeEntry {id:string; day:string; clientId:string; clientName:string; started:string; ended:string; timezone?:string; seconds:number; notes:string}
export interface Client {id:string; name:string}
export interface Attachment {id:string; name:string; size:number; sha256:string}
export interface PreviewDelegation {id:string; recipient:"ally"|"human"; objective:string; expected:string; context:string[]; fileNames:string[]; state:"pending"|"review"|"accepted"|"rejected"; result:string}
export interface PlanSummary {one:Pick<Task,"title"|"state">|null; three:{done:number;total:number}; five:{done:number;total:number}}
export interface DayPlan {tasks:Task[]; previouslyPlaced:Task[]; journal:Journal; files:Record<string,Attachment[]>; delegations:Record<string,PreviewDelegation>; time:TimeEntry[]; clients:Client[]; previousOpen?:{day:string;count:number}; scheduled?:Task[]}
export function localDay(date = new Date()) {
  return [date.getFullYear(),String(date.getMonth()+1).padStart(2,'0'),String(date.getDate()).padStart(2,'0')].join('-');
}
export function shiftDay(day:string, days:number) {const d=new Date(day+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+days);return d.toISOString().slice(0,10);}
export function recurrenceMatches(rule:RepeatRule,day:string) {
  if(day<rule.startsOn||rule.endsOn&&day>rule.endsOn)return false;
  const date=new Date(day+'T12:00:00Z'),start=new Date(rule.startsOn+'T12:00:00Z'),weekday=date.getUTCDay();
  if(rule.kind==='daily')return true;
  if(rule.kind==='weekdays')return weekday>=1&&weekday<=5;
  if(rule.kind==='weekly')return weekday===start.getUTCDay();
  const last=new Date(Date.UTC(date.getUTCFullYear(),date.getUTCMonth()+1,0)).getUTCDate();
  return date.getUTCDate()===Math.min(start.getUTCDate(),last);
}
export function shareableTaskCsv(day:string,tasks:Task[]) {
  const escape=(value:string)=>'"'+(/^[\s]*[=+\-@]|^[\t\r\n]/.test(value)?"'"+value:value).replaceAll('"','""')+'"';
  return [['Plan date','Task','Lane','Status','Due date'],...tasks.filter(t=>t.shareable&&!t.archived).map(t=>[day,t.title,laneLabels[t.lane],t.state,t.due])].map(row=>row.map(escape).join(',')).join('\r\n');
}
export function emptyJournal(): Journal {return {notes:'',entries:[],hits:[],gratitude:'',reflection:'',legacy:'',rating:null,revision:0};}
export const datePattern=/^20\d{2}-\d{2}-\d{2}$/;
export function validPlannerDate(s:unknown):s is string {return typeof s==='string'&&datePattern.test(s)&&Number.isFinite(Date.parse(s))&&new Date(s).toISOString().slice(0,10)===s;}
