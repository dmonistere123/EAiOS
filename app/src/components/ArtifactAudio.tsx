import { useEffect, useRef, useState } from 'react';
import { pauseOtherAudio } from '../state/audioPlayback';
export function ArtifactAudio({ id, name, available }: { id: string; name: string; available: boolean }) {
  const audio = useRef<HTMLAudioElement>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => { const element = audio.current; return () => { element?.pause(); }; }, []);
  if (!available) return <p className="mt-3 text-xs text-ink-dim">Audio playback requires the live artifact store. No audio is loaded in this isolated preview.</p>;
  return <div className="mt-3 min-w-0">
    <audio ref={audio} controls preload="none" aria-label={`Play ${name}`} src={`/api/artifacts/${encodeURIComponent(id)}/raw`} className="h-10 w-full max-w-xl" onPlay={e => { pauseOtherAudio(e.currentTarget); setFailed(false); }} onError={() => setFailed(true)} />
    {failed && <p role="status" className="mt-2 text-xs text-warn">Audio could not be played. The file may be unavailable, access may have expired, or this browser may not support its format. Try Download if this browser does not support the format.</p>}
  </div>;
}
