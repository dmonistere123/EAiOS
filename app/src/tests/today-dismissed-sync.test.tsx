/** Review state replaces blanket backlog dismissal. Pending obligations cannot be hidden. */
import {beforeAll,beforeEach,afterEach,expect,it,vi} from 'vitest';
import {render,screen,fireEvent,within,waitFor} from '@testing-library/react';
import {MemoryRouter} from 'react-router-dom';
import Today from '../pages/Today';
import {today,hermes} from '../adapters';
import {refreshAll,startRuntime} from '../state/runtime';
import {useRailDeclaration} from '../state/rail';
import type {TodayActivity} from '../domain/today';
const at=new Date().toISOString();
let activity:TodayActivity;
function Rail(){const sections=useRailDeclaration();return <aside>{sections?.map(s=><section key={s.key}><h2>{s.title}</h2>{s.node}</section>)}</aside>;}
const show=()=>render(<MemoryRouter><Today/><Rail/></MemoryRouter>);
beforeAll(()=>startRuntime());
beforeEach(async()=>{
 activity={runs:[{id:'r',jobId:'j',title:'Daily brief ran',profile:'Ally',status:'completed',at}],links:{},reviewed:[],report:null,warnings:[]};
 vi.spyOn(today,'activity').mockImplementation(async()=>structuredClone(activity));
 vi.spyOn(today,'meetings').mockResolvedValue({fetchedAt:at,calendars:[]});
 vi.spyOn(today,'review').mockImplementation(async key=>{activity.reviewed.push(key);return [...activity.reviewed];});
 (hermes as unknown as {__loadFixture(p:unknown):void}).__loadFixture({work:[{id:'w',title:'Delivered brief',priority:'medium',ownerType:'agent',state:'complete',createdAt:at,updatedAt:at,result:'The completed output'},{id:'d',title:'Open delegation',priority:'medium',ownerType:'agent',state:'in_progress',createdAt:at,updatedAt:at}],approvals:[]});await refreshAll();
});
afterEach(()=>vi.restoreAllMocks());
it('persists a review across remounts while retaining the delivered result',async()=>{
 const first=show();const queue=screen.getByRole('region',{name:'Operating queue'});
 fireEvent.click(await within(queue).findByRole('button',{name:'Review Delivered brief'}));
 fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button',{name:'Mark reviewed'}));
 await waitFor(()=>expect(today.review).toHaveBeenCalledWith(`work:w:${at}`));
 await waitFor(()=>expect(within(queue).queryByText('Delivered brief')).not.toBeInTheDocument());
 expect(within(screen.getByRole('region',{name:'Delivered in the last 24 hours'})).getByText('Delivered brief')).toBeInTheDocument();first.unmount();show();
 await screen.findByText('Reviewed');expect(within(screen.getByRole('region',{name:'Operating queue'})).queryByText('Delivered brief')).not.toBeInTheDocument();
});
it('keeps unfinished delegations visible and offers no mark-reviewed action',async()=>{
 show();fireEvent.click(await screen.findByRole('button',{name:'Review Open delegation'}));expect(within(screen.getByRole('dialog')).queryByRole('button',{name:'Mark reviewed'})).not.toBeInTheDocument();expect(today.review).not.toHaveBeenCalled();
});
it('leaves a result in the queue when saving its review fails',async()=>{
 vi.mocked(today.review).mockRejectedValue(new Error('offline'));show();fireEvent.click(await screen.findByRole('button',{name:'Review Daily brief ran'}));fireEvent.click(within(screen.getByRole('dialog')).getByRole('button',{name:'Mark reviewed'}));await waitFor(()=>expect(today.review).toHaveBeenCalled());expect(screen.getByRole('button',{name:'Review Daily brief ran'})).toBeInTheDocument();
});
it('filters the full-day agenda and next meeting by the selected accounts',async()=>{
 const later=new Date(Date.now()+3600000).toISOString(),end=new Date(Date.now()+7200000).toISOString();
 vi.mocked(today.meetings).mockResolvedValue({fetchedAt:at,calendars:[{email:'one@example.com',events:[{id:'a',title:'First meeting',startsAt:later,endsAt:end,allDay:false}]},{email:'two@example.com',events:[{id:'b',title:'Second meeting',startsAt:end,endsAt:new Date(Date.now()+10800000).toISOString(),allDay:false}]}]});show();
 const rail=screen.getByRole('complementary');await within(rail).findByText('First meeting');fireEvent.click(within(rail).getByRole('checkbox',{name:'one@example.com'}));expect(within(rail).queryByText('First meeting')).not.toBeInTheDocument();expect(screen.getByText('Next meeting').parentElement).toHaveTextContent('Second meeting');
});
it('opens saved insights as a discussion without creating a task',async()=>{
 activity.report={id:'report',days:30,model:'test',snapshotId:'s',generatedAt:at,recommendations:[{title:'Delegate inbox review',why:'Repeated reviews',proposal:'Prepare a brief',firstStep:'Agree the scope',module:'Approvals',kind:'existing',effort:'small',evidenceIds:['email']}]};
 const create=vi.spyOn(hermes,'createWorkItem');show();await screen.findByText('Delegate inbox review');expect(screen.getByText('Delegatable',{selector:'div'}).parentElement).toHaveTextContent('1');fireEvent.click(screen.getByRole('button',{name:'Discuss with Ally'}));expect(create).not.toHaveBeenCalled();
});
it('keeps saved unassigned tasks accessible without adding them to priorities',async()=>{
 (hermes as unknown as {__loadFixture(p:unknown):void}).__loadFixture({work:[{id:'saved',title:'Saved idea',priority:'medium',ownerType:'executive',state:'ready',createdAt:at,updatedAt:at}]});await refreshAll();show();
 await screen.findByRole('button',{name:'Review Daily brief ran'});expect(screen.queryByText('Saved idea')).not.toBeInTheDocument();
 fireEvent.click(screen.getByRole('button',{name:'Saved tasks'}));expect(await screen.findByText('Saved idea')).toBeInTheDocument();fireEvent.click(within(screen.getByRole('dialog')).getByRole('button',{name:'Delegate'}));expect(await screen.findByRole('dialog')).toHaveTextContent('Delegate work');
});
