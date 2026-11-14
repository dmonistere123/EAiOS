export type PromoState = 'queued' | 'running' | 'ready' | 'failed' | 'cancelled';
export interface PromoScene { at: number; title: string; subtitle: string; visual: 'flow'|'people'|'comparison'|'cycle'|'warning'|'checklist'; labels: string[]; }
export interface PromoPlan { title: string; excerptStart: number; audioDuration: number; duration: number; accent: 'teal'|'blue'|'purple'; showHand: boolean; scenes: PromoScene[]; reply: string; }
export interface PodcastPromo { id: string; podcastId: string; baseId?: string; status: PromoState; stage: string; prompt: string; scope: string; createdAt: string; error?: string; plan?: PromoPlan; }
export interface PromoSnapshot { jobs: PodcastPromo[]; available: boolean; reason?: string; }
