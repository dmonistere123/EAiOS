---
name: linkedin-posting
description: Publish approved LinkedIn posts and comments, with duplicate prevention.
version: 2.0.0
---

# LinkedIn publishing in EAiOS

Don's rule: suggest → Approvals → approve and publish, or reject and do not publish. Never interpret an accepted suggestion as a request for manual posting. Never mark a publishing task done merely because draft text was delivered.

## Comment suggestions

1. Retrieve the source and verify the precise LinkedIn post and its actual content. Gmail notifications may discover candidates, but sender/title alone is insufficient. Do not fabricate article content or substitute a different article's draft.
2. Resolve a real `urn:li:share:<id>` or `urn:li:ugcPost:<id>` from source metadata. Composio's comment tool does not accept activity URNs. Never guess by replacing `activity` with `share`. If no verified publishing target is available, report the missing capability; do not create a suggestion that cannot be executed.
3. Get the connected identity using `LINKEDIN_GET_MY_INFO`. Check whether Don has already commented through an available read tool if permitted. Never claim that a permission-denied read proves there are no existing comments.
4. Use `python3 "${HERMES_HOME:-$HOME/.hermes}/scripts/eaios-linkedin-comments.py" check '<post-urn>'`. Skip any existing pending, rejected, approved, posted, or unresolved attempt. Also compare the article/author with historical approval task titles; legacy tasks may lack a post URN. Previously approved legacy drafts are not confirmed posts; do not blindly resuggest or publish them.
5. Prepare a specific comment (1–1250 characters) and write only that text into a private local file. Create the UNASSIGNED approval using:
   `python3 "${HERMES_HOME:-$HOME/.hermes}/scripts/eaios-linkedin-comments.py" suggest --post-urn '<verified-urn>' --post-url '<source-url>' --label '<author and actual post title>' --text-file '<draft-file>' --actor-urn '<verified-person-urn>'`
   This helper checks for duplicates again while creating the approval. It uses actionType publish and a structured linkedinComment target. Never assign your own approval.
6. Explain that approving publishes the exact displayed comment. Rejection does not publish it. No manual-paste workflow.

## Executing an accepted comment

For a task with `linkedinComment`, run only:
`python3 "${HERMES_HOME:-$HOME/.hermes}/scripts/eaios-linkedin-comments.py" publish '<task-id>'`

The helper reads the persisted executive decision and current payload, verifies the connected identity, rejects terminal/rejected/pending tasks, locks against duplicate publishing, and executes `LINKEDIN_CREATE_COMMENT_ON_POST`. It requires a matching LinkedIn comment receipt before recording Posted.

On success, complete the task with the returned receipt including commentId, postUrn, and postedAt. On failure, block it with the actual failure, leave it unfinished, and report the failure through normal task delivery. Do not fall back to manual posting, fabricate success, bypass the helper with a second write, or blindly retry an unconfirmed attempt. A timeout can mean the write reached LinkedIn; reconcile the outcome before retrying.

Legacy review-only tasks do not have verified structured targets. Do not replay their old approvals automatically, particularly where a title and payload disagree. They need verified targets and corrected suggestions for a fresh executive decision.

## Original profile posts

Use actionType publish with the complete prepared text and assets. After approval, use the connected Composio LinkedIn post tool. Verify the actual tool schema/version each time; stale hardcoded API versions must not be reused. Record the real publish receipt, then complete the task. Errors remain failed/blocked tasks, never completed drafts.

## Messages and connections

Comment publishing is distinct from messaging or connection requests. Do not promise execution for actions the connected tools cannot perform. Report missing capability clearly instead of sending non-executable drafts to Approvals.
