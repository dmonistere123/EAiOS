# Dedicated Concierge SOUL

Based on deployed `4fe5461b4a0b054a36d0683e4f911caeab511ff5`, preserving Assistant recovery and voice fixes. The scope is one dedicated SOUL, isolated Concierge conversations, and direct context delivery. No separate guide, RAG, version tool or Hermes core changes.

## How it works

`concierge/SOUL.md` contains the concise role boundaries and route-by-route navigation/use reference (about 1,700 words). Keep it aligned with the implemented pages; do not describe undeployed features. Version questions point to Settings.

The read-only `/api/concierge/context` endpoint reads that fixed packaged file, checks the dedicated profile marker and matching installed SOUL, and returns the content plus its hash. No retrieval, provider calls, version checks or writes occur. The 24,000-character cap fails closed rather than truncating. Missing/mismatched sources give a sanitized error, never an Ally/mock fallback.

Concierge uses supported Hermes `session.create`/`session.resume` with `profile: eaios-concierge` and verifies the returned profile name. No model/provider override is sent; new sessions request `follow_profile_config: true`. Hermes loads the dedicated profile SOUL, and the adapter directly includes the full same SOUL on every turn, including resumed chats and stale-session retries. It is hidden from user message rendering.

Storage keys use the SOUL content hash in a dedicated `eaios.concierge.v2` namespace. Changed instructions start a fresh session after reviewed profile refresh. Legacy Ally/Concierge keys and histories are never read, migrated or deleted. Old events are unbound. Only explicit session-not-found failures permit recreation; ambiguous failures stop. Main Assistant and staff routing remain unchanged.

## Opt-in setup and activation review

No routine install/update/recovery script calls setup. No live profile, credentials, configuration or services were changed during implementation.

After approval, use the Hermes Python environment with PyYAML and the supported `hermes` CLI on PATH. `python scripts/setup-concierge.py` performs a no-write review. `python scripts/setup-concierge.py --apply` explicitly prepares the reviewed home; `--hermes-home` selects a different home. It calls `hermes profile create eaios-concierge --no-alias --no-skills`, never profile cloning. Existing profiles are refused. A failure can leave an unmarked partial new profile; inspect it manually, never auto-delete it.

The setup preserves the default model/provider choice and a simple configured fallback as a snapshot. It does not copy identity, memory, history, MCP configuration or credential files. It disables memory/user-profile memory and coding-context expansion, and selects the clarification toolset. Root configuration remains unchanged. Custom provider routing, complex fallback chains and credentials require administrator review/provisioning for this profile; they are not cloned.

Before activation, verify profile-scoped provider access and effective tools on the installed Hermes version. Launch-wide overrides and Hermes surface tools can affect the effective tool list; these instructions are not an OS sandbox. Do not enable operational tools such as terminal, file, browser, integrations, delegation, cron or memory for the guide. Live authentication/effective-tool behavior has not been exercised, and no real model prompt was sent.

Package `concierge/SOUL.md` with the application. Custom deployment copy lists must include it. Activation needs separate approval and the normal deployment procedure. Check the context endpoint and brain widget without submitting a prompt. Setup never restarts services; any runtime restart requires separate operational review.

## SOUL updates and rollback

Review `python scripts/setup-concierge.py --refresh-documents`, then use `--apply` only after approval. It verifies the last managed SOUL hash, refuses customizations/symlinks, and updates only the dedicated SOUL/marker. Model settings and history remain intact. Deploy the matching package together; mismatched files disable Concierge until reconciled.

Roll back the application through the normal reviewed procedure, preserving all profile data and browser keys. A pre-feature package resumes its untouched legacy lane. An earlier dedicated-Concierge package requires its matching SOUL via reviewed refresh and can resume that revision's own conversation. Never copy Concierge history into Ally or delete the profile as part of rollback.

## Verification

Synthetic tests cover widget → real shared HTTP handler → SOUL → mocked Hermes RPC; first/later/resumed/new chats; source refresh; stale sessions; old-event/legacy-history isolation; missing/empty/oversized sources; wrong profile; offline behavior and error UI. Setup tests use a fake Hermes runner and disposable profiles.

Run the frontend tests/lint/build, repository Node script suite, and `python3 -m unittest discover -s scripts/tests -p test_concierge_setup.py -v`. Socket tests require local test permissions. No sidecar changes are involved.

## Release readiness for other boxes

The fresh installer clones the full repository. The Settings release installer (`scripts/install-release.mjs`) creates a full detached worktree at the published release commit, so the packaged SOUL, endpoint and opt-in setup script travel with the release; they do not depend on this development machine's paths. Routine updates deliberately do not invoke profile setup or copy credentials. Existing boxes must complete the reviewed opt-in profile preparation/provider-access check using the new release's script before enabling this widget. Without that step the app can update, but Concierge correctly remains unavailable.

The release manifest currently has no minimum Hermes version/feature gate. Before a fleet rollout, verify each box supports named profiles, the setup flags, and session response profile identity. Older gateways fail closed here; no Hermes patch or automatic Hermes upgrade is included. This is not yet a proven unattended fleet migration.

Validation: all 436 frontend tests passed before consolidating the two documents into one SOUL; the final single-SOUL change passed all 53 affected frontend tests, 7 isolated setup tests, lint and build. Existing lint/bundle-size warnings remain. The Node script suite passed 29/30: the unchanged release fixture omits `scripts/tests/test_install_linkedin_workflow.py`, now required by `release.sh`. Resolve that separate release-test fixture failure before publication. No real provider, profile activation, deployment or push was performed.
