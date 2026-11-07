# Approval orchestration default

The executive requested that general approvals route to Ally without choosing an executor. Generic approval and recovery now assign the built-in default profile atomically with the human decision/recovery. Historical executorProfile values are normalized to default at approval, including absent, stale and self-drafter values. requestedBy, sourceContext, approved payload and unknown metadata remain intact. Undecided, rejected, and changes-requested tasks remain blocked/unassigned. Existing stale-body, dependency, in-flight, and dedicated email/share gates remain enforced.

UI removes executor selection and shows orchestrator routing. Previously approved blocked general work offers Resume with Ally. No existing approval was executed as part of deployment. Existing prepared payloads are not rewritten; if they ask for a particular specialist Ally may delegate accordingly.

23 SQLite gate tests and 5 UI journeys passed. Installed Hermes scheduler integration passed using its venv and a disposable database: pending tasks cannot be claimed, human approval makes the default-assigned task claimable exactly once. Initial integration attempt with system Python lacked ruamel; rerun with Hermes venv passed. Development and merged production TypeScript/build checks passed; lint warnings only. Production inspector verified enabled Resume with Ally and no executor selector.

Personalized runtime: /home/ally-landry/.local/share/eaios/releases/v0.1.12-ser9-20261107-ally-approvals
Rollback: /home/ally-landry/.local/share/eaios/manual-deployments/ally-approvals-20261107T151656Z
Previous: v0.1.12-ser9-20261107-live-voice. Version remains 0.1.12 personal. Only the two EAiOS servers restarted; no Hermes state, skills or voice configuration changed. GitHub release not published. Source branch codex/approval-orchestrator must be included alongside earlier voice/history branches in next release.
