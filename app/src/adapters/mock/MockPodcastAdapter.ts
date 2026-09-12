/**
 * MockPodcastAdapter — in-memory podcast adapter for mock mode.
 */
import type { Podcast } from '../../domain/types';
import type { PodcastAdapter } from '../interfaces';

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

class MockPodcastAdapter implements PodcastAdapter {
  private podcasts: Podcast[] = [fixture];

  async listPodcasts(): Promise<Podcast[]> {
    await delay();
    return [...this.podcasts];
  }

  async generateFromSource(sourceId: string): Promise<Podcast> {
    await delay(400);
    const p: Podcast = {
      id: `p-mock-${seq++}`,
      sourceId,
      sourceName: `Generated from source ${sourceId}`,
      sourceType: 'knowledge_source',
      status: 'pending',
      createdAt: new Date().toISOString(),
    };
    this.podcasts = [p, ...this.podcasts];
    // Simulate transition to ready after a moment.
    setTimeout(() => {
      p.status = 'ready';
      p.finishedAt = new Date().toISOString();
    }, 2000);
    return p;
  }

  async uploadAndGenerate(file: File): Promise<Podcast> {
    await delay(400);
    const p: Podcast = {
      id: `p-mock-${seq++}`,
      sourceName: file.name,
      sourceType: 'file',
      status: 'pending',
      createdAt: new Date().toISOString(),
    };
    this.podcasts = [p, ...this.podcasts];
    setTimeout(() => {
      p.status = 'ready';
      p.finishedAt = new Date().toISOString();
    }, 2000);
    return p;
  }

  getAudioUrl(podcastId: string): string {
    return `/podcasts-api/podcasts/${encodeURIComponent(podcastId)}/audio`;
  }

  getTranscriptUrl(podcastId: string): string {
    return `/podcasts-api/podcasts/${encodeURIComponent(podcastId)}/transcript`;
  }
}

export const podcasts = new MockPodcastAdapter();
