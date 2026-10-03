# Assistant voice pause

Candidate builds on deployed `1f8076e`. This change is frontend-only and does not
change Hermes, providers, request recovery, memory, or microphone permissions.

The old hook used `SpeechRecognition.continuous = false` and sent the transcript
immediately on `end`. Its short pause was browser-controlled endpointing, not a
configurable Hermes/provider VAD timeout. The legacy Assistant also scheduled an
untracked 300 ms send callback; that callback is removed.

The new capture requests continuous recognition. After browser `speechend`, or a
result when no speech is marked active, a 3,000 ms quiet countdown starts. New
`speechstart` clears it; interim/final results reset it when appropriate. While
speech is marked active there is no countdown. If the browser ends recognition
before the deadline, capture restarts and retains finalized segments and the
existing deadline. Restarted speech resets that deadline. Three consecutive empty
recognition endings stop safely instead of creating an endless restart loop.

When the deadline expires, `stop()` allows final results to drain. A final `end`
submits once. Manual Stop uses the same finalization. Unfinished interim words,
recognition errors, or missing finalization (1,500 ms drain limit) retain the text
as a draft for review instead of sending an incomplete prefix. Cancel dictation,
Escape, manual Send, and hook unmount clear pending submission and abort capture;
late events from old recognizers cannot send or overwrite text. Result lists are
rebuilt rather than appending repeated final notifications. The hook always uses
the current callback so attachments and other composer state are not stale.

This is **browser-event-based quiet detection**, not exact acoustic VAD. Web Speech
does not expose a portable three-second acoustic endpoint setting. Browser event
latency, restarts, and finalization can add delay or brief capture gaps. This is not
merely a three-second timeout after recognition ends: the countdown runs while
capture is active and early `end` does not reset it. Exact sample-level silence
would require a broader audio capture/VAD implementation, outside this change.

Specification: https://webaudio.github.io/web-speech-api/#speechreco-section

Validation uses fake recognition events and timers only. No microphone recording
or real Ally prompt is part of this work. Activation requires a reviewed frontend
build in a new staged release and coordinated activation/reload of both dashboard
surfaces; the current production stage must remain untouched until authorized.

Validation on October 3, 2026: 71 tests passed across seven files (voice controller,
hook lifecycle, Assistant UI, receipt client, and request-recovery regressions).
TypeScript passed. Logs are in `.local/voice-final-tests.log` and
`.local/voice-lint.log`; the production build log is `.local/voice-build.log`.
