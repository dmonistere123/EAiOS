import {it,expect,vi} from 'vitest';
import {render,screen,fireEvent,waitFor} from '@testing-library/react';
import {Inspector} from '../pages/Approvals';
import type {Approval} from '../domain/types';
const mocks=vi.hoisted(()=>({resume:vi.fn().mockResolvedValue({ok:true})}));
vi.mock('../adapters',()=>({hermes:{resumeApprovedTask:mocks.resume},adapterMode:'mock'}));
vi.mock('../state/runtime',()=>({useRuntime:()=>({work:[]}),agentName:(_s:unknown,id:string)=>id==='dev'?'Dev':'Ally',toast:vi.fn(),refreshApprovals:vi.fn().mockResolvedValue(undefined)}));
it.each([['dev','Dev'],[undefined,'Ally']])('shows and resumes the stored executor %s',async(executorProfileId,label)=>{
 const approval={id:'test',workItemId:'test',requestedByAgentId:'default',executorProfileId,status:'approved',executionState:'blocked',actionType:'execute',targetSystem:'eaios-local',risk:'low',submittedAt:new Date().toISOString(),evidence:[],reviewVersion:'approved-body',payload:'Prepared task'} as Approval;
 render(<Inspector approval={approval} onClose={()=>{}}/>);
 fireEvent.click(screen.getByRole('button',{name:`Resume with ${label}`}));
 await waitFor(()=>expect(mocks.resume).toHaveBeenLastCalledWith('test',executorProfileId??'default','approved-body'));
});
