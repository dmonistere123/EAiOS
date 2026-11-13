import { useEffect, useRef, useState } from 'react';
import { hermes } from '../adapters';
import type { AssistantConversation, RequestView } from '../domain/assistantRequest';
import type { ChatMessage } from '../domain/types';
import { VoiceLiveSession, fetchVoiceLiveStatus, toLiveHistory, type LiveTranscriptFragment } from '../lib/voiceLive';

export function voicePrompt(fragments: LiveTranscriptFragment[]): string {
 const turns: {speaker:string;text:string}[]=[];
 for (const f of fragments) { const last=turns.at(-1);if(last?.speaker===f.speaker)last.text+=f.text;else turns.push({speaker:f.speaker,text:f.text}); }
 return [...turns].reverse().find(t=>t.speaker==='user')?.text.trim().slice(0,12000) ?? '';
}
const terminal=(row:RequestView)=>['completed','recovered','cancelled','interrupted'].includes(row.state);
export function LiveVoice({conversation,history,disabled,onStart,onAccepted}:{conversation?:AssistantConversation|null;history:ChatMessage[];disabled:boolean;onStart:()=>void;onAccepted:(row:RequestView)=>void}) {
 const [state,setState]=useState('off');const [error,setError]=useState('');const [captions,setCaptions]=useState<LiveTranscriptFragment[]>([]);const [muted,setMuted]=useState(false);
 const session=useRef<VoiceLiveSession|null>(null);const generation=useRef(0);const binding=useRef<AssistantConversation|null>(null);
 const latest=useRef({conversation,history,disabled,onStart,onAccepted});latest.current={conversation,history,disabled,onStart,onAccepted};
 const stop=()=>{generation.current++;const old=session.current;session.current=null;old?.dispose();setState('off');setMuted(false);};
 useEffect(()=>()=>{generation.current++;session.current?.dispose();session.current=null;},[]);
 useEffect(()=>{
  if(session.current && (conversation?.id!==binding.current?.id || conversation?.profile!==binding.current?.profile)) stop();
  // Only a deliberate conversation change ends a connected voice session.
  // eslint-disable-next-line react-hooks/exhaustive-deps
 },[conversation?.id,conversation?.profile]);
 async function start() {
  if(session.current||latest.current.disabled)return;
  const epoch=++generation.current;setState('connecting');setError('');setCaptions([]);setMuted(false);
  binding.current=latest.current.conversation ?? null;latest.current.onStart();
  const seen=new Set<string>();let queue=Promise.resolve();
  const live=new VoiceLiveSession({
   onReady:()=>{if(generation.current===epoch){setState('listening');live.instruct('You are Ally, the voice assistant in 2EP. Refer to the application as 2EP. Outbound communications require the executive to approve in the 2EP Approvals module. Spoken agreement does not bypass that approval workflow.');}},
   onClosed:()=>{if(generation.current===epoch){session.current=null;generation.current++;setState('off');setMuted(false);}},
   onError:(message,fatal)=>{if(generation.current===epoch){setError(message);if(fatal)stop();}},
   onSpeakingChange:speaking=>{if(generation.current===epoch)setState(speaking?'speaking':'listening');},
   onTranscript:fragment=>{if(generation.current===epoch)setCaptions(current=>[...current,fragment].slice(-120));},
   onDelegation:(id,fragments)=>{
    if(generation.current!==epoch||seen.has(id))return;seen.add(id);
    const prompt=voicePrompt(fragments);
    if(!prompt){live.speak(id,'I did not receive a clear request. Please repeat it.');return;}
    if(/^(stop voice|end voice|stop voice mode|end voice mode)[.!]?$/i.test(prompt)){stop();return;}
    queue=queue.then(async()=>{
     if(generation.current!==epoch)return;
     setState('working');live.think(id,'2EP is handling your request.');
     let row:RequestView;
     try {
      // Same durable request and approval path as the text composer. Never execute tools here.
      row=await hermes.createAssistantRequest!(prompt,[],binding.current?{id:binding.current.id,profile:binding.current.profile}:undefined);
     } catch {
      if(generation.current===epoch){setError('Could not confirm the voice request. Check the conversation before trying again.');live.speak(id,'I could not confirm that request. Please check the chat before trying again.');}
      return;
     }
     const deadline=Date.now()+15*60*1000;
     while(generation.current===epoch) {
      const conversationId=row.conversationId??row.storedSessionId;
      if(conversationId && !binding.current)binding.current={id:conversationId,title:prompt.slice(0,80),profile:row.profile};
      if(conversationId)latest.current.onAccepted(row);
      if(terminal(row)) {
       live.speak(id,row.response || (row.error?'2EP could not complete the request. Please check the chat.':'The request stopped without a final answer. Please check the chat.'));
       setState('listening');return;
      }
      if(Date.now()>deadline){setError('This request is still running. Follow its progress in the chat.');live.speak(id,'This is taking longer. You can follow the request in the chat.');return;}
      await new Promise(resolve=>setTimeout(resolve,1500));
      if(generation.current!==epoch)return;
      try {const rows=await hermes.listAssistantRequests!();row=rows.find(r=>r.id===row.id)??row;}catch {setError('Connection interrupted. The saved request may still be running; it will not be resubmitted.');}
     }
    }).catch(()=>{if(generation.current===epoch)setError('Voice could not finish this turn. Check the saved request in the chat.');});
   },
  },conversation?.profile??null);
  session.current=live;
  try {
   const status=await fetchVoiceLiveStatus(conversation?.profile);
   if(generation.current!==epoch)return;
   if(!status?.available||status.mode!=='gpt-live')throw new Error('Enable live voice in Hermes Desktop settings first.');
   const turns=latest.current.history.filter(m=>m.role==='you'||m.role==='ally').map(m=>({role:m.role==='you'?'user' as const:'assistant' as const,text:m.text}));
   await live.start(toLiveHistory(turns));
  } catch(e){if(generation.current===epoch){setError(e instanceof Error?e.message:'Could not start voice.');stop();}}
 }
 return <div className="rounded-lg border border-edge bg-canvas p-3">
  <div className="flex flex-wrap items-center gap-3">
   {state==='off'?<button type="button" disabled={disabled} onClick={()=>void start()} className="rounded-lg bg-signal px-3 py-2 text-sm font-semibold text-canvas disabled:opacity-50">Start voice mode</button>:<>
    <button type="button" onClick={stop} className="rounded-lg border border-risk px-3 py-2 text-sm">End voice mode</button>
    <button type="button" onClick={()=>{session.current?.setMuted(!muted);setMuted(!muted);}} className="text-sm text-signal">{muted?'Unmute microphone':'Mute microphone'}</button>
    <span role="status" className="text-xs text-ink-dim">{muted?'Microphone muted':state==='connecting'?'Connecting…':state==='working'?'Working on your request…':state==='speaking'?'Ally is speaking':'Listening — you can speak naturally'}</span>
   </>}
  </div>
  {state==='off'&&<p className="mt-2 text-xs text-ink-dim">Uses your Hermes live voice settings. Spoken work requests use the same approvals as typed requests.</p>}
  {error&&<p role="alert" className="mt-2 text-xs text-risk">{error}</p>}
  {captions.length>0&&<details className="mt-2 text-xs text-ink-dim"><summary>Live captions</summary><div className="mt-2 max-h-32 overflow-y-auto whitespace-pre-wrap">{captions.map((c,i)=><span key={i}>{i===0||captions[i-1].speaker!==c.speaker?`\n${c.speaker==='user'?'You':'Ally'}: `:''}{c.text}</span>)}</div><p>Work requests and answers are saved in the chat. These live captions last until the next voice session.</p></details>}
 </div>;
}
