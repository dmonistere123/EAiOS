import { CONCIERGE_PROFILE, validConciergeContext } from '../../domain/concierge';
import type { ConciergeContext } from '../../domain/concierge';

type Rpc = <T>(method: string, params: Record<string, unknown>) => Promise<T>;
type Session = { session_id: string; stored_session_id?: string; info?: { profile_name?: string } };
export const conciergeStorageKey = (revision: string) => `eaios.concierge.v2.${revision}.storedSessionId`;

/** Never reads the legacy Ally/concierge storage keys or falls back to another profile. */
export class ConciergeSession {
  private active?: { sid: string; context: ConciergeContext };
  private pending?: Promise<{ sid: string; context: ConciergeContext }>;
  private rpc: Rpc;
  private bind: (sid: string) => void;
  constructor(rpc: Rpc, bind: (sid: string) => void) { this.rpc = rpc; this.bind = bind; }

  invalidate() { this.active = undefined; }

  async prepare(fresh = false): Promise<{ sid: string; context: ConciergeContext }> {
    if (this.pending) { await this.pending; return this.prepare(fresh); }
    const work = this.load(fresh);
    this.pending = work;
    try { return await work; } finally { this.pending = undefined; }
  }

  private async load(fresh: boolean) {
    // Re-read every time, including resumed chats; no browser/proxy cache.
    const response = await fetch('/api/concierge/context', { cache: 'no-store', signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw new Error('Concierge is unavailable. Ask your administrator to check its setup.');
    const context: unknown = await response.json();
    if (!validConciergeContext(context)) throw new Error('Concierge guide is unavailable. Please try again later.');
    if (!fresh && this.active?.context.revision === context.revision) return this.active;
    this.active = undefined;
    const key = conciergeStorageKey(context.revision);
    const stored = fresh ? null : localStorage.getItem(key);
    let session: Session | undefined;
    if (stored) {
      try { session = await this.rpc<Session>('session.resume', { session_id: stored, profile: CONCIERGE_PROFILE }); }
      catch (error) {
        // Only an explicitly missing stored session is safe to replace.
        if (!/4001|session not found/i.test(String(error))) throw error;
      }
    }
    if (!session) session = await this.rpc<Session>('session.create', {
      title: 'EAiOS — Concierge', profile: CONCIERGE_PROFILE, follow_profile_config: true,
    });
    if (!session.session_id || session.info?.profile_name !== CONCIERGE_PROFILE) {
      throw new Error('Concierge profile could not be verified. Ask your administrator to check its setup.');
    }
    if (session.stored_session_id) localStorage.setItem(key, session.stored_session_id);
    else if (fresh) localStorage.removeItem(key);
    this.bind(session.session_id);
    return this.active = { sid: session.session_id, context };
  }
}
