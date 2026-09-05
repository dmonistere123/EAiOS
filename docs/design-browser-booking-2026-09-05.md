# Browser-automation travel booking — design (F31 extension)

**Date:** 2026-09-05  
**Task:** t_a0417617  
**Risk:** 5/10  
**Complexity:** 8/10  
**Estimate:** 1 long session for foundation + child tasks for per-site hardening.

## Goal

Extend EAiOS Travel so hotels, cars, and restaurants can be searched and booked
through browser automation against consumer sites (IHG, Marriott, Booking.com,
Kayak, OpenTable, Resy, etc.) using Don's existing accounts. The agent stops at
the final review page; real checkout is gated by an EAiOS approval envelope.

## Invariants

1. **No API keys required for consumer sites** — we drive the public web UI with
   Don's logged-in sessions.
2. **Credentials live in an encrypted vault** — never plaintext in env or repo.
3. **Sessions are persistent** — encrypted cookie jar so Don does not re-auth
   every search.
4. **Approval gate is mandatory for spend** — search is read-only; any action
   that could cost money (book, reserve, hold) creates a pending TravelApproval.
5. **Audit everything** — every browser action, credential access, and approval
   decision gets an audit event id.
6. **Honest degradation** — if the browser engine is not configured, the live
   adapter falls back to mock fixtures with a visible provider notice.

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│  EAiOS React app                                                │
│  Travel.tsx ──► LiveTravelAdapter ──► /api/travel/*             │
└─────────────────────────────────┬───────────────────────────────┘
                                  │
┌─────────────────────────────────▼───────────────────────────────┐
│  server/travel.ts                                               │
│  searchTravel() ──► fetchLiveResults()                          │
│  proposeBooking() ──► TravelApproval (pending)                  │
│  decideTravelApproval() ──► on approve: executeBooking()        │
└─────────────────────────────────┬───────────────────────────────┘
                                  │
┌─────────────────────────────────▼───────────────────────────────┐
│  server/travelBrowser/                                          │
│  ├── vault.ts        encrypted credential store                 │
│  ├── sessions.ts     encrypted cookie jar                       │
│  ├── playbooks.ts    per-site step definitions                  │
│  ├── runner.ts       Node ↔ Python browser-use bridge           │
│  └── index.ts        public API (search, book, vault mgmt)      │
└─────────────────────────────────┬───────────────────────────────┘
                                  │ subprocess JSON-RPC
┌─────────────────────────────────▼───────────────────────────────┐
│  server/travelBrowser/runner.py                                 │
│  browser_use.Browser + Agent or structured CDP steps            │
└─────────────────────────────────────────────────────────────────┘
```

## Credential vault

- Storage: `~/.hermes/eaios/travel-browser-vault.enc` (AES-256-GCM + PBKDF2).
- Key source: `TRAVEL_BROWSER_VAULT_KEY` env var (32-byte base64) or a master
  password prompt path in a future UI. For v0 we require the env var.
- Contents: array of `SiteCredential` objects; password and TOTP seed are
  encrypted at rest inside the vault file with the same vault key.
- Backup: file is chmod 600; key is never persisted.
- Future: pluggable backends (Bitwarden SDK, 1Password CLI, OS keychain) via
  adapter interface; default file vault remains the fallback.

## Pluggable credential backends (2026-09-05)

Implemented in `server/travelBrowser/vaultBackend.ts`.

### Interface

```ts
interface VaultBackend {
  list(): VaultSiteSummary[];
  get(site: string): SiteCredential | null;
  getDecrypted(site: string): (SiteCredential & { password?: string; totpSeed?: string }) | null;
  set(site: string, input: { username?, password?, totpSeed?, notes? }): void;
  remove(site: string): boolean;
  has(site: string): boolean;
}
```

`CredentialVault` delegates to a `VaultBackend`. The constructor still uses
the file backend by default. Use `CredentialVault.withBackend()` for tests,
or `CredentialVault.createFromEnv()` to auto-select.

### FileVaultBackend (default)

The original AES-256-GCM encrypted JSON file at
`~/.hermes/eaios/travel-browser-vault.enc`. Requires `TRAVEL_BROWSER_VAULT_KEY`.

### OnePasswordVaultBackend (env: `1password`)

Wraps the 1Password CLI (`op`). Stores each site credential as a Login item
titled `eaios-travel:<site>`.

**Env vars:**

| Var | Purpose |
|---|---|
| `OP_CLI_BIN` | Path to `op` binary (default: `op` on PATH). |
| `OP_VAULT` | 1Password vault name/UUID to scope item operations. |
| `TRAVEL_BROWSER_VAULT_BACKEND=1password` | Select this backend. |

The 32-byte vault key env var (`TRAVEL_BROWSER_VAULT_KEY`) is ignored when this
backend is active — 1Password manages its own authentication (session token
from `op signin` or `OP_SESSION_<org>` env var).

### BitwardenVaultBackend (env: `bitwarden`)

Wraps the Bitwarden CLI (`bw`). Stores each site credential as a login item
named `eaios-travel:<site>`.

**Env vars:**

| Var | Purpose |
|---|---|
| `BW_CLI_BIN` | Path to `bw` binary (default: `bw` on PATH). |
| `BW_SESSION` | Bitwarden session key (standard `bw` env var after `bw unlock`). |
| `TRAVEL_BROWSER_VAULT_BACKEND=bitwarden` | Select this backend. |

### KeyringVaultBackend (env: `keyring`)

Uses the Python `keyring` module to access the OS-native secret store (macOS
Keychain, Linux Secret Service, Windows Credential Credential Vault). Stores
one keyring entry per site with service `eaios-travel` and account `<site>`.

**Env vars:**

| Var | Purpose |
|---|---|
| `KEYRING_PYTHON` | Path to Python interpreter with `keyring` installed (default: `python3` on PATH). |
| `TRAVEL_BROWSER_VAULT_BACKEND=keyring` | Select this backend. |

Python `keyring` must be installed (`pip install keyring`).

### Backend selection

`TRAVEL_BROWSER_VAULT_BACKEND` env var chooses:

| Value | Backend |
|---|---|
| `file` (default) | FileVaultBackend (requires `TRAVEL_BROWSER_VAULT_KEY`) |
| `1password` or `op` | OnePasswordVaultBackend |
| `bitwarden` or `bw` | BitwardenVaultBackend |
| `keyring` or `os` | KeyringVaultBackend |

## Session / cookie persistence

- Storage: `~/.hermes/eaios/travel-browser-sessions.enc`.
- Same encryption key as the vault.
- One cookie jar per `site` label (e.g. `ihg`, `opentable`).
- Playbooks declare an `authUrl` and `authSteps`; the runner loads the saved
  cookies first, detects whether the user is still logged in, and runs auth
  steps only when needed.

## Playbooks

A playbook is a JSON/TypeScript object registered in `playbooks.ts`:

```ts
interface Playbook {
  id: string;          // e.g. 'kayak-hotels'
  site: string;        // cookie jar label
  kind: 'hotel' | 'car' | 'restaurant';
  loginUrl?: string;
  searchUrl: string;
  authSteps?: Step[];  // login if cookies are stale
  searchSteps: Step[]; // fill search, submit, extract results
  bookingSteps: Step[];// select result, proceed to review page, stop
}

type Step =
  | { action: 'goto'; url: string }
  | { action: 'fill'; selector: string; value: string | '<param:destination>' }
  | { action: 'click'; selector: string }
  | { action: 'wait'; ms: number }
  | { action: 'extract'; schema: object; prompt: string };
```

For v0 we ship a generic `kayak-hotels` and `kayak-cars` playbook plus stub
registrations for IHG, Marriott, OpenTable, and Resy. Per-site hardening is
tracked in child tasks.

## Search flow

1. `server/travel.ts` receives `TravelSearchParams { kind: 'hotel' | 'car' | 'restaurant' }`.
2. `fetchLiveResults()` checks `providerStatus().browserUse`.
3. `searchBrowserUse()` calls `travelBrowser.search(params)`.
4. The engine picks the best playbook for the kind, loads the cookie jar,
   launches the browser-use Python runner, and returns `TravelSearchResult[]`.
5. Results are cached in `searchCache` so `proposeBooking()` can reconstruct
   the booking details.

## Booking / approval flow

1. User clicks **Propose** on a browser-use result.
2. `proposeBooking()` creates a `TravelBooking` with status `proposed` and a
   pending `TravelApproval` with `targetSystem: 'browser-use-consumer'`.
3. The approval payload includes the final review URL, price, and a note that
   the agent will stop before checkout.
4. Executive reviews in Travel → Approvals tab.
5. On **Approve**, `decideTravelApproval()` calls `travelBrowser.executeBooking()`.
6. The runner resumes the saved session, runs the booking steps, stops at the
   review page, and returns the final URL + screenshot. It does **not** click
   the final "Pay now" / "Complete reservation" button unless the playbook
   explicitly includes it and a second "confirmation" approval is configured.
   For v0 the default is stop-before-checkout.
7. On success, the booking status becomes `confirmed` and a confirmation
   number is recorded if the playbook extracted one.

## Audit

- Every server call returns an `auditEventId` (existing pattern).
- The browser runner returns a log array of `{ ts, action, url, selector }`.
- Credential access and cookie jar load/save are logged with their own audit
  event ids and linked to the parent travel audit event.

## Env vars

| Var | Purpose |
|---|---|
| `TRAVEL_BROWSER_USE=1` | Enable the browser-use provider. |
| `CHROME_BIN` | Path to Chrome/Chromium binary for the Python runner. |
| `TRAVEL_BROWSER_VAULT_KEY` | Base64-encoded 32-byte AES key for vault + sessions. |
| `TRAVEL_BROWSER_DATA_DIR` | Optional override for vault/session dir (default `~/.hermes/eaios`). |
| `BROWSER_USE_PYTHON` | Optional path to the Python interpreter with browser_use (default auto-detect uv tool). |

## API additions

- `GET /api/travel/browser-status` — whether browser-use is configured and the
  vault is unlocked (key present).
- `GET /api/travel/browser-vault/sites` — list sites with stored credentials
  (no secrets returned).
- `POST /api/travel/browser-vault/sites/:site` — store/update credentials.
- `DELETE /api/travel/browser-vault/sites/:site` — remove credentials.

## Child tasks to spawn

1. `t_?` — Per-site playbook: IHG hotel search/book.  
2. `t_?` — Per-site playbook: Marriott/Bonvoy hotel search/book.  
3. `t_?` — Per-site playbook: OpenTable restaurant reservations.  
4. `t_?` — Per-site playbook: Resy restaurant reservations.  
5. `t_?` — Password-manager vault backend (1Password/Bitwarden/keychain).  
6. `t_?` — Travel UI credential vault manager page.

## Open questions

- Should the browser runner execute inside the EAiOS server process or as a
  separate kanban worker? For v0 it is a subprocess call from the server; long
  or fragile runs can be moved to a worker later.
- Should we support TOTP? Playbook step type reserved; implementation in a
  follow-up.
