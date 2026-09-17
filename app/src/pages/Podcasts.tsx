/** Podcasts — document-to-podcast player and generator (Phase 8.3). */
import { useEffect, useMemo, useRef, useState } from 'react';
import { podcasts } from '../adapters';
import type { Podcast, TtsProvider } from '../domain/types';
import type { TtsProviderInfo } from '../adapters/interfaces';
import { Card, Drawer, EmptyState, RelativeTime, SectionTitle, StateBadge } from '../components/ui';
import { toast } from '../state/runtime';
import { usePageRail } from '../state/rail';

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
  const [googleStatus, setGoogleStatus] = useState<{ ready: boolean; message: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState<number | undefined>();
  const [playbackRate, setPlaybackRate] = useState(1);
  const [ttsProvider, setTtsProvider] = useState<TtsProvider>('edge');
  const [voiceHost, setVoiceHost] = useState('');
  const [voiceGuest, setVoiceGuest] = useState('');
  const [ttsStatus, setTtsStatus] = useState<TtsProviderInfo[] | null>(null);
  const [previewing, setPreviewing] = useState<{ role: 'host' | 'guest' } | null>(null);

  const selected = items.find((p) => p.id === selectedId) ?? items[0];

  const currentProvider = ttsStatus?.find((p) => p.id === ttsProvider);

  const load = async () => {
    try {
      const episodes = await podcasts.listPodcasts();
      let completed = 0;
      const list = episodes.filter((episode) => episode.status !== 'ready' || ++completed <= 11);
      setItems(list);
      // The polling effect retains its initial closure. Read the current
      // selection through a state updater so refresh never restarts an older episode.
      setSelectedId((current) => list.some((episode) => episode.id === current) ? current : list[0]?.id ?? null);

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
    fetch('/podcasts-api/podcasts/google/status')
      .then((r) => r.json().catch(() => ({ ready: false, message: 'Sidecar unavailable' })))
      .then(setGoogleStatus)
      .catch(() => setGoogleStatus({ ready: false, message: 'Sidecar unavailable' }));
  }, []);

  useEffect(() => {
    podcasts
      .getTtsStatus()
      .then((providers) => {
        setTtsStatus(providers);
        const current = providers.find((p) => p.id === ttsProvider);
        if (current && !current.available) {
          const firstAvailable = providers.find((p) => p.available);
          if (firstAvailable) setTtsProvider(firstAvailable.id);
        }
      })
      .catch(() => setTtsStatus(null));
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
      const p = await podcasts.uploadAndGenerate(file, {
        provider: ttsProvider,
        voiceHost: voiceHost || undefined,
        voiceGuest: voiceGuest || undefined,
      });
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

  const playPreview = async (role: 'host' | 'guest') => {
    const voice = role === 'host' ? voiceHost : voiceGuest;
    if (!voice) {
      toast('info', `Enter a ${role} voice first.`);
      return;
    }
    setPreviewing({ role });
    try {
      const blob = await podcasts.sampleTts(ttsProvider, voice);
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audio.addEventListener('ended', () => {
        URL.revokeObjectURL(url);
        setPreviewing(null);
      });
      audio.addEventListener('error', () => {
        URL.revokeObjectURL(url);
        setPreviewing(null);
        toast('error', 'Preview failed to play.');
      });
      void audio.play();
    } catch (e) {
      setPreviewing(null);
      toast('error', e instanceof Error ? e.message : 'Voice preview failed.');
    }
  };

  const episodeList = useMemo(
    () => (
      <ul className="space-y-2">
        {items.length === 0 && !loading ? (
          <li className="text-xs text-ink-faint">No episodes yet.</li>
        ) : (
          items.map((p) => (
            <li key={p.id}>
              <button
                onClick={() => {
                  setSelectedId(p.id);
                  setCurrentTime(0);
                  setDuration(undefined);
                  setPlaying(false);
                }}
                className={`w-full rounded-lg border px-3 py-2 text-left text-sm transition-colors ${selectedId === p.id || (!selectedId && p.id === items[0]?.id) ? 'border-signal/50 bg-signal/10 text-ink' : 'border-edge bg-canvas text-ink-dim hover:bg-canvas-overlay'}`}
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
          ))
        )}
      </ul>
    ),
    [items, loading, selectedId],
  );

  usePageRail(
    useMemo(
      () => [
        {
          key: 'episodes',
          title: 'Episodes',
          count: items.length,
          node: episodeList,
        },
      ],
      [items.length, episodeList],
    ),
  );

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Podcasts</h1>
          <p className="mt-1 text-sm text-ink-dim">Documents turned into audio conversations. The latest recording and 10 historical recordings are available.</p>
        </div>
        <div className="flex items-center gap-2">
          <StateBadge label="Podcastfy" tone="signal" />
          <StateBadge label={googleStatus?.ready ? 'Google API ready' : 'Google API unavailable'} tone={googleStatus?.ready ? 'ok' : 'warn'} />
        </div>
      </header>

      <Card className="p-5">
        <SectionTitle>Generate episode</SectionTitle>
        <div className="grid gap-5 md:grid-cols-[1fr_auto] md:items-start">
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-3">
              <input ref={fileRef} id="podcast-file-input" type="file" accept=".pdf,.docx,.pptx,.txt,.md" className="hidden" aria-label="Document to convert" />
              <button
                onClick={() => fileRef.current?.click()}
                className="rounded-lg border border-edge bg-canvas px-3 py-1.5 text-xs font-medium text-ink hover:bg-canvas-overlay"
              >
                Choose document
              </button>
              <button
                onClick={() => void uploadGenerate()}
                disabled={generating}
                className="rounded-lg bg-signal px-3 py-1.5 text-xs font-semibold text-canvas hover:bg-signal/90 disabled:opacity-50"
              >
                {generating ? 'Starting…' : 'Generate'}
              </button>
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
              <div>
                <label htmlFor="tts-provider" className="text-[11px] font-medium uppercase tracking-wider text-ink-faint">TTS provider</label>
                <select
                  id="tts-provider"
                  value={ttsProvider}
                  onChange={(e) => {
                    const next = e.target.value as TtsProvider;
                    setTtsProvider(next);
                    setVoiceHost('');
                    setVoiceGuest('');
                  }}
                  className="mt-1 block w-full rounded-lg border border-edge bg-canvas px-2 py-1.5 text-sm text-ink outline-none focus:border-signal"
                >
                  {ttsStatus ? (
                    ttsStatus.map((p) => (
                      <option key={p.id} value={p.id} disabled={!p.available}>
                        {p.name}
                        {p.available ? '' : ' (key missing)'}
                      </option>
                    ))
                  ) : (
                    <>
                      <option value="edge">Edge (free)</option>
                      <option value="elevenlabs">ElevenLabs</option>
                      <option value="openai">OpenAI</option>
                    </>
                  )}
                </select>
                <p className="mt-1 text-[11px] text-ink-faint">
                  {ttsProvider === 'elevenlabs'
                    ? 'Uses your ELEVENLABS_API_KEY.'
                    : ttsProvider === 'openai'
                      ? 'Uses your OPENAI_API_KEY.'
                      : 'Free Microsoft Edge voices.'}
                </p>
              </div>
              <div>
                <label htmlFor="voice-host" className="text-[11px] font-medium uppercase tracking-wider text-ink-faint">Host voice</label>
                <div className="mt-1 flex gap-2">
                  <input
                    id="voice-host"
                    type="text"
                    value={voiceHost}
                    onChange={(e) => setVoiceHost(e.target.value)}
                    placeholder={currentProvider?.voices[0] ?? 'Host voice'}
                    className="block w-full rounded-lg border border-edge bg-canvas px-2 py-1.5 text-sm text-ink outline-none placeholder:text-ink-faint focus:border-signal"
                  />
                  <button
                    onClick={() => void playPreview('host')}
                    disabled={previewing?.role === 'host'}
                    className="shrink-0 rounded-lg border border-edge px-2 py-1.5 text-xs font-medium text-ink-dim hover:bg-canvas-overlay disabled:opacity-50"
                    aria-label="Preview host voice"
                  >
                    {previewing?.role === 'host' ? 'Playing…' : 'Preview'}
                  </button>
                </div>
                <p className="mt-1 text-[10px] text-ink-faint">
                  {currentProvider
                    ? currentProvider.voices.slice(0, 6).join(', ') + (currentProvider.voices.length > 6 ? '…' : '')
                    : 'e.g. en-US-JennyNeural'}
                </p>
              </div>
              <div>
                <label htmlFor="voice-guest" className="text-[11px] font-medium uppercase tracking-wider text-ink-faint">Guest voice</label>
                <div className="mt-1 flex gap-2">
                  <input
                    id="voice-guest"
                    type="text"
                    value={voiceGuest}
                    onChange={(e) => setVoiceGuest(e.target.value)}
                    placeholder={currentProvider?.voices[1] ?? 'Guest voice'}
                    className="block w-full rounded-lg border border-edge bg-canvas px-2 py-1.5 text-sm text-ink outline-none placeholder:text-ink-faint focus:border-signal"
                  />
                  <button
                    onClick={() => void playPreview('guest')}
                    disabled={previewing?.role === 'guest'}
                    className="shrink-0 rounded-lg border border-edge px-2 py-1.5 text-xs font-medium text-ink-dim hover:bg-canvas-overlay disabled:opacity-50"
                    aria-label="Preview guest voice"
                  >
                    {previewing?.role === 'guest' ? 'Playing…' : 'Preview'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </Card>

      {items.length === 0 && !loading ? (
        <EmptyState title="No podcasts yet" hint="Upload a PDF or document to generate your first episode." />
      ) : selected ? (
        <Card className="p-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <SectionTitle>{selected.sourceName}</SectionTitle>
              <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-ink-dim">
                <StateBadge label={selected.status} tone={statusTone[selected.status]} />
                {selected.status === 'pending' && <span className="text-warn">Queued for generation</span>}
                {selected.status === 'processing' && <span className="text-signal">Generating audio…</span>}
                {selected.finishedAt && (
                  <span>
                    Finished <RelativeTime iso={selected.finishedAt} />
                  </span>
                )}
                {selected.ttsModel && (
                  <span className="rounded border border-edge px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-ink-faint">
                    {selected.ttsModel}
                    {selected.voiceMap ? ` · ${selected.voiceMap.host}/${selected.voiceMap.guest}` : ''}
                  </span>
                )}
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
              <div className="mt-4 flex flex-wrap gap-3">
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

      <p className="text-xs text-ink-faint">
        Google Podcast API is unavailable for this GCP project (404). Podcastfy is the working provider.
      </p>

      {transcriptId && <TranscriptDrawer podcastId={transcriptId} onClose={() => setTranscriptId(null)} />}
    </div>
  );
}