/** Event-based endpointing, not raw-audio VAD. Browser speech detection latency and
 * recognition restarts can add delay/gaps; Web Speech exposes no silence setting. */
export const VOICE_QUIET_MS = 3000;
interface Callbacks {
  final(text: string): void;
  draft(text: string): void;
  listening(value: boolean): void;
  error(message: string): void;
}
export class VoiceCapture {
  private rec?: SpeechRecognition;
  private active = true;
  private stopping = false;
  private speaking = false;
  private completed: string[] = [];
  private current = '';
  private interim = '';
  private lastActivity = 0;
  private quietDue?: number;
  private quietTimer?: ReturnType<typeof setTimeout>;
  private drainTimer?: ReturnType<typeof setTimeout>;
  private emptyEnds = 0;
  private make: () => SpeechRecognition;
  private cb: Callbacks;
  constructor(make: () => SpeechRecognition, cb: Callbacks) { this.make = make; this.cb = cb; }
  start() { this.cb.listening(true); this.open(); }
  private text() { return [...this.completed, this.current, this.interim].filter(Boolean).join(' ').trim(); }
  private clearQuiet() { clearTimeout(this.quietTimer); this.quietTimer = undefined; this.quietDue = undefined; }
  private arm(from = Date.now()) {
    if (!this.active || this.stopping || this.speaking || !this.text()) return;
    this.clearQuiet(); this.quietDue = from + VOICE_QUIET_MS;
    this.quietTimer = setTimeout(() => this.stop(), Math.max(0, this.quietDue - Date.now()));
  }
  private open() {
    if (!this.active || this.stopping) return;
    try {
      const rec = this.make(); this.rec = rec;
      rec.continuous = true; rec.interimResults = true; rec.lang = 'en-US';
      const valid = () => this.active && this.rec === rec;
      rec.addEventListener('speechstart', () => { if (!valid() || this.stopping) return; this.speaking = true; this.lastActivity = Date.now(); this.clearQuiet(); });
      rec.addEventListener('speechend', () => { if (!valid() || this.stopping) return; this.speaking = false; this.lastActivity = Date.now(); this.arm(); });
      rec.addEventListener('result', ((event: SpeechRecognitionEvent) => {
        if (!valid()) return;
        // Rebuild this recognition's full result list. Repeated final notifications
        // must not append the same words twice; interim results can be replaced.
        const finals: string[] = [], pending: string[] = [];
        for (let i = 0; i < event.results.length; i++) (event.results[i].isFinal ? finals : pending).push(event.results[i][0].transcript.trim());
        this.current = finals.filter(Boolean).join(' '); this.interim = pending.filter(Boolean).join(' ');
        this.lastActivity = Date.now(); this.emptyEnds = 0; this.cb.draft(this.text());
        if (!this.stopping) this.arm();
      }) as EventListener);
      rec.addEventListener('error', ((event: SpeechRecognitionErrorEvent) => {
        if (!valid()) return;
        // no-speech may accompany a normal browser endpoint; end handles restart.
        if (event.error === 'no-speech' && !this.stopping) return;
        this.finish(false, event.error === 'aborted' ? undefined : `Speech error: ${event.error}. Review the draft before sending.`);
      }) as EventListener);
      rec.addEventListener('end', () => {
        if (!valid()) return;
        this.rec = undefined; this.speaking = false;
        if (this.stopping) { this.finish(true); return; }
        if (this.interim) { this.finish(false, 'Speech ended before all words were finalized. Review the draft before sending.'); return; }
        if (!this.current) this.emptyEnds++;
        if (this.emptyEnds >= 3) { this.finish(false, 'Speech recognition stopped repeatedly. Review the draft or start again.'); return; }
        if (this.current) this.completed.push(this.current);
        this.current = '';
        // Preserve the existing quiet deadline, not a new delay after every end.
        if (this.quietDue === undefined) this.arm(this.lastActivity || Date.now());
        if (this.quietDue !== undefined && Date.now() >= this.quietDue) { this.finish(true); return; }
        this.open(); // Keep listening through early browser-controlled endpoints.
      });
      rec.start();
    } catch { this.finish(false, 'Could not continue speech recognition. Review the draft or start again.'); }
  }
  stop() {
    if (!this.active || this.stopping) return;
    this.stopping = true; this.clearQuiet();
    if (!this.rec) { this.finish(true); return; }
    // stop() permits a final result/end. Never auto-send a partial prefix if a
    // browser fails to deliver that finalization; retain it for manual review.
    this.drainTimer = setTimeout(() => this.finish(false, 'Speech did not finalize. Review the draft before sending.'), 1500);
    try { this.rec.stop(); } catch { this.finish(false, 'Speech did not finalize. Review the draft before sending.'); }
  }
  cancel(preserveDraft = true) { if (this.active) this.finish(false, undefined, preserveDraft); }
  private finish(send: boolean, error?: string, preserveDraft = true) {
    if (!this.active) return;
    this.active = false; this.clearQuiet(); clearTimeout(this.drainTimer);
    const rec = this.rec; this.rec = undefined;
    try { rec?.abort(); } catch { /* Already ended. */ }
    const text = this.text(); this.cb.listening(false);
    if (preserveDraft && text) this.cb.draft(text);
    if (error) this.cb.error(error);
    else if (send && this.interim) this.cb.error('Some words are not final. Review the draft before sending.');
    if (send && !this.interim && text) this.cb.final(text);
  }
}
