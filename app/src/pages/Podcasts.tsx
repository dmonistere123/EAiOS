/** Podcasts — document-to-podcast player and generator (Phase 8.3). */
import { useEffect, useRef, useState } from 'react';
import { podcasts } from '../adapters';
import type { Podcast } from '../domain/types';
import { Card, Drawer, EmptyState, RelativeTime, SectionTitle, StateBadge } from '../components/ui';
import { toast } from '../state/runtime';

const statusTone = { pending: 'warn', processing: 'signal', ready: 'ok', failed: 'risk' } as const;

function fmtDuration(totalSeconds?: number) {
  if (!totalSeconds || !Number.isFinite(totalSeconds)) return '--:--';
  const m = Math.floor(totalSeconds / 60);
  const s = Math.floor(totalSeconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function TranscriptDrawer({ podcastId, onClose }: { podcastId: string; onClose: () => void }) {
  const [text, setText] = useState<string | null>(null);
  const [busy, setBusy] = useState(true);

  useEffect(() => {
    fetch(podcasts.getTranscriptUrl(podcastId))
      .then(async (r) => {
        if (!r.ok) throw new Error(await r.text());
        setText(await r.text());
      })
      .catch((e) => toast('error', e instanceof Error ? e.message : 'Transcript failed to load.'))
      .finally(() => setBusy(false));
  }, [podcastId]);

  return (
    <Drawer title="Transcript" onClose={onClose}>
      {busy && <p className="text-sm text-ink-dim">Loading transcript…</p>}
      {text && (
        <div className="whitespace-pre-wrap text-sm leading-relaxed text-ink-dim">
          {text.replace(/<\/?Person[12]>/g, '')}
        </div>
      )}
    </Drawer>
  );
}

export default function Podcasts() {
  const [items, setItems] = useState<Podcast[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [transcriptId, setTranscriptId] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState<number | undefined>();
  const [playbackRate, setPlaybackRate] = useState(1);

  const selected = items.find((p) => p.id === selectedId) ?? items[0];

  const load = async () => {
    try {
      const list = await podcasts.listPodcasts();
      setItems(list);
      if (list.length && !selectedId) setSelectedId(list[0].id);
    } catch (e) {
      toast('error', e instanceof Error ? e.message : 'Failed to load podcasts.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 5_000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.playbackRate = playbackRate;
  }, [playbackRate, selected?.id]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const onTime = () => setCurrentTime(audio.currentTime);
    const onDuration = () => setDuration(audio.duration);
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    const onEnded = () => setPlaying(false);
    audio.addEventListener('timeupdate', onTime);
    audio.addEventListener('loadedmetadata', onDuration);
    audio.addEventListener('play', onPlay);
    audio.addEventListener('pause', onPause);
    audio.addEventListener('ended', onEnded);
    return () => {
      audio.removeEventListener('timeupdate', onTime);
      audio.removeEventListener('loadedmetadata', onDuration);
      audio.removeEventListener('play', onPlay);
      audio.removeEventListener('pause', onPause);
      audio.removeEventListener('ended', onEnded);
    };
  }, [selected?.id]);

  const togglePlay = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) void audio.play();
    else audio.pause();
  };

  const seek = (ratio: number) => {
    const audio = audioRef.current;
    if (!audio || !Number.isFinite(audio.duration)) return;
    audio.currentTime = Math.max(0, Math.min(audio.duration, audio.duration * ratio));
  };

  const uploadGenerate = async () => {
    const file = fileRef.current?.files?.[0];
    if (!file) {
      toast('error', 'Choose a PDF or document first.');
      return;
    }
    setGenerating(true);
    try {
      const p = await podcasts.uploadAndGenerate(file);
      setItems((prev) => [p, ...prev]);
      setSelectedId(p.id);
      toast('ok', 'Podcast generation started.');
      fileRef.current!.value = '';
    } catch (e) {
      toast('error', e instanceof Error ? e.message : 'Generation failed.');
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Podcasts</h1>
          <p className="mt-1 text-sm text-ink-dim">Documents turned into audio conversations. Powered by Podcastfy + Edge TTS.</p>
        </div>
        <div className="flex items-center gap-2">
          <input ref={fileRef} type="file" accept=".pdf,.docx,.pptx,.txt,.md" className="hidden" />
          <button
            onClick={() => fileRef.current?.click()}
            className="rounded-lg border border-edge bg-canvas-raised px-4 py-2 text-sm font-medium text-ink hover:bg-canvas-overlay"
          >
            Choose document
          </button>
          <button
            onClick={() => void uploadGenerate()}
            disabled={generating}
            className="rounded-lg bg-signal px-4 py-2 text-sm font-semibold text-canvas hover:bg-signal/90 disabled:opacity-50"
          >
            {generating ? 'Starting…' : 'Generate podcast'}
          </button>
        </div>
      </header>

      {items.length === 0 && !loading ? (
        <EmptyState title="No podcasts yet" hint="Upload a PDF or document to generate your first episode." />
      ) : (
        <div className="grid gap-6 lg:grid-cols-3">
          <div className="lg:col-span-2 space-y-6">
            {selected ? (
              <Card className="p-6">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <SectionTitle>{selected.sourceName}</SectionTitle>
                    <div className="mt-1 flex items-center gap-2 text-xs text-ink-dim">
                      <StateBadge label={selected.status} tone={statusTone[selected.status]} />
                      {selected.status === 'pending' && <span className="text-warn">Queued for generation</span>}
                      {selected.status === 'processing' && <span className="text-signal">Generating audio…</span>}
                      {selected.finishedAt && <span>Finished <RelativeTime iso={selected.finishedAt} /></span>}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] uppercase tracking-wider text-ink-faint">Speed</span>
                    {[0.75, 1, 1.25, 1.5, 2].map((rate) => (
                      <button
                        key={rate}
                        onClick={() => setPlaybackRate(rate)}
                        className={`rounded px-2 py-0.5 text-xs font-medium ${playbackRate === rate ? 'bg-signal text-canvas' : 'border border-edge text-ink-dim hover:bg-canvas-overlay'}`}
                      >
                        {rate}x
                      </button>
                    ))}
                  </div>
                </div>

                {selected.status === 'ready' && (
                  <>
                    <audio ref={audioRef} src={podcasts.getAudioUrl(selected.id)} preload="metadata" className="hidden" />
                    <div className="mt-6 rounded-xl border border-edge bg-canvas-raised p-4">
                      <div className="flex items-center gap-4">
                        <button
                          onClick={togglePlay}
                          aria-label={playing ? 'Pause' : 'Play'}
                          className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-signal text-lg text-canvas shadow-lg shadow-signal/20 transition-transform hover:scale-105 active:scale-95"
                        >
                          {playing ? '⏸' : '▶'}
                        </button>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center justify-between text-xs text-ink-faint">
                            <span>{fmtDuration(currentTime)}</span>
                            <span>{fmtDuration(duration)}</span>
                          </div>
                          <input
                            type="range"
                            min={0}
                            max={duration && Number.isFinite(duration) ? duration : 0}
                            step={0.1}
                            value={currentTime}
                            onChange={(e) => seek(Number(e.target.value) / (duration || 1))}
                            className="mt-2 h-2 w-full cursor-pointer appearance-none rounded-full bg-canvas-overlay accent-signal"
                            aria-label="Seek"
                          />
                        </div>
                      </div>
                    </div>
                    <div className="mt-4 flex gap-3">
                      <a
                        href={podcasts.getAudioUrl(selected.id)}
                        download={`${selected.sourceName.replace(/\s+/g, '_')}.mp3`}
                        className="rounded-lg border border-edge px-3 py-1.5 text-xs font-medium text-ink-dim hover:bg-canvas-overlay"
                      >
                        Download MP3
                      </a>
                      <button
                        onClick={() => setTranscriptId(selected.id)}
                        className="rounded-lg border border-edge px-3 py-1.5 text-xs font-medium text-ink-dim hover:bg-canvas-overlay"
                      >
                        View transcript
                      </button>
                    </div>
                  </>
                )}

                {selected.status === 'failed' && selected.error && (
                  <div className="mt-4 rounded-lg border border-risk/30 bg-risk/10 p-3 text-sm text-risk">{selected.error}</div>
                )}
              </Card>
            ) : (
              <EmptyState title="Select an episode" />
            )}
          </div>

          <div>
            <Card className="p-5">
              <SectionTitle>Episodes</SectionTitle>
              <ul className="space-y-2">
                {items.map((p) => (
                  <li key={p.id}>
                    <button
                      onClick={() => {
                        setSelectedId(p.id);
                        setCurrentTime(0);
                        setDuration(undefined);
                        setPlaying(false);
                      }}
                      className={`w-full rounded-lg border px-3 py-2 text-left text-sm transition-colors ${selectedId === p.id ? 'border-signal/50 bg-signal/10 text-ink' : 'border-edge bg-canvas text-ink-dim hover:bg-canvas-overlay'}`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate font-medium">{p.sourceName}</span>
                        <StateBadge label={p.status} tone={statusTone[p.status]} />
                      </div>
                      <div className="mt-0.5 text-[11px] text-ink-faint">
                        {p.sourceType === 'knowledge_source' ? 'Knowledge source' : 'Uploaded file'} · <RelativeTime iso={p.createdAt} />
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            </Card>
          </div>
        </div>
      )}

      {transcriptId && <TranscriptDrawer podcastId={transcriptId} onClose={() => setTranscriptId(null)} />}
    </div>
  );
}
