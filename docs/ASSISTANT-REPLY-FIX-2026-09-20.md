# My Assistant reply delivery — September 20, 2026

Branch: `codex/assistant-reply-display`. Implemented and validated in the isolated development worktree. Production activation is recorded separately in the local deployment log.

## Finding

The gateway bridge calls `socket.setTimeout(5000)` for connection setup and previously left it enabled after the WebSocket handshake. A quiet interval while the agent thinks could therefore destroy an established connection. The bridge continued waiting, then emitted a completion with empty text and `finishReason: timeout`. The browser ignored that finish reason and saved the empty answer as a successful message. The page rendered a Read aloud button for that empty message, so clicking it had no text to speak. Hermes could continue independently and save the real answer to its conversation history.

This is a concrete code path matching the reported symptoms, reproduced with a temporary gateway fixture using a shortened connection timeout. No new prompt was submitted to the live agent to reproduce the user's particular conversation.

Additional issues found: requests shared a singleton socket/event callback; bridge events were not filtered by session; empty completion text could replace already-received text; completion rendering depended on reloading history; bridge errors could automatically submit the same prompt again over WebSocket.

## Changes

- Clear the connection timeout after a successful handshake; retain any WebSocket data delivered in the handshake packet.
- Give each bridge request its own client and filter events to its session.
- Report disconnects, turn errors, timeouts, and empty replies as errors; preserve nonempty deltas when final text is empty.
- Share the same response handling between streaming and non-streaming endpoints.
- Do not automatically resubmit failed bridge requests, because the original may still be executing.
- Render the completion payload immediately. Reconcile history only when it includes that same answer and no newer event has arrived.
- Show progress from tool lifecycle, interim messages, and status events. Reasoning events produce a brief thinking indicator; raw reasoning, tool arguments, and tool results are not displayed.
- Show errors inline in the chat. Keep the user's question visible when delivery fails.
- Hide blank historical bubbles and only offer Read aloud when playback is available and text exists. Surface playback errors and make the speaking button stop playback.

## Validation

- 316 tests pass across 39 files, including 13 added regressions.
- Temporary gateway tests cover idle connections, cross-session event filtering, simultaneous requests, progress, empty final text, errors, and timeouts.
- Adapter/page tests cover immediate rendering with stale history, preserving streamed text, progress display, and avoiding duplicate submissions on transport failure.
- Voice tests cover blank input and playback errors.
- TypeScript/Vite build passes. Lint passes with existing warnings.
- Chromium mock preview shows the question, working indicator, and completed answer without selecting a conversation. No browser exceptions observed. Screenshot: `.local/baseline/chat-answer.png` (machine-local, ignored).
- Original checkout status and all 38 previously recorded protected file hashes, including live dist, are unchanged. All four production services retain their process IDs/start times.

## Limits / release boundary

Live Hermes/provider behavior and audible playback on the user's browser have not been exercised. The existing two-minute server turn deadline remains; long turns now report an explicit timeout instead of a blank successful answer. Conversations can still contain a saved reply after a timeout. The existing bridge still creates a separate gateway session for each prompt; changing multi-turn session continuity is outside this delivery fix.

Deploying requires the normal reviewed release process, including the backend update as well as rebuilt frontend assets. Production activation was authorized by the user after development validation. No remote push is part of this change.
