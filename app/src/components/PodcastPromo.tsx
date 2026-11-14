import { useEffect, useRef, useState } from 'react';
import { podcastPromo } from '../adapters';
import type { PromoSnapshot } from '../domain/podcastPromo';
import { AGENT_NAME } from '../config';
import './podcast-promo-preview.css';

export function PodcastPromo({podcastId,pauseAudio}:{podcastId:string;pauseAudio:()=>void}){
  const [snapshot,setSnapshot]=useState<PromoSnapshot>();
  const [selectedId,setSelectedId]=useState('');const [prompt,setPrompt]=useState('');const [scope,setScope]=useState('Entire video');
  const [error,setError]=useState('');const [sending,setSending]=useState(false);const [expanded,setExpanded]=useState(false);const [captions,setCaptions]=useState(false);
  const video=useRef<HTMLVideoElement>(null);const input=useRef<HTMLTextAreaElement>(null);
  const jobs=snapshot?.jobs??[];const ready=jobs.filter(j=>j.status==='ready');const selected=ready.find(j=>j.id===selectedId)??ready[0];
  const active=jobs.find(j=>['queued','running'].includes(j.status));const latest=jobs[0];
  async function refresh(){const next=await podcastPromo.list(podcastId);setSnapshot(next);}
  useEffect(()=>{let mounted=true;const load=()=>podcastPromo.list(podcastId).then(s=>{if(mounted)setSnapshot(s);}).catch(e=>{if(mounted)setError(e.message);});void load();const timer=setInterval(()=>void load(),3000);return()=>{mounted=false;clearInterval(timer);};},[podcastId]);
  useEffect(()=>{const element=video.current;if(!element)return;const onChange=()=>setCaptions(element.textTracks[0]?.mode==='showing');element.textTracks.addEventListener('change',onChange);return()=>element.textTracks.removeEventListener('change',onChange);},[selected?.id]);
  useEffect(()=>{const stopWhenAudioPlays=(event:Event)=>{if(event.target instanceof HTMLAudioElement)video.current?.pause();};document.addEventListener('play',stopWhenAudioPlays,true);return()=>document.removeEventListener('play',stopWhenAudioPlays,true);},[]);
  async function create(revision=false){
    if(sending||active||revision&&!prompt.trim())return;setSending(true);setError('');
    try{await podcastPromo.create(podcastId,{requestId:crypto.randomUUID(),...(revision&&selected?{baseId:selected.id,prompt:prompt.trim(),scope}:{})});setSelectedId('');if(revision)setPrompt('');await refresh();}
    catch(e){setError(e instanceof Error?e.message:'Could not start video creation.');}finally{setSending(false);}
  }
  async function cancel(){if(!active)return;setSending(true);try{await podcastPromo.cancel(active.id);await refresh();}catch(e){setError((e as Error).message);}finally{setSending(false);}}
  return <section className="podcast-promo" aria-label="Podcast promo video">
    <div className="promo-heading"><div><div className="promo-eyebrow">FROM EPISODE TO PROMOTION</div><h2>A short video. A reason to listen.</h2><p>Turn a standout moment into a whiteboard preview of your full podcast.</p></div><span className="promo-format">MP4</span></div>
    {error&&<p className="promo-notice text-risk" role="alert">{error}</p>}
    {snapshot&&!snapshot.available&&<p className="promo-notice">{snapshot.reason}</p>}
    {!snapshot&&!error&&<p className="promo-notice">Loading your promo videos…</p>}
    {active&&<div className="promo-create" role="status"><strong>{active.stage}</strong><p>{AGENT_NAME} is preparing your video. You can leave this page and come back.</p><button className="promo-cancel" disabled={sending} onClick={()=>void cancel()}>Cancel video creation</button></div>}
    {latest?.status==='failed'&&<div className="promo-request" role="alert"><strong>Video creation stopped</strong><p>{latest.error}</p><small>Your earlier videos are still available.</small></div>}
    {latest?.status==='cancelled'&&<p className="promo-notice">Video creation was cancelled.</p>}
    {!selected&&!active&&<div className="promo-create"><div className="promo-style"><span>Whiteboard</span><span>Original podcast audio</span><span>No drawing hand</span></div><button className="promo-primary" disabled={!snapshot?.available||sending} onClick={()=>void create()}>✧ &nbsp; {sending?'Starting…':'Create 90-second promo video'}</button><p>{AGENT_NAME} selects the excerpt and plans the visuals. Review the video, then ask for changes. Short recordings may produce a shorter promo.</p></div>}
    {selected&&<>
      <div className="promo-preview-heading"><div><span className="promo-ready-dot"/>Your promo preview</div><label className="promo-version-select">Version <select value={selected.id} onChange={e=>{setSelectedId(e.target.value);setScope('Entire video');}}>{ready.map((j,i)=><option key={j.id} value={j.id}>{new Date(j.createdAt).toLocaleString()}{i===0?' · Latest':''}</option>)}</select></label></div>
      <video key={selected.id} ref={video} controls preload="metadata" poster={podcastPromo.media(selected.id,'poster')} onPlay={pauseAudio} aria-label="Whiteboard podcast promo"><source src={podcastPromo.media(selected.id,'video')} type="video/mp4"/><track kind="captions" src={podcastPromo.media(selected.id,'captions')} srcLang="en" label="English"/></video>
      <div className="promo-video-tools"><span>{Math.round(selected.plan?.duration??90)} sec · 720p · Original audio{!selected.plan?.showHand?' · No hand':''}</span><div><button aria-pressed={captions} onClick={()=>{const el=video.current;if(el?.textTracks[0])el.textTracks[0].mode=captions?'hidden':'showing';}}>Captions {captions?'on':'off'}</button><a href={podcastPromo.media(selected.id,'video')} download={`podcast-promo-${selected.id}.mp4`}>Download MP4 ↓</a></div></div>
      <div className="promo-storyboard"><button className="promo-disclosure" aria-expanded={expanded} onClick={()=>setExpanded(!expanded)}>{expanded?'▾':'▸'} &nbsp; Review the scenes <span>{selected.plan?.scenes.length} scenes</span></button>{expanded&&<div className="promo-scenes">{selected.plan?.scenes.map((s,i)=><button key={i} onClick={()=>{if(video.current){video.current.currentTime=s.at;void video.current.play().catch(()=>setError('Press play on the video to continue.'));}}}><strong>{i+1}. {s.title}</strong><span>{Math.round(s.at)} sec · {s.subtitle}</span></button>)}</div>}</div>
      <div className="promo-refine"><div className="promo-refine-title"><span className="promo-assistant-avatar">✧</span><div><h3>Refine with {AGENT_NAME}</h3><p>Tell {AGENT_NAME} what you would like to change.</p></div></div>
        {selected.prompt&&<div className="promo-request"><strong>Your requested changes</strong><p>{selected.prompt}</p></div>}
        <p className="promo-assistant-message">{selected.plan?.reply||'We can adjust the drawings, wording, colors, and pacing while keeping your original voices.'}</p>
        <form onSubmit={e=>{e.preventDefault();void create(true);}}><label className="promo-input-label" htmlFor="promo-request">What should change?</label><textarea id="promo-request" ref={input} rows={3} maxLength={3000} value={prompt} onChange={e=>setPrompt(e.target.value)} placeholder="For example: Use less text, make the drawings simpler, and use blue accents."/><div className="promo-prompt-bottom"><label>Apply to <select aria-label="Apply changes to" value={scope} onChange={e=>setScope(e.target.value)}><option>Entire video</option>{selected.plan?.scenes.map((s,i)=><option key={i} value={`scene:${i}`}>{i+1}. {s.title}</option>)}</select></label><button className="promo-primary" type="submit" disabled={!prompt.trim()||sending||!!active||!snapshot?.available}>{sending?'Starting…':'Create revised preview ↑'}</button></div></form>
        <div className="promo-suggestions">{['Use fewer words on screen','Simplify the drawings','Use blue accents'].map(s=><button key={s} onClick={()=>{setPrompt(s);input.current?.focus();}}>{s}</button>)}</div><p className="promo-footnote">Changes create a new version. Your existing video stays available.</p>
      </div>
      {!active&&<button className="promo-cancel" disabled={sending||!snapshot?.available} onClick={()=>void create()}>Create a new promo from this episode</button>}
    </>}
  </section>;
}
