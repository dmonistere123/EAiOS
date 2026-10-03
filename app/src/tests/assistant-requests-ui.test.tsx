import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AssistantRequests } from '../components/AssistantRequests';
import type { RequestView } from '../domain/assistantRequest';
const api=vi.hoisted(()=>({listAssistantRequests:vi.fn(),createAssistantRequest:vi.fn(),cancelAssistantRequest:vi.fn()}));
vi.mock('../adapters',()=>({hermes:api}));
const request:RequestView={id:'request-visible-1',text:'Original prompt',state:'running',revision:1,response:'partial answer',progress:'Using a tool',createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()};
beforeEach(()=>{vi.useFakeTimers();api.listAssistantRequests.mockResolvedValue([request]);api.createAssistantRequest.mockResolvedValue({...request,id:'new-id',text:'second'});});
afterEach(()=>{vi.useRealTimers();vi.clearAllMocks();vi.unstubAllGlobals();});
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

class VoiceStub extends EventTarget {
 continuous=false;interimResults=false;lang='';start=vi.fn();stop=vi.fn();abort=vi.fn();
 result(text:string){this.dispatchEvent(Object.assign(new Event('result'),{resultIndex:0,results:[Object.assign([{transcript:text}],{isFinal:true})]}));}
}
it('voice pause submits one request only after three quiet seconds and recognition finalization',async()=>{
 let rec:VoiceStub;vi.stubGlobal('SpeechRecognition',vi.fn(function(){rec=new VoiceStub();return rec;}));
 const view=render(<AssistantRequests/>);await act(async()=>{});fireEvent.click(screen.getByRole('button',{name:'Speak to Ally'}));
 act(()=>rec.result('spoken request'));await act(async()=>{await vi.advanceTimersByTimeAsync(2999);});expect(api.createAssistantRequest).not.toHaveBeenCalled();
 await act(async()=>{await vi.advanceTimersByTimeAsync(1);rec.dispatchEvent(new Event('end'));});expect(api.createAssistantRequest).toHaveBeenCalledExactlyOnceWith('spoken request',[]);
 await act(async()=>{await vi.advanceTimersByTimeAsync(5000);rec.dispatchEvent(new Event('end'));});expect(api.createAssistantRequest).toHaveBeenCalledOnce();view.unmount();
});
it('manual Send cancels pending voice auto-send while retaining the visible draft',async()=>{
 let rec:VoiceStub;vi.stubGlobal('SpeechRecognition',vi.fn(function(){rec=new VoiceStub();return rec;}));
 const view=render(<AssistantRequests/>);await act(async()=>{});fireEvent.click(screen.getByRole('button',{name:'Speak to Ally'}));act(()=>rec.result('send manually'));
 expect(screen.getByRole('textbox',{name:'New prompt for Ally'})).toHaveValue('send manually');fireEvent.click(screen.getByRole('button',{name:'Send new prompt'}));
 await act(async()=>{rec.dispatchEvent(new Event('end'));await vi.advanceTimersByTimeAsync(6000);});expect(api.createAssistantRequest).toHaveBeenCalledExactlyOnceWith('send manually',[]);expect(rec!.abort).toHaveBeenCalledOnce();view.unmount();
});

it('New Session clears composition, preserves running work and restores completed requests from History', async () => {
  const completed = { ...request, id: 'finished', text: 'Earlier completed prompt', state: 'completed' as const, response: 'Saved answer' };
  api.listAssistantRequests.mockResolvedValue([completed, request]);
  const view = render(<AssistantRequests />); await act(async () => {});
  fireEvent.change(screen.getByRole('textbox', { name: 'New prompt for Ally' }), { target: { value: 'Unsent draft' } });
  const file = new File(['handoff'], 'handoff.md', { type: 'text/markdown' }); Object.assign(file, { text: async () => 'handoff' });
  fireEvent.change(screen.getByLabelText('Attach handoff or files'), { target: { files: [file] } }); await act(async () => {});
  expect(screen.getByRole('button', { name: 'handoff.md ×' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'New Session' }));
  expect(screen.getByRole('textbox', { name: 'New prompt for Ally' })).toHaveValue('');
  expect(screen.getByRole('textbox', { name: 'New prompt for Ally' })).toHaveFocus();
  expect(screen.queryByRole('button', { name: 'handoff.md ×' })).not.toBeInTheDocument();
  expect(screen.queryByText('Saved answer')).not.toBeInTheDocument(); expect(screen.getByText('Original prompt')).toBeInTheDocument();
  expect(screen.getByText('Earlier session · work continues')).toBeInTheDocument();
  expect(api.cancelAssistantRequest).not.toHaveBeenCalled(); expect(api.createAssistantRequest).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'History (1)' })); expect(screen.getByText('Saved answer')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Hide history' }));
  api.listAssistantRequests.mockResolvedValue([completed, { ...request, state: 'completed', response: 'Later completion' }]);
  await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
  fireEvent.click(screen.getByRole('button', { name: 'History (2)' })); expect(screen.getByText('Later completion')).toBeInTheDocument();
  view.unmount(); render(<AssistantRequests />); await act(async () => {}); expect(screen.getByText('Saved answer')).toBeInTheDocument();
});

it('paperclip opens the multiple-file picker, preserves payloads, and is keyboard-accessible', async () => {
  vi.useRealTimers();
  const { default: userEvent } = await import('@testing-library/user-event');
  const user = userEvent.setup();
  const view = render(<AssistantRequests />); await act(async () => {});
  const picker = screen.getByLabelText('Attach handoff or files'); expect(picker).toHaveAttribute('multiple');
  const click = vi.spyOn(picker, 'click'); const button = screen.getByRole('button', { name: 'Attach files' });
  button.focus(); await user.keyboard('{Enter}'); expect(click).toHaveBeenCalledOnce(); expect(api.createAssistantRequest).not.toHaveBeenCalled();
  const a = new File(['first'], 'a.md', { type: 'text/markdown' }); Object.assign(a, { text: async () => 'first' });
  const b = new File(['second'], 'b.txt', { type: 'text/plain' }); Object.assign(b, { text: async () => 'second' });
  fireEvent.change(picker, { target: { files: [a, b] } }); await act(async () => {});
  fireEvent.click(screen.getByRole('button', { name: 'Send new prompt' })); await act(async () => {});
  expect(api.createAssistantRequest).toHaveBeenCalledExactlyOnceWith('', [
    { name: 'a.md', mimeType: 'text/markdown', content: 'first', encoding: 'text' },
    { name: 'b.txt', mimeType: 'text/plain', content: 'second', encoding: 'text' },
  ]); click.mockRestore(); view.unmount();
});

it('New Session stops pending dictation without submitting or cancelling running requests', async () => {
  let rec: VoiceStub; vi.stubGlobal('SpeechRecognition', vi.fn(function () { rec = new VoiceStub(); return rec; }));
  const view = render(<AssistantRequests />); await act(async () => {});
  fireEvent.click(screen.getByRole('button', { name: 'Speak to Ally' })); act(() => rec.result('unfinished dictation'));
  fireEvent.click(screen.getByRole('button', { name: 'New Session' }));
  await act(async () => { rec.dispatchEvent(new Event('end')); await vi.advanceTimersByTimeAsync(6000); });
  expect(rec!.abort).toHaveBeenCalledOnce(); expect(api.createAssistantRequest).not.toHaveBeenCalled(); expect(api.cancelAssistantRequest).not.toHaveBeenCalled();
  expect(screen.getByRole('textbox', { name: 'New prompt for Ally' })).toHaveValue(''); view.unmount();
});
