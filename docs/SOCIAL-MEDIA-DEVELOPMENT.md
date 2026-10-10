# Social Media studio — first implementation

The `/social` page replaces the navigation hyperlink and uses the existing EAiOS dark theme and right rail. Vista Social remains an external link within the page.

## Available now

- Persistent manual drafts and AI-generated network-specific drafts for LinkedIn, X and Snapchat.
- Subject, voice, publishing identity, image direction, daily/custom/Monday-Wednesday-Friday dates, local time and IANA time zone.
- A separate draft per selected network and planned date. These are finite plans, not recurring unattended jobs.
- OpenRouter text generation (Hermes-scope `OPENROUTER_API_KEY`); default `google/gemini-2.5-flash`, override `EAIOS_SOCIAL_MODEL` in the server environment.
- Automatic per-draft OpenAI PNG generation when Photo or Branded graphic is selected, with manual regeneration in Review (Hermes-scope `OPENAI_API_KEY`); default `gpt-image-1`, override `EAIOS_SOCIAL_IMAGE_MODEL`. Images use low quality initially; square for LinkedIn/X and portrait concepts for Snapchat. Provider charges apply only on the user's generation action. No generation runs on page load.
- Newsletter URL plus pasted newsletter text → Tuesday/Thursday blog draft. URLs are validated but not fetched. The writing model has no tools and cannot execute instructions in pasted source material.
- Review/edit, mark content ready, and archive drafts. Every edit or generated image invalidates the reviewed state. Optimistic revisions reject stale edits.
- Upcoming rows with actual image thumbnails when generated; a right-side published-history view and a 30-day archive filter.

## Explicitly not enabled yet

- OAuth/account selection and actual LinkedIn, X or Snapchat publishing. A configured Composio key is not represented as an authenticated social account.
- Automatic scheduling or recurrence. Planned dates and `reviewed` status confer no external-write authority. The API rejects client-supplied publish actions. No scheduler or agent can consume these rows to publish.
- Publishing approval envelopes, exact destination/account approval, provider receipts, safe retry/reconciliation and scheduled-job execution are the next integration layer. Implement those together, reusing the approval module; do not turn `reviewed` into permission to send.
- LinkedIn newsletter creation, automatic article import and Allygnment.com blog upload. Website access and publishing mechanism need verification. No FTP credentials were inspected or assumed.
- Snapchat Public Profile API approval; portrait concepts will need provider-specific export/format validation before publishing.

## Storage and upgrades

`<EAIOS_DATA_ROOT>/social-data/social.db` contains drafts, the last brief, generation request IDs and image blobs. With no explicit data root, the existing API context's repository root is used. Directory mode is 0700 and database mode 0600. SQLite transactions coordinate both dashboard processes. Runtime data is gitignored and belongs outside a staged release. No Hermes profiles, skills, agents, conversations, credentials or production database are modified by this feature.

The release installer includes this database in its online SQLite backup inventory. Upgrade tests verify both the retained data and its backup. Local production deployment uses a separately staged application release and retains the existing data root. History filtering archives older published rows without deleting their data. There is currently no browser route that can forge a published row.

Generation request IDs are reserved per planned slot before the provider request and reused on transport retry. Duplicate submissions are refused. Provider failures never create demo content. A timeout can still incur provider usage; reload the board before explicitly starting a new request. The UI generates text first, saves the drafts, then creates images sequentially with visible progress. Image failure stops the image batch, preserves all drafts and completed images, and reports the failure without repeating text generation. Text-only selection makes no image requests. The queue lists newest-created drafts first.

## Isolated development

From `app`, run `npm run dev:social`, then open `http://127.0.0.1:5279/social`.

This uses the real Social API and SQLite persistence under `.local/social-sandbox/`, without production keys, data, proxies or services. The rest of the app uses mock adapters. Use **Write my own** to test persistence and review without any model credentials. No mock model or image response is used. To test actual generation deliberately, provision test credentials in `.local/social-sandbox/.env`; never commit the file or copy production environment files. Settings → API keys & services → Social Media provides the key form backed by the isolated key store. This is a filtered view of the existing Hermes-scope keys, not an additional credential store. The key-settings API is enabled for this purpose; other APIs remain disabled.

Tests: `npm test -- --run src/tests/social-server.test.ts` includes real temporary SQLite storage and real HTTP routing. Provider responses are mocked, so those tests verify handling rather than live provider access. Full UI/manual verification uses the isolated service. No real social posts are sent.

## Provider references

- [Snapchat Public Profile access](https://developers.snap.com/marketing-api/Public-Profile-API/GetStarted)
- [Composio toolkits](https://docs.composio.dev/docs/toolkits)
- [OpenAI image generation](https://developers.openai.com/api/reference/resources/images/methods/generate)

## Connector verification — 2026-10-10

Read-only checks against this box's Composio project found X under `twitter`, without managed OAuth or an existing custom X auth configuration. Snapchat is present under `snapchat`; its 140 advertised tools cover advertising/business operations and profile lookup, with no Story/Spotlight publishing tool found. Do not equate that connector with organic social publishing.

The Connections catalog now follows pagination (the former first-100 limit hid Snapchat), displays `X (Twitter)` and `Snapchat Ads`, offers a setup link, and can reuse exactly one matching custom auth configuration. Multiple custom configurations require explicit selection in a future account-setup flow; the adapter refuses to guess. New pagination and auth selection regression tests do not contact real accounts.

## Monthly planning and length limits

Choose start/end dates spanning at most 31 calendar days, or clear the end date and use Draft ahead. Monday/Wednesday/Friday is the default cadence. Every date/network combination is a separate generation request and saved immediately. Keep the page open; this is not a background job. Earlier completed drafts survive later failures. Restarting a new batch after Reload creates new drafts; review the saved queue first.

The writer receives the monthly angle plan and recent copy for the same identity to encourage distinct openings and takeaways. Uniqueness is model-directed, not a guarantee. LinkedIn is limited to 850 characters, X to 280, Snapchat to 250, and blogs to 12000. X uses a conservative weighted counter (wide characters count twice and URLs reserve at least 23); it can overcount emoji sequences and long links. Provider-specific final validation belongs in the future publishing integration.

Overlong output is saved first, then gets exactly one model shortening request. Provider failure or a still-overlong correction preserves the original, flags it, and prevents marking ready. Draft edits may remain overlong while in progress. Existing reviewed posts are not automatically rewritten. No generation grants publishing permission.

Automated tests use temporary SQLite and mocked writing/image providers; they cover monthly/DST dates, one-post calls, prior-copy context, length correction/failure preservation, review gates, image handling, and upgrade persistence. Real provider output quality still requires human review.
