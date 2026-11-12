import {expect,it} from 'vitest';
import {attentionItems,inLastDay,localDayRange} from '../domain/today';
import type {TodayActivity} from '../domain/today';
import type {WorkItem,Approval} from '../domain/types';
import type {HumanDelegation} from '../domain/humanDelegation';
const now=Date.parse('2026-11-12T18:00:00Z'),at=new Date(now-60000).toISOString();
const activity:TodayActivity={runs:[],reviewed:[],report:null,links:{},warnings:[]};
const work=(patch:Partial<WorkItem>={}):WorkItem=>({id:'w',title:'Task',priority:'medium',state:'ready',ownerType:'executive',createdAt:at,updatedAt:at,...patch});
const approval=(patch:Partial<Approval>={}):Approval=>({id:'a',workItemId:'w',requestedByAgentId:'ally',actionType:'send',targetSystem:'outlook',risk:'low',status:'pending',submittedAt:at,evidence:[],...patch});
const human=(patch:Partial<HumanDelegation>={}):HumanDelegation=>({id:'h',workItemId:'w',contactId:'c',status:'in_progress',instructions:'Prepare brief',revision:1,createdAt:at,updatedAt:at,...patch});
it('excludes executive backlog, cancelled work, stale and future completions',()=>{
 const rows=[work(),work({id:'c',ownerType:'agent',state:'cancelled'}),work({id:'old',state:'complete',updatedAt:new Date(now-86400001).toISOString()}),work({id:'future',state:'complete',updatedAt:new Date(now+1000).toISOString()})];
 expect(attentionItems(rows,[],[],activity,now).queue).toHaveLength(0);
});
it('retains old unfinished AI and human delegations, regardless of review state',()=>{
 const rows=attentionItems([work({ownerType:'agent',updatedAt:'2020-01-01'})],[],[human({id:'h2',workItemId:'w2'})],{...activity,reviewed:['work:w:2020-01-01','human:h2:1']},now);
 expect(rows.queue).toHaveLength(2);expect(rows.queue.every(r=>!r.reviewKey)).toBe(true);
});
it('counts approval plus underlying work only once and keeps independent approvals',()=>{
 const rows=attentionItems([work({ownerType:'agent'})],[approval(),approval({id:'a2',workItemId:'w2'})],[human()],activity,now);
 expect(rows.queue).toHaveLength(2);expect(rows.queue.every(i=>i.kinds.includes('approvals'))).toBe(true);
});
it('deduplicates explicit parent links and human approval identities',()=>{
 const rows=attentionItems([work({ownerType:'agent'})],[approval({workItemId:'approval-task',humanDelegation:{id:'h'}})],[human()],{...activity,links:{'approval-task':['w']}},now);
 expect(rows.queue).toHaveLength(1);
});
it('does not hide different work with the same title and tracks approved execution',()=>{
 const rows=attentionItems([work({id:'other',ownerType:'agent',title:'Task'})],[approval({status:'approved',executionState:'running',targetObject:'Task'})],[],activity,now);
 expect(rows.queue).toHaveLength(2);
});
it('review clears priority but retains delivery and a new revision reappears',()=>{
 const w=work({state:'complete'}),key=`work:w:${at}`;
 expect(attentionItems([w],[],[],{...activity,reviewed:[key]},now)).toMatchObject({queue:[],delivered:[{id:'work:w'}]});
 expect(attentionItems([{...w,updatedAt:new Date(now).toISOString()}],[],[],{...activity,reviewed:[key]},now).queue).toHaveLength(1);
});
it('uses actual runs, a rolling window and explicit schedule/work identity',()=>{
 const r={id:'r',jobId:'j',title:'Run',profile:'Ally',at,status:'completed',workItemId:'w'};
 const rows=attentionItems([work({state:'complete'})],[],[],{...activity,runs:[r,{...r,id:'old',at:new Date(now-86400001).toISOString()}]},now);
 expect(rows.queue).toHaveLength(1);expect(rows.queue[0].kinds).toEqual(['delivered','scheduled']);
 expect(inLastDay(new Date(now-86400000).toISOString(),now)).toBe(false);
});
it('computes local midnight boundaries rather than a trailing calendar window',()=>{
 const d=new Date('2026-11-12T18:00:00Z'),r=localDayRange(d);expect(new Date(r.start).getHours()).toBe(0);expect(new Date(r.end).getDate()).toBe(new Date(r.start).getDate()+1);
});

it('keeps delivery history when its approval occupies the priority slot',()=>{const r=attentionItems([work({state:'complete'})],[approval()],[],activity,now);expect(r.queue).toHaveLength(1);expect(r.queue[0].kinds).toEqual(['approvals']);expect(r.delivered).toHaveLength(1);});
