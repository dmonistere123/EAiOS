export const CONCIERGE_LIMITS = { question: 4000, historyMessages: 12, historyChars: 24000, answer: 8000, soul: 24000 };
export interface ConciergeTurn { role: 'user' | 'assistant'; content: string }
export interface ConciergeInfo { revision: string; model: string; provider: string }
export function validConciergeInfo(value: unknown): value is ConciergeInfo {
  const v = value as ConciergeInfo | null;
  return !!v && /^[a-f0-9]{64}$/.test(v.revision) && typeof v.model === 'string'
    && v.model.length > 0 && v.model.length <= 200 && ['openrouter', 'openai'].includes(v.provider);
}
export function validConciergeHistory(value: unknown): value is ConciergeTurn[] {
  return Array.isArray(value) && value.length <= CONCIERGE_LIMITS.historyMessages && value.length % 2 === 0
    && value.every((row, i) => row && row.role === (i % 2 === 0 ? 'user' : 'assistant')
      && typeof row.content === 'string' && row.content.trim().length > 0
      && row.content.length <= (i % 2 === 0 ? CONCIERGE_LIMITS.question : CONCIERGE_LIMITS.answer))
    && value.reduce((n, row) => n + row.content.length, 0) <= CONCIERGE_LIMITS.historyChars;
}
