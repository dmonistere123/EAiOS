# EAiOS live voice integration

Local production now bridges Hermes v0.23.0 GPT-Live voice through the existing gateway on port 9119. Hermes Desktop configuration is reused and not modified. The server exposes only live voice readiness and session negotiation; provider credentials remain server-side. Microphone and playback use browser WebRTC. Start requires an explicit click.

Spoken delegated work uses `createAssistantRequest`, preserving the durable request receipts and existing approval path. It never calls tools or approval execution directly. Repeated delegation IDs are ignored; uncertain submissions are not retried. Conversation changes, navigation, and End release the microphone. Already accepted work is not cancelled by ending voice.

Work requests and backend answers persist through ordinary chat storage. Live audio captions are temporary and do not create separate permanent chat messages for small talk. Recent saved chat is supplied as bounded context when voice starts. The old Speak button remains dictation; Start voice mode is the new conversational feature.

Validation: 27 tests across live voice component, server bridge, microphone lifecycle/transport, and existing Assistant channel tests passed. TypeScript and production builds passed for both development and merged personalized runtime. Lint has warnings, no errors. Live HTTPS readiness returns available=true, gpt-live, Marin. Same-origin negotiation validation confirmed without creating a paid session. Browser confirmed Start voice mode is visible. Actual microphone input, remote audio playback, and end-to-end spoken delegation still require user testing.

Deployment runtime: `/home/ally-landry/.local/share/eaios/releases/v0.1.12-ser9-20261107-live-voice`.
Previous runtime: `/home/ally-landry/.local/share/eaios/releases/v0.1.12-ser9-20261107-chat-history`.
Rollback dropins and deployment receipt: `/home/ally-landry/.local/share/eaios/manual-deployments/live-voice-20261107T145057Z`.
Only eaios-server and eaios-server-5173 restarted. Version remains 0.1.12 personal. No GitHub release published. This source branch is based on f821c3b; production merges preserve the prior chat history and personalized application changes. Release preparation must include both feature branches.

Transport adapted from Hermes Desktop with its MIT notice retained in `app/src/lib/HERMES-VOICE-LICENSE.txt`.
