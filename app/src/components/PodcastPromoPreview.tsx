import { useRef, useState } from 'react';
import { AGENT_NAME } from '../config';
import './podcast-promo-preview.css';

const scenes = [
  { at: 0, title: 'The hook', detail: 'Stop scaling heroics.', image: 1 },
  { at: 22.5, title: 'The problem', detail: 'Follow the broken handoffs.', image: 4 },
  { at: 55.5, title: 'The takeaway', detail: 'Make recurring failures visible.', image: 7 },
  { at: 75.9, title: 'The close', detail: 'Appreciate the rescue. Fix the system.', image: 8 },
];
const suggestions = ['Use fewer words on screen', 'Slow down the transitions', 'Make the closing message stronger'];

function setCaptionMode(element: HTMLVideoElement | null, showing: boolean) {
  const track = element?.textTracks[0];
  if (track) track.mode = showing ? 'showing' : 'hidden';
}

/** Interactive presentation only: no render jobs, provider calls, or external writes. */
export function PodcastPromoPreview({ available, pauseAudio }: { available: boolean; pauseAudio: () => void }) {
  const [ready, setReady] = useState(true);
  const [prompt, setPrompt] = useState('');
  const [requests, setRequests] = useState<string[]>([]);
  const [scope, setScope] = useState('Entire video');
  const [expanded, setExpanded] = useState(false);
  const [captioned, setCaptioned] = useState(false);
  const video = useRef<HTMLVideoElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  function submit() {
    const value = prompt.trim();
    if (!value) return;
    setRequests(previous => [...previous, `${scope}: ${value}`]);
    setPrompt('');
  }
  return <section className="podcast-promo" aria-label="Podcast promo video mockup">
    <div className="promo-mock-bar"><span>Design preview · creation and revisions are simulated</span><div>
      <button aria-pressed={!ready} onClick={() => { setReady(false); video.current?.pause(); }}>Before creation</button>
      <button aria-pressed={ready} onClick={() => setReady(true)}>After creation</button>
    </div></div>
    <div className="promo-heading"><div><div className="promo-eyebrow">FROM EPISODE TO PROMOTION</div><h2>A short video. A reason to listen.</h2><p>Turn a standout moment into a whiteboard preview of your full podcast.</p></div><span className="promo-format">MP4</span></div>
    {!available ? <p className="promo-notice">Select “Stop Scaling Heroics” to explore the playable promo sample.</p> : !ready ? <div className="promo-create">
      <div className="promo-style"><span>Whiteboard</span><span>Original podcast audio</span><span>No drawing hand</span></div>
      <button className="promo-primary" onClick={() => { pauseAudio(); setReady(true); }}>✧ &nbsp; Create 90-second promo video</button>
      <p>{AGENT_NAME} selects a compelling excerpt. You review the video and ask for changes.</p>
    </div> : <>
      <div className="promo-preview-heading"><div><span className="promo-ready-dot" />Your promo preview <span className="promo-version">Draft 02</span></div><span>Whiteboard · Original audio · No hand</span></div>
      <video ref={video} controls preload="metadata" poster="/promo-preview/poster.jpg" onPlay={pauseAudio} aria-label="Whiteboard podcast promo">
        <source src="/promo-preview/stop-scaling-heroics.mp4" type="video/mp4" />
        <track kind="captions" src="/promo-preview/captions.vtt" srcLang="en" label="English" />
      </video>
      <div className="promo-video-tools"><span>1:25 sample · 720p · MP4</span><div>
        <button aria-pressed={captioned} onClick={() => { setCaptionMode(video.current, !captioned); setCaptioned(!captioned); }}>Captions {captioned ? 'on' : 'off'}</button>
        <a href="/promo-preview/stop-scaling-heroics.mp4" download="stop-scaling-heroics-promo.mp4">Download MP4 ↓</a>
      </div></div>
      <div className="promo-storyboard"><button className="promo-disclosure" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>{expanded ? '▾' : '▸'} &nbsp; Review the scenes <span>4 key moments</span></button>
        {expanded && <div className="promo-scenes">{scenes.map(scene => <button key={scene.at} onClick={() => { if (video.current) { video.current.currentTime = scene.at; video.current.play().catch(() => {}); } }} aria-label={`Preview ${scene.title}`}><img src={`/promo-preview/scene-${scene.image}.jpg`} alt="" /><strong>{scene.title}</strong><span>{scene.detail}</span></button>)}</div>}
      </div>
      <div className="promo-refine"><div className="promo-refine-title"><span className="promo-assistant-avatar">✧</span><div><h3>Refine with {AGENT_NAME}</h3><p>Tell {AGENT_NAME} what you would like to change.</p></div></div>
        <div className="promo-assistant-message">The hand is off, and your original voices carry the story. We can adjust the drawings, wording, pacing, or any individual scene.</div>
        {requests.map((request, i) => <div className="promo-request" key={i}><strong>You</strong><p>{request}</p><small role="status">Revision request captured in this mockup. The sample video has not been regenerated.</small></div>)}
        <form onSubmit={e => { e.preventDefault(); submit(); }}>
          <label className="promo-input-label" htmlFor="promo-request">What should change?</label>
          <textarea id="promo-request" ref={input} rows={3} value={prompt} onChange={e => setPrompt(e.target.value)} placeholder="For example: Make the opening more attention-grabbing, use less text, and keep the drawings simple." />
          <div className="promo-prompt-bottom"><label>Apply to <select aria-label="Apply changes to" value={scope} onChange={e => setScope(e.target.value)}><option>Entire video</option>{scenes.map(s => <option key={s.title}>{s.title}</option>)}</select></label><button className="promo-primary" type="submit" disabled={!prompt.trim()}>Request changes ↑</button></div>
        </form>
        <div className="promo-suggestions">{suggestions.map(s => <button key={s} onClick={() => { setPrompt(s); input.current?.focus(); }}>{s}</button>)}</div>
      </div>
    </>}
  </section>;
}
