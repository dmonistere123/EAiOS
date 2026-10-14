import {afterEach,expect,it,vi} from 'vitest';
import {render,screen,cleanup} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {MemoryRouter} from 'react-router-dom';
vi.mock('../adapters',()=>({adapterMode:'live',hermes:{}}));
vi.mock('../state/rail',()=>({usePageRail:()=>{}}));
vi.mock('../state/runtime',()=>({useRuntime:()=>({artifacts:[{id:'att-1',name:'Example.md',mimeType:'text/markdown',sizeBytes:100,state:'ready',createdAt:'2026-10-14T00:00:00Z',createdByAgentId:'agent',previewAvailable:false}]}),agentName:()=> 'Agent',refreshArtifacts:vi.fn(),refreshApprovals:vi.fn(),toast:vi.fn()}));
import Artifacts from '../pages/Artifacts';
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
it('requires a separate confirmation, supports cancel, and sends only the selected artifact ID',async()=>{
 const fetcher=vi.fn().mockResolvedValue({ok:true,json:async()=>({ok:true})});vi.stubGlobal('fetch',fetcher);const user=userEvent.setup();render(<MemoryRouter><Artifacts/></MemoryRouter>);
 await user.click(screen.getByRole('button',{name:'Delete'}));expect(fetcher).not.toHaveBeenCalled();expect(screen.getByText(/This cannot be undone/)).toBeInTheDocument();
 await user.click(screen.getByRole('button',{name:'Cancel'}));expect(fetcher).not.toHaveBeenCalled();
 await user.click(screen.getByRole('button',{name:'Delete'}));await user.click(screen.getByRole('button',{name:'Delete permanently'}));
 expect(fetcher).toHaveBeenCalledWith('/api/artifacts/att-1',expect.objectContaining({method:'DELETE'}));
});
