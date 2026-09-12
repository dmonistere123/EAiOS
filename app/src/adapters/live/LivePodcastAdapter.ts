/**
 * LivePodcastAdapter — EAiOS podcast sidecar via /podcasts-api proxy.
 * The sidecar runs Podcastfy (OpenRouter LLM + Edge TTS) asynchronously
 * and serves MP3 + transcript from disk.
 */
import type { Podcast } from '../../domain/types';
import type { PodcastAdapter } from '../interfaces';
import { podcasts as mock } from '../mock/MockPodcastAdapter';

class LivePodcastAdapter implements PodcastAdapter {
  private useMock = false;

  private async api<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await fetch(`/podcasts-api${path}`, init);
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(body.error ?? `sidecar HTTP ${res.status}`);
    }
    return (await res.json()) as T;
  }

  private async call<T>(fn: () => Promise<T>, fallback: () => Promise<T>): Promise<T> {
    if (this.useMock) return fallback();
    try {
      return await fn();
    } catch {
      this.useMock = true;
      return fallback();
    }
  }

  listPodcasts(): Promise<Podcast[]> {
    return this.call(
      async () => (await this.api<{ podcasts: Podcast[] }>('/podcasts')).podcasts,
      () => mock.listPodcasts(),
    );
  }

  async generateFromSource(sourceId: string): Promise<Podcast> {
    return this.call(
      async () => (await this.api<{ podcast: Podcast }>('/podcasts/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sourceId }),
      })).podcast,
      () => mock.generateFromSource(sourceId),
    );
  }

  async uploadAndGenerate(file: File): Promise<Podcast> {
    return this.call(
      async () => {
        const form = new FormData();
        form.append('file', file);
        return (await this.api<{ podcast: Podcast }>('/podcasts/generate', { method: 'POST', body: form })).podcast;
      },
      () => mock.uploadAndGenerate(file),
    );
  }

  getAudioUrl(podcastId: string): string {
    return `/podcasts-api/podcasts/${encodeURIComponent(podcastId)}/audio`;
  }

  getTranscriptUrl(podcastId: string): string {
    return `/podcasts-api/podcasts/${encodeURIComponent(podcastId)}/transcript`;
  }
}

export const livePodcasts = new LivePodcastAdapter();
