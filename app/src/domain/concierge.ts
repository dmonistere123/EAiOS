/** Documentation revision only; never a release/update check. */
export const CONCIERGE_PROFILE = 'eaios-concierge';
export interface ConciergeContext {
  profile: typeof CONCIERGE_PROFILE;
  revision: string;
  instructions: string;
}
export function validConciergeContext(value: unknown): value is ConciergeContext {
  const v = value as ConciergeContext | null;
  return !!v && v.profile === CONCIERGE_PROFILE && /^[a-f0-9]{64}$/.test(v.revision)
    && typeof v.instructions === 'string' && v.instructions.trim().length > 0
    && v.instructions.length <= 24000;
}
export function conciergePrompt(context: ConciergeContext, question: string): string {
  return `[concierge-documents ${context.revision}]\n${context.instructions}\n[/concierge-documents]\n\n${question}`;
}
export function stripConciergeDocuments(text: string): string {
  return text.replace(/^\[concierge-documents [a-f0-9]{64}\][\s\S]*?\[\/concierge-documents\]\s*/, '');
}
