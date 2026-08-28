# W4 Brief — Connections: available vs connected

**Written:** 2026-08-28, before build (working rule 1). **Plan:** beta-readiness-plan.md
W4. **Probes:** HANDOFF #17 (toolkits) + this file (auth_configs, /link — verified live 2026-08-28).

## Probe findings (all verified live on this box)

- `GET /api/v3/toolkits?limit=100` → 100 of **1431** toolkits. Fields per
  HANDOFF #17. **`deprecated` is non-null on every record** (legacy id
  mapping `{toolkitId}`) — NOT a deprecation flag; ignore it. `no_auth` true
  on ~7%.
- `GET /api/v3/auth_configs?toolkit=<slug>` → **0 configs on this account**
  (F6 confirmed: nothing set up yet).
- `POST /api/v3/auth_configs {toolkit:{slug}, auth_config:{type:'use_composio_managed_auth', name}}`
  → 201 `{auth_config:{id:'ac_…', is_composio_managed:true}}` — **managed
  auth configs are API-creatable; the dashboard is NOT required** for
  managed-OAuth toolkits.
- `POST /api/v3/connected_accounts/link {auth_config_id, user_id}` → 201
  `{link_token, redirect_url: 'https://connect.composio.dev/link/lk_…',
  expires_at (~30 min), connected_account_id: 'ca_…'}` — **creates an
  INITIALIZING connected account** at link time (visible in
  connected_accounts until it expires / completes / is deleted).
- Full round-trip + auth-config cleanup verified (`scripts/verify-w4-connect.mjs`).
  A stray INITIALIZING account (`ca_sbmJq4B8A2DW`) remains from the probe —
  bulk-delete cleanup was blocked pending user consent; surfaced to the user.
  The page renders such strays honestly as degraded/incomplete and the user
  can remove them with the existing disconnect path.

## Design

**Adapter (`ComposioAdapter`):**

- `AvailableApp = { slug, name, description, logoUrl?, toolsCount,
  categories, authKind: 'composio_managed' | 'bring_own_auth' | 'no_auth' }`
  — authKind from `composio_managed_auth_schemes` / `auth_schemes` /
  `no_auth`.
- `listAvailableApps(): Promise<AvailableApp[]>` — live: toolkits (limit 100,
  catalog order = relevance); mock: ~8 fixture apps with mixed authKinds.
- `connectApp(appKey)` becomes REAL: reuse an existing managed auth config
  or create one (`EAiOS — <name>`), then POST `/link` with a stable
  `user_id` (`eaios-executive`) → `{ flowId: link_token, authUrl:
  redirect_url }`. If the toolkit has no managed scheme, return
  `{ flowId, authUrl: undefined, note }` — the UI shows the honest reason
  (custom auth config needed; dashboard/API-key path, F6).
  `ConnectionFlow` gains `note?: string`.

**Page (Connections):**

- Middle: connected cards (existing) — INITIALIZING/abandoned links show as
  degraded ("incomplete") and are removable via the existing disconnect.
  The dead "Browse app catalog" stub card is REPLACED by the real rail.
- Rail (D-B4): "Available to connect" — client-side search over the
  catalog; each row: logo, name, tools count, auth kind badge, Connect
  button. Connect → `window.open(authUrl)` + toast (finish in the Composio
  tab, then refresh); no-URL → inline note. A Refresh action re-pulls
  connections after OAuth completes.
- Copy is explicit that first connect creates a Composio-managed auth
  config on the account (an account-setup write, not an external send; D3
  untouched — sending/acting still gates on approvals).

## Acceptance checklist

- [x] Catalog in rail (live toolkits / mock fixtures), search filters.
- [x] Connect on a managed toolkit mints a real redirect_url (live-verified
  flow), opens in a new tab; honest note for non-managed toolkits.
- [x] Stray/abandoned link accounts visible as degraded ('incomplete') +
  resumable/removable. (The probe stray self-resolved: link expiry swept it.)
- [x] Mock parity; vitest (104) + sidecar (8) green; build clean.
- [x] Live visual check; HANDOFF gotcha + progress; boxes checked.

## Honest gaps

- Catalog is the first 100 of 1431 (API relevance order) + client-side
  search — paging the full catalog is not beta scope.
- `bring_own_auth` toolkits can't be connected in-app (F6) — shown with
  the reason, not hidden.
- Link-token expiry (~30 min) means an abandoned flow needs a fresh
  Connect click — surfaced via the degraded card, not hidden.
