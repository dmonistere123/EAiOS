import type { PodcastAdapter } from '../interfaces';
import type { Podcast } from '../../domain/types';
import { podcasts as mock } from './MockPodcastAdapter';

const sample: Podcast = {
  id: 'p-promo-preview',
  sourceName: 'Stop Scaling Heroics',
  sourceType: 'file',
  status: 'delivered',
  createdAt: '2026-11-04T12:00:00Z',
  finishedAt: '2026-11-04T12:05:00Z',
};

export const podcastPromoPreview: PodcastAdapter = {
  listPodcasts: async () => [sample, {
    ...sample, id: 'p-promo-planning', sourceName: 'Executive AI Intelligence Briefing',
    createdAt: '2026-11-02T12:00:00Z', finishedAt: '2026-11-02T12:05:00Z',
  }],
  getAudioUrl: id => id === sample.id ? '/promo-preview/source.mp3' : '',
  getTranscriptUrl: id => id === sample.id ? '/promo-preview/source-transcript.txt' : '/promo-preview/history-unavailable.txt',
  getTtsStatus: mock.getTtsStatus.bind(mock),
  sampleTts: mock.sampleTts.bind(mock),
  generateFromSource: async () => { throw new Error('Episode generation is unavailable in this design preview.'); },
  uploadAndGenerate: async () => { throw new Error('Episode generation is unavailable in this design preview.'); },
};
