import {expect,it} from 'vitest';
import {attentionItems,inLastDay,localDayRange} from '../domain/today';
import type {TodayActivity} from '../domain/today';
import type {WorkItem,Approval} from '../domain/types';
import type {HumanDelegation} from '../domain/humanDelegation';
const now=Date.parse('2026-11-12T18:00:00Z'),at=new Date(now-60000).toISOString(),old=new Date(now-86400001).toISOString();
const activity:TodayActivity={runs:[],reviewed:[],report:null,links:{},warnings:[]};
const work=(patch:Partial<WorkItem>={}):WorkItem=>({id:'w',title:'Task',priority:'medium',state:'ready',ownerType:'agent',ownerId:'ally',createdAt:at,updatedAt:at,...patch});
const approval=(patch:Partial<Approval>={}):Approval=>({id:'a',workItemId:'w',requestedByAgentId:'ally',actionType:'send',targetSystem:'outlook',risk:'low',status:'pending',submittedAt:at,evidence:[],...patch});
const human=(patch:Partial<HumanDelegation>={}):HumanDelegation=>({id:'h',workItemId:'w',contactId:'c',status:'in_progress',instructions:'Prepare brief',revision:1,createdAt:at,updatedAt:at,...patch});
it('excludes executive backlog, completed, cancelled, old and future work',()=>{
 const rows=[work({ownerType:'executive'}),work({id:'done',state:'complete'}),work({id:'c',state:'cancelled'}),work({id:'old',updatedAt:old}),work({id:'future',updatedAt:new Date(now+1000).toISOString()})];expect(attentionItems(rows,[],[],activity,now).queue).toHaveLength(0);
});
it('includes recent unfinished AI and human work, including blockers',()=>{expect(attentionItems([work({state:'blocked'})],[],[human({workItemId:'h-work'})],activity,now).queue).toHaveLength(2);});
it('excludes old and completed human delegations',()=>{expect(attentionItems([],[],[human({updatedAt:old}),human({id:'done',status:'completed'})],activity,now).queue).toHaveLength(0);});
it('applies the same 24-hour window to approvals and uses latest recorded decision time',()=>{
 const rows=attentionItems([],[approval({submittedAt:old}),approval({id:'new-decision',submittedAt:old,updatedAt:at,status:'approved',executionState:'queued'})],[],activity,now).queue;expect(rows).toHaveLength(1);expect(rows[0].id).toBe('execution:new-decision');
});
it('never resurrects archived approvals even if approved recently',()=>{expect(attentionItems([],[approval({archived:true}),approval({id:'approved',archived:true,status:'approved',executionState:'queued'})],[],activity,now).queue).toHaveLength(0);});
it('excludes placeholder assignees',()=>{expect(attentionItems(['none','unassigned','NULL'].map((ownerId,i)=>work({id:String(i),ownerId})),[],[],activity,now).queue).toHaveLength(0);});
it('counts approval plus underlying work once and retains independent approvals',()=>{const r=attentionItems([work()],[approval(),approval({id:'a2',workItemId:'w2'})],[human()],activity,now);expect(r.queue).toHaveLength(2);expect(r.queue.every(i=>i.kinds.includes('approvals'))).toBe(true);});
it('deduplicates explicit parent links and human approval identities',()=>{expect(attentionItems([work()],[approval({workItemId:'approval-task',humanDelegation:{id:'h'}})],[human()],{...activity,links:{'approval-task':['w']}},now).queue).toHaveLength(1);});
it('keeps different tasks with the same title',()=>{expect(attentionItems([work(),work({id:'other'})],[],[],activity,now).queue).toHaveLength(2);});
it('excludes finished housekeeping and completed runs, retaining recent failures',()=>{
 const r={id:'r',jobId:'j',title:'Run',profile:'Ally',at,status:'completed'};
 const rows=attentionItems([],[],[],{...activity,runs:[r,{...r,id:'failure',status:'failed'},{...r,id:'old',status:'failed',at:old}]},now).queue;expect(rows).toHaveLength(1);expect(rows[0].id).toBe('run:failure');expect(rows[0].reviewKey).toBeUndefined();
});
it('uses an exclusive trailing cutoff and local midnight calendar boundaries',()=>{expect(inLastDay(new Date(now-86400000).toISOString(),now)).toBe(false);const r=localDayRange(new Date(now));expect(new Date(r.start).getHours()).toBe(0);expect(new Date(r.end).getDate()).toBe(new Date(r.start).getDate()+1);});
