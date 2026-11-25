import {expect,it,vi} from 'vitest';
import {render,screen,within} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {MemoryRouter} from 'react-router-dom';
import type {Approval} from '../domain/types';
import Approvals from '../pages/Approvals';

const mock=vi.hoisted(()=>({getApproval:vi.fn(),decideApproval:vi.fn(),toast:vi.fn(),refresh:vi.fn(async()=>{})}));
vi.mock('../adapters',()=>({hermes:{getApproval:mock.getApproval,decideApproval:mock.decideApproval},humanDelegation:{},social:{},adapterMode:'live'}));
vi.mock('../state/runtime',()=>({useRuntime:()=>({work:[]}),selectPendingApprovals:()=>[],agentName:()=> 'Ally',toast:mock.toast,refreshApprovals:mock.refresh,removeConfirmedApproval:vi.fn()}));

const id='crm_mail_'+'a'.repeat(32);
it('opens a freshly queued CRM draft even when the list is stale and waits for explicit approval', async()=>{
 const draft:Partial<Approval>={id,workItemId:id,requestedByAgentId:'default',status:'pending',risk:'medium',actionType:'send',targetSystem:'outlook',targetObject:'Follow-up from E-CRM',submittedAt:'2026-11-21T00:00:00Z',reviewVersion:'reviewed envelope',evidence:[],ermQuickEmail:{contactId:'contact',noteId:'note'},mailDraft:{identity:{connectionId:'ca_test',email:'owner@example.test',provider:'outlook',providerUserId:'owner',verifiedAt:'2026-11-21T00:00:00Z'},to:['taylor@example.test'],cc:[],bcc:[],bodyType:'Text',subject:'Follow-up from E-CRM',body:'Which date works for you?'}};
 mock.getApproval.mockResolvedValue(draft);
 mock.decideApproval.mockResolvedValue({ok:true,auditEventId:'audit'});
 render(<MemoryRouter initialEntries={['/approvals?focus='+id]}><Approvals/></MemoryRouter>);
 const card=await screen.findByRole('region',{name:'E-CRM email review'});
 expect(within(card).getByText(/owner@example\.test/)).toBeInTheDocument();
 expect(within(card).getByText(/taylor@example\.test/)).toBeInTheDocument();
 expect(within(card).getByText(/Follow-up from E-CRM/)).toBeInTheDocument();
 expect(within(card).getByText('Which date works for you?')).toBeInTheDocument();
 expect(within(card).getByRole('link',{name:'Open E-CRM note'})).toHaveAttribute('href','/erm?contact=contact&note=note');
 expect(mock.getApproval).toHaveBeenCalledWith(id);
 expect(mock.decideApproval).not.toHaveBeenCalled();
 await userEvent.click(screen.getByRole('button',{name:'Approve & send'}));
 expect(mock.decideApproval).toHaveBeenCalledExactlyOnceWith(id,{decision:'approved',reviewVersion:'reviewed envelope'});
});
