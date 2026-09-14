/**
 * MockPodcastAdapter — in-memory podcast adapter for mock mode.
 */
import type { Podcast, TtsProvider } from '../../domain/types';
import type { PodcastAdapter, PodcastTtsConfig, TtsProviderInfo } from '../interfaces';

const delay = (ms = 180) => new Promise((r) => setTimeout(r, ms + Math.random() * 120));
let seq = 100;

const fixture: Podcast = {
  id: 'p-mock-1',
  sourceName: 'Economic Scenarios for Transformative AI (mock)',
  sourceType: 'file',
  status: 'ready',
  createdAt: new Date().toISOString(),
  finishedAt: new Date().toISOString(),
};

const TTS_VOICES: Record<TtsProvider, string[]> = {
  edge: [],
  elevenlabs: ['Adam', 'Antoni', 'Bella', 'Callum', 'Chris', 'Daniel', 'Jessica', 'Josh', 'Liam', 'Matilda', 'Rachel'],
  openai: ['alloy', 'echo', 'fable', 'onyx', 'nova', 'shimmer'],
};

function applyTtsConfig(p: Podcast, tts?: PodcastTtsConfig) {
  if (!tts) return;
  p.ttsModel = tts.provider ?? 'edge';
  if (tts.voiceHost || tts.voiceGuest) {
    p.voiceMap = { host: tts.voiceHost ?? 'default', guest: tts.voiceGuest ?? 'default' };
  }
}

class MockPodcastAdapter implements PodcastAdapter {
  private podcasts: Podcast[] = [fixture];

  async listPodcasts(): Promise<Podcast[]> {
    await delay();
    return [...this.podcasts];
  }

  async generateFromSource(sourceId: string, tts?: PodcastTtsConfig): Promise<Podcast> {
    await delay(400);
    const p: Podcast = {
      id: `p-mock-${seq++}`,
      sourceId,
      sourceName: `Generated from source ${sourceId}`,
      sourceType: 'knowledge_source',
      status: 'pending',
      createdAt: new Date().toISOString(),
    };
    applyTtsConfig(p, tts);
    this.podcasts = [p, ...this.podcasts];
    // Simulate transition to ready after a moment.
    setTimeout(() => {
      p.status = 'ready';
      p.finishedAt = new Date().toISOString();
    }, 2000);
    return p;
  }

  async uploadAndGenerate(file: File, tts?: PodcastTtsConfig): Promise<Podcast> {
    await delay(400);
    const p: Podcast = {
      id: `p-mock-${seq++}`,
      sourceName: file.name,
      sourceType: 'file',
      status: 'pending',
      createdAt: new Date().toISOString(),
    };
    applyTtsConfig(p, tts);
    this.podcasts = [p, ...this.podcasts];
    setTimeout(() => {
      p.status = 'ready';
      p.finishedAt = new Date().toISOString();
    }, 2000);
    return p;
  }

  async getTtsStatus(): Promise<TtsProviderInfo[]> {
    await delay();
    return [
      { id: 'edge', name: 'Edge TTS', available: true, voices: TTS_VOICES.edge },
      { id: 'elevenlabs', name: 'ElevenLabs', available: true, voices: TTS_VOICES.elevenlabs },
      { id: 'openai', name: 'OpenAI', available: false, voices: TTS_VOICES.openai },
    ];
  }

  async sampleTts(_provider: TtsProvider, _voice: string): Promise<Blob> {
    await delay(600);
    // Mock: return a tiny silent MP3-ish blob so the UI can exercise the flow.
    return new Blob([new Uint8Array([0xff, 0xfb, 0x90, 0x00])], { type: 'audio/mpeg' });
  }

  getAudioUrl(podcastId: string): string {
    return `/podcasts-api/podcasts/${encodeURIComponent(podcastId)}/audio`;
  }

  getTranscriptUrl(podcastId: string): string {
    return `/podcasts-api/podcasts/${encodeURIComponent(podcastId)}/transcript`;
  }
}

export const podcasts = new MockPodcastAdapter();
