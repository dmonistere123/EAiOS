import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AssistantRequests } from '../components/AssistantRequests';
import type { RequestView } from '../domain/assistantRequest';
const api=vi.hoisted(()=>({listAssistantRequests:vi.fn(),createAssistantRequest:vi.fn(),cancelAssistantRequest:vi.fn()}));
vi.mock('../adapters',()=>({hermes:api}));
const request:RequestView={id:'request-visible-1',text:'Original prompt',state:'running',revision:1,response:'partial answer',progress:'Using a tool',createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()};
beforeEach(()=>{vi.useFakeTimers();api.listAssistantRequests.mockResolvedValue([request]);api.createAssistantRequest.mockResolvedValue({...request,id:'new-id',text:'second'});});
afterEach(()=>{vi.useRealTimers();vi.clearAllMocks();});
it('shows pending work after refresh, retains it offline, and renders late response and artifacts',async()=>{
  const view=render(<AssistantRequests/>);await act(async()=>{});expect(screen.getByText('Original prompt')).toBeInTheDocument();expect(screen.getByText('partial answer')).toBeInTheDocument();
  api.listAssistantRequests.mockRejectedValue(new Error('offline'));await act(async()=>{await vi.advanceTimersByTimeAsync(2000);});expect(screen.getByText(/Connection lost/)).toBeInTheDocument();expect(screen.getByText('partial answer')).toBeInTheDocument();
  api.listAssistantRequests.mockResolvedValue([{...request,state:'completed',response:'Final result',artifacts:[{id:'att-1',name:'result.pdf',taskId:'t-1',url:'/api/artifacts/att-1/raw'}]}]);
  await act(async()=>{await vi.advanceTimersByTimeAsync(2000);});expect(screen.getByText('Final result')).toBeInTheDocument();expect(screen.getByRole('link',{name:'result.pdf'})).toHaveAttribute('href','/api/artifacts/att-1/raw');expect(screen.queryByText('Cancel this request')).not.toBeInTheDocument();view.unmount();
});
it('cancels by original request ID and can submit a distinct prompt while earlier work runs',async()=>{
  api.cancelAssistantRequest.mockResolvedValue({...request,state:'cancelling',cancelRequested:true});const view=render(<AssistantRequests/>);await act(async()=>{});
  fireEvent.click(screen.getByText('Cancel this request'));await act(async()=>{});expect(api.cancelAssistantRequest).toHaveBeenCalledWith(request.id);expect(screen.getByText('Waiting for cancellation')).toBeDisabled();
  fireEvent.change(screen.getByRole('textbox',{name:'New prompt for Ally'}),{target:{value:'second'}});fireEvent.click(screen.getByText('Send new prompt'));await act(async()=>{});expect(api.createAssistantRequest).toHaveBeenCalledWith('second',[]);view.unmount();
});
