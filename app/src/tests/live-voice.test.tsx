import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, cleanup } from '@testing-library/react';
import { LiveVoice, voicePrompt } from '../components/LiveVoice';
import { hermes } from '../adapters';
vi.mock('../adapters',()=>({hermes:{createAssistantRequest:vi.fn(),listAssistantRequests:vi.fn()}}));
const mocks=vi.hoisted(()=>({handlers:null as any,speak:vi.fn(),dispose:vi.fn(),start:vi.fn(),status:vi.fn(),mute:vi.fn()}));
vi.mock('../lib/voiceLive',()=>({fetchVoiceLiveStatus:mocks.status,toLiveHistory:(v:unknown)=>v,VoiceLiveSession:class {constructor(h:unknown){mocks.handlers=h;}start=mocks.start;speak=mocks.speak;dispose=mocks.dispose;setMuted=mocks.mute;think=vi.fn();instruct=vi.fn();}}));
const fragment={speaker:'user' as const,text:'Prepare a reply for approval',startMs:0,endMs:1};
const row={id:'r1',text:fragment.text,state:'completed' as const,response:'A draft is ready for approval.',progress:'',revision:1,createdAt:'2026-11-07',updatedAt:'2026-11-07',conversationId:'c1'};
beforeEach(()=>{vi.clearAllMocks();mocks.status.mockResolvedValue({available:true,mode:'gpt-live'});mocks.start.mockImplementation(async()=>{mocks.handlers.onReady?.();});});
afterEach(()=>{cleanup();vi.restoreAllMocks();});
async function start(props:Partial<Parameters<typeof LiveVoice>[0]>={}) {const accepted=vi.fn();const view=render(<LiveVoice conversation={{id:'c1',title:'Test'}} history={[]} disabled={false} onStart={()=>{}} onAccepted={accepted} {...props}/>);fireEvent.click(screen.getByText('Start voice mode'));await screen.findByText('Listening — you can speak naturally');return {...view,accepted};}
it('routes voice through the durable request path once per delegation and speaks the saved result',async()=>{
 const create=vi.spyOn(hermes,'createAssistantRequest').mockResolvedValue(row);const {accepted}=await start();
 act(()=>{mocks.handlers.onDelegation('d1',[fragment]);mocks.handlers.onDelegation('d1',[fragment]);});
 await waitFor(()=>expect(mocks.speak).toHaveBeenCalledWith('d1',row.response));
 expect(create).toHaveBeenCalledTimes(1);expect(create).toHaveBeenCalledWith(fragment.text,[],{id:'c1',profile:undefined});expect(accepted).toHaveBeenCalledWith(row);
});
it('does not automatically retry an ambiguous submission',async()=>{
 const create=vi.spyOn(hermes,'createAssistantRequest').mockRejectedValue(new Error('network'));
 await start();act(()=>mocks.handlers.onDelegation('d1',[fragment]));await screen.findByText(/Could not confirm the voice request/);expect(create).toHaveBeenCalledTimes(1);
});
it('ends voice when switching conversations and ignores late delegations',async()=>{
 const create=vi.spyOn(hermes,'createAssistantRequest');const view=await start();
 view.rerender(<LiveVoice conversation={{id:'c2',title:'Other'}} history={[]} disabled={false} onStart={()=>{}} onAccepted={()=>{}}/>);
 expect(mocks.dispose).toHaveBeenCalled();act(()=>mocks.handlers.onDelegation('late',[fragment]));expect(create).not.toHaveBeenCalled();
});
it('stops the microphone on End and on unmount',async()=>{const view=await start();fireEvent.click(screen.getByText('End voice mode'));expect(mocks.dispose).toHaveBeenCalledTimes(1);view.unmount();});
it('does not start a provider session when configuration is unavailable',async()=>{mocks.status.mockResolvedValue({available:false});render(<LiveVoice history={[]} disabled={false} onStart={()=>{}} onAccepted={()=>{}}/>);fireEvent.click(screen.getByText('Start voice mode'));await screen.findByRole('alert');expect(mocks.start).not.toHaveBeenCalled();});
it('joins transcript deltas into the latest user request',()=>{expect(voicePrompt([{...fragment,text:'Hello '},{...fragment,text:'there'},{...fragment,speaker:'assistant',text:'Hi'},{...fragment,text:'Please '},{...fragment,text:'help'}])).toBe('Please help');});
