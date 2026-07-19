## Fairport UI

## Pre-Reqs (Must do before starting for context)
- Find app files: `find . -name "*.ts" -o -name "*.tsx"`
- Read README.md: `cat README.md`
- Keep this doc updated as you make changes for the next agent.
- Include context and information as to why certain decisions were made
- Keep this page as short as possible
- Never try to install any packages on the users device, always build everything into the container with `make build`
- A task is considered done after all .md files are updated: `ls *.md`
- A task is considered done after tests are added for adding new features (see TESTS.md)
- A task is considered done after `make build` and `make test` complete successfully

# Implementation Details

----Agents update below this line, do not remove this line----

## PostgreSQL/PGlite Support (2026-05-28)

Added `DATABASE_TYPE` env var to support multiple database backends:

- `DATABASE_TYPE=pglite` (default): uses embedded PGlite WASM engine via `@electric-sql/pglite`
- `DATABASE_TYPE=yaml`: stores data in `db.yaml` (existing behavior, unchanged)
- `DATABASE_TYPE=postgres`: uses full PostgreSQL via `pg` package

### Docker & Build Fixes
- **esbuild Bundling**: Added `--bundle` flag to the server build command in `package.json`. Along with `--packages=external`, this forces esbuild to bundle relative imports (like `./src/db/index`) into `dist/server.js` instead of leaving them as external modules that cannot be resolved in the slim production container. Removed explicit `.ts` extensions from `server.ts` relative imports to allow proper esbuild resolution.
- **Directory Permissions**: Pre-created and chowned the `pglite-data` directory to the non-privileged `node` user in the `Dockerfile` production stage to prevent `EACCES: permission denied` errors during PGlite initialization.
- **Playwright Test Caching**: Added an intermediate `playwright-base` stage in the `Dockerfile` that installs the specific Playwright version (`@1.52.0`) and its system/browser dependencies completely independent of the application source code or standard `package.json` updates. The `test` stage now inherits directly from this `playwright-base` stage. This avoids invalidating and reinstalling large browser and OS packages every time local package dependencies or source code files change, dramatically reducing test build times.

### Architecture

All database operations were extracted from `server.ts` into a proper abstraction layer:

- `src/db/types.ts` — TypeScript interfaces for DbData, DatabaseAdapter, and all entity types
- `src/db/index.ts` — Factory function `createDatabase(type)` that returns the right adapter
- `src/db/yaml-adapter.ts` — Reads/writes `db.yaml` via `js-yaml` (sync, wrapped as async)
- `src/db/pglite-adapter.ts` — Uses `@electric-sql/pglite` with in-memory or file-backed storage; tables created on first `load()`
- `src/db/postgres-adapter.ts` — Uses `pg` Pool; auto-creates the database and tables on first connection

`server.ts` now imports `createDatabase` and uses `async loadDb()` / `async saveDb(data)` throughout.

### New env vars
- `DATABASE_TYPE` — `pglite` (default), `yaml`, or `postgres`
- `PGHOST` — required when `DATABASE_TYPE=postgres`
- `PGPORT` — default `5432`
- `PGDATABASE` — default `fairport-ui`
- `PGUSER` — required when `DATABASE_TYPE=postgres`
- `PGPASSWORD` — required when `DATABASE_TYPE=postgres`

### Dependencies
- `@electric-sql/pglite` (optional) — PGlite adapter
- `pg` (optional) — PostgreSQL adapter
- Both are `optionalDependencies` in `package.json` so the app starts without them when using YAML mode

### Schema
Tables mirror the YAML collections: `users`, `api_keys`, `roles`, `groups_table` (named to avoid reserved word), `models`, `messages`, `providers`, `model_pricing`, `usage_events`. JSON fields (`permissions`, `members`, `api_keys`) stored as `TEXT` in PGlite, `JSONB` in PostgreSQL.

## Security Hardening (2026-05-27)

The following security issues were identified and fixed:

- **C1 — OAuth token leak**: OAuth callback now redirects with `?oauth_code=<one-time-code>` instead of `?token=<jwt>`. Frontend POSTs the code to `POST /api/auth/oauth/exchange` which returns the JWT in a JSON body. Codes expire after 5 minutes and are single-use. This prevents JWTs appearing in browser history, server access logs, and Referer headers.
- **C2/M4 — SSRF**: Replaced the naive `169.254.169.254` string check with `isAllowedProviderUrl()` which parses the URL, blocks bare private IPs (RFC-1918, loopback, link-local, unspecified), rejects `localhost`/`.local`/`.internal` hostnames, and rejects URLs with userinfo (credential-bypass vectors).
- **C3 — API key in frontend bundle**: Removed `process.env.GEMINI_API_KEY` from `vite.config.ts` `define` block — it was being baked into the JS bundle.
- **C4 — Immutable provider plaintext key**: `ensureDefaults()` now encrypts the default provider's `api_key` using AES-256-GCM (same scheme as user keys, salt `'immutable'`). Encrypted keys are stored with an `enc:` prefix. Only activates when `SECRET_KEY` is explicitly set in env to avoid losing decryption ability across restarts. Existing plaintext keys are migrated on first boot. `resolveProviderApiKey()` detects the `enc:` prefix and decrypts accordingly.
- **C5 — No auth rate limiting**: Added `checkAuthRateLimit(ip)` / `resetAuthRateLimit(ip)` functions with a sliding window counter. Default: 10 attempts per 15 minutes per client IP (configurable via `AUTH_RATE_LIMIT_MAX` / `AUTH_RATE_LIMIT_WINDOW_MS` env vars). Applied to both `/api/auth/login` and `/api/auth/signup`. Counter resets on successful login.
- **H3 — User enumeration**: Login now returns a single generic `"Invalid credentials."` message for both "user not found" and "wrong password". The SSO-only message is preserved as a UX necessity (users need to know to use the SSO button).
- **H4 — Security headers**: Added `helmet` middleware with a Content-Security-Policy. `helmet` added to `package.json` — installed in container via `make build`.
- **H6 — Trust proxy**: `app.set('trust proxy', 1)` replaced with conditional logic driven by `TRUST_PROXY` env var. Unset = no proxy trust (safe default for direct exposure).
- **L3 — Weak RNG fallback**: Removed `Math.random()` fallback in `genId()` in `App.tsx`. `crypto.randomUUID()` is universally available.

### New env vars
- `TRUST_PROXY` — set to `1` (or a number/string) to enable reverse-proxy IP trust
- `AUTH_RATE_LIMIT_MAX` — max auth attempts per window (default: `10`)
- `AUTH_RATE_LIMIT_WINDOW_MS` — rate limit window in ms (default: `900000` = 15 min)
- `SIGNUPS_ENABLED` — set to `false` to disable new user registration (default: `true`); login unaffected

### New endpoints
- `POST /api/auth/oauth/exchange` — exchanges a short-lived one-time OAuth code for a JWT

## Chat Parameter Passthrough (2026-07-15)

Both `/api/chat/stream` and `/v1/chat/completions` now preserve unrecognized top-level request fields when forwarding to the selected provider.

- `provider` and `provider_id` remain Fairport-only and are not forwarded.
- Fairport applies its resolved `model`, `messages`, and `stream` after passthrough fields so those values remain authoritative.
- The Chat page has a responsive `Extra Parameters` modal. Values are parsed as JSON, saved per user with the current chat, and included in subsequent requests.
- Clear History and logout remove the saved parameters; reserved Fairport fields, duplicate keys, empty keys, and invalid JSON are rejected.
- `tests/server/chat-stream.test.ts` covers nested passthrough values and server-controlled fields for both endpoints.
- `tests/e2e/app.spec.ts` covers modal validation, typed payloads, refresh persistence, Clear History cleanup, and the mobile layout.

## Chat Stream Robustness (2026-07-13)

Hardened `/api/chat/stream` upstream SSE handling:

- Buffers partial upstream `data:` lines across Node stream chunks before parsing.
- Treats upstream `end` as a successful finish if `[DONE]` was not observed, so the per-provider queue is released.
- Handles upstream stream `error` events and flushes SSE headers immediately.
- Added `tests/server/chat-stream.test.ts` for split SSE chunk compatibility.

## Signup Allowlist (2026-07-14)

- `SIGNUP_ALLOWED_EMAILS` and `SIGNUP_ALLOWED_DOMAINS` are optional comma-separated, case-insensitive allowlists combined with OR semantics.
- Domain matching is exact; subdomains must be listed separately. Empty lists preserve unrestricted signup.
- The shared check covers password and OAuth user creation, but not existing-user login. OAuth emails are normalized before lookup.
- Password signup does not verify email ownership, so deployments using the allowlist as an access boundary should use an identity provider that supplies verified email addresses.

## Tech Stack
- **Backend**: Node.js + Express + TypeScript (compiled to `dist/server.js`)
- **Frontend**: React + TypeScript + Vite
- **Database**: YAML file (`db.yaml`) with flat schema (users, api_keys, roles, groups, models, messages, providers, model_pricing, usage_events)
- **Authentication**: JWT tokens + Bearer token API keys

## Files

### `CHAT_PERSISTENCE` env var
- `CHAT_PERSISTENCE=client` (default): chat messages stored in browser localStorage, `GET /api/messages` returns `[]`, server skips message persistence
- `CHAT_PERSISTENCE=server`: messages stored server-side in `db.yaml` (original behavior)
- Chat history stored per-user in localStorage under `app_chat_history_<username>` so switching users in the same browser doesn't leak chats

### `server.ts`
- Main Express server (API + static file serving)
- Endpoints: `/api/auth/*`, `/api/keys`, `/api/providers`, `/api/groups`, `/api/groups/:slug`, `/api/groups/:slug/members`, `/api/admin/users`, `/api/admin/users/:userId`, `/api/admin/users/:userId/keys/:keyId`, `/api/admin/users/:userId/providers/:providerId`, `/api/admin/users/:userId/groups/:groupSlug`, `/api/admin/users/:userId/usage`, `/api/chat/stream`, `/v1/chat/completions`, `/api/messages`, `/api/config`, `/api/usage`

### `src/App.tsx`
- Main React component with full UI
- Tabs: Chat, API, Providers, Usage, Settings, Deployments
- Active tabs sync to the URL bar via `history.replaceState` (`/chat`, `/api`, `/providers`, `/usage`, `/settings`, `/deployments`); unauthenticated users see `/login`
- Identity dropdown in header bar: shows "User: <email>" and "Group: <name>" per member group; switches which resources (keys, providers, usage) are loaded
- Deployments tab: client-side only (no API), with New Deployment form (10 fields in 2-column grid: Name, Image dropdown, Model, Location dropdown (local only), GPU Type dropdown, Num GPUs, Min/Max Replicas, Host CPUs, Host Memory) and Deployments list table (Name, Min, Max, Current Replicas, Edit/Delete). Edit opens modal overlay with same fields pre-populated. Max 5 deployments.
- Group management in Settings (admin only): group list, add member by email, search members, view/delete user resources (keys, providers), delete users
- KeyManager component for API key CRUD
- ProviderManager component for provider CRUD (immutable default provider cannot be edited/deleted)
- MessageRow for chat messages with thinking/telemetry display
- Active key and provider selection via dropdown in header bar (not in Keys/Providers tab)
- Keys tab shows registered keys but clicking them doesn't select/activate them

### Mobile Layout
- Sidebar collapses into a slide-over drawer on screens < `md` (768px)
- `sidebarOpen` state controls visibility; closes on tab click or backdrop tap
- Fixed top bar (h-14) with hamburger menu, app name, and theme switcher
- Header selects (API Key / Provider / Model) hide labels and use narrower widths on mobile
- ThemeSwitcher moves to mobile top bar; hidden from the inner header on small screens

## Key Endpoints

### Authentication
- `POST /api/auth/login` - Login, returns `{ token, user: { id, name }, api_key }`
- `POST /api/auth/signup` - Create user, returns `{ token, user: { id, name }, api_key }`; returns 403 when `SIGNUPS_ENABLED=false`
- `POST /api/auth/logout` - No-op (client discards token)
- `GET /api/auth/session` - Validate JWT from Bearer header, returns user info
- `JWT_SECRET` env var (auto-generated if unset), `JWT_EXPIRY` env var (default `24h`)
- Token stored in `localStorage` by frontend, sent as `Authorization: Bearer <token>` on all requests
- `getAuthContext` checks JWT Bearer first (by `sub` = user.id), falls through to API key (`sk-*` + bcrypt)

### API Keys
- `GET /api/keys` - List keys (accepts `?group_id=` to scope to a group)
- `POST /api/keys` - Create key (accepts `group_id` in body for group-owned keys)
- `DELETE /api/keys/:id` - Delete key (owner or group member)

### Providers
- `GET /api/providers` - List providers (accepts `?group_id=` to scope to a group)
- `POST /api/providers` - Create provider (accepts `group_id` in body for group-owned providers)
- `PUT /api/providers/:id` - Update provider (owner or group member; cannot update immutable providers)
- `DELETE /api/providers/:id` - Delete provider (owner or group member; cannot delete immutable providers)

### Group Resources
- API keys and providers have an optional `group_id` field; null = user-owned, string = group-owned
- Group members can create/delete keys and providers for groups they belong to
- `isGroupMember(user, db, groupId)` helper checks membership (including wildcard `*`)
- `GET /api/usage` accepts `?group_id=` to scope usage to a group's keys

### BOOTSTRAP_ADMIN_EMAILS
- Comma-separated list of email addresses
- On login/signup, users matching these emails are added to the `global_admin` group with the `Global Admin` role (full `*` permissions)
- Admin users see group management in Settings (add/remove members, view/delete their resources)

### Provider Key Encryption
- Provider API keys (user-created, not the env-var default) are encrypted at rest using AES-256-GCM
- Key derived from `crypto.scryptSync(SECRET_KEY, userId, 32)` — binds to both server key and user
- Stored as `iv:authTag:ciphertext` hex format in `provider.api_key`
- Default (immutable) provider uses env var directly, not encrypted
- Frontend never receives the encrypted blob — stripped from GET /api/config response
- Decrypted only when forwarding upstream in `/api/chat/stream` and `/v1/chat/completions`
- `SECRET_KEY` rotation destroys all encrypted provider keys (users re-enter them)
- `SECRET_KEY` auto-generated in dev but MUST be set for production persistence

### Chat
- `POST /api/chat/stream` - SSE streaming endpoint (session auth)
- `POST /v1/chat/completions` - OpenAI-compatible non-streaming (Bearer auth)

### Rate Limiting
- Per-user-per-model in-memory sliding window (`RateLimiter` class in server.ts)
- Multiple concurrent windows supported (e.g. second + minute), configured via `rate_limits` string
- Format: `"limit:request:unit"` comma-separated (supports second, minute, hour, day)
- Enforced in both chat endpoints (429 on exceeded)
- Rejects only after ALL windows checked (two-pass: check all, then record all)
- Returns `rate_limit_windows` array in SSE done event, API response, and logs (replaces deprecated `rate_limit_remaining/limit/unit` fields)
- `rateLimitWindows` shown in frontend telemetry under `RL:` 
- `DEFAULT_PROVIDER_MODEL_RATE_LIMITS` env var (default `"10:request:minute,1:request:second"`)
- Provider form includes rate limits field; upserts into `model_pricing` on save

### Request Queue
- Per-provider-model in-memory FIFO concurrency queue (`RequestQueue` class in server.ts)
- `queue_max_size` stored in `model_pricing`, configurable per-provider, default 5
- Enforced in both chat endpoints: 1 request processes at a time, up to `maxSize-1` wait in queue
- Returns `queue_full` error type when queue at capacity (429)
- Per-request timeout of 2 minutes in the queue returns 504 Gateway Timeout (`queue_timeout`)
- Queue state logged as `queue: {size, limit}` in request start, response, queue-full, and queue-timeout events
- GC runs every 60s: purges pending items older than 10min (resolves with false → 504), removes empty queues
- `getQueueSize(key)` returns `processing + pending.length` for total in-flight/waiting count
- `DEFAULT_PROVIDER_MODEL_QUEUE_MAX_SIZE` env var (default `5`)
- Provider form includes "Queue Max Size" field (number input); upserts into `model_pricing` on save

### Usage
- `GET /api/usage` - List usage events for user's keys, joined with model_pricing for cost calculation

## Important Patterns

### API Key Creation Flow
1. User clicks "Create Key"
2. Server returns full key in response
3. Frontend shows modal with full key (only time it's visible)
4. User must copy key - it's not shown again
5. Subsequent loads show masked key: `sk-abc123********`

### Bearer Auth for API
- API keys use prefix + bcrypt hash
- Client sends `Authorization: Bearer $API_KEY`
- Server extracts prefix, looks up key, verifies hash with bcrypt

### Curl Sample Format
- `model` and `provider` fields now dynamically update from the top bar selections
- Provider uses the provider name (not ID)
- JSON body is formatted across multiple lines

### Code Sample Format
- API code samples on the Keys tab support format switching (curl, python)
- Uses `requestFormat` state in KeyManager, defaults to `curl`
- Format toggle buttons appear in the code block header bar next to the Copy button
- `codeSamples` object maps format key → sample string

## Logging
- All requests logged as JSON to stdout
- Fields: timestamp, source_ip, target_url, method, status_code, duration_ms, request_id, etc.
- Request IDs generated with `crypto.randomUUID()` and passed through to frontend
- General middleware logs every request (duration, status, etc.)
- Chat endpoints (`/api/chat/stream`, `/v1/chat/completions`) get 2 logs: a start log (request_id, provider_id, source, pricing) and an end log (tokens, costs, timing)
- Extra fields attached to middleware log via `res.locals.log` for endpoints that use `res.json()` (like `/v1/chat/completions`)
- SSE endpoint (`/api/chat/stream`) logs explicitly since middleware doesn't fire for SSE

## OAuth / OIDC SSO

### Supported Providers
- **Google**, **Microsoft**, **Okta**, **Auth0** — OIDC-based (require `METADATA_URL`)
- **GitHub** — non-OIDC (built-in endpoint URLs)

### Env Vars (all optional)
- `OAUTH_GOOGLE_CLIENT_ID`, `OAUTH_GOOGLE_CLIENT_SECRET`, `OAUTH_GOOGLE_METADATA_URL`
- `OAUTH_MICROSOFT_CLIENT_ID`, `OAUTH_MICROSOFT_CLIENT_SECRET`, `OAUTH_MICROSOFT_METADATA_URL`
- `OAUTH_GITHUB_CLIENT_ID`, `OAUTH_GITHUB_CLIENT_SECRET`
- `OAUTH_OKTA_CLIENT_ID`, `OAUTH_OKTA_CLIENT_SECRET`, `OAUTH_OKTA_METADATA_URL`
- `OAUTH_AUTH0_CLIENT_ID`, `OAUTH_AUTH0_CLIENT_SECRET`, `OAUTH_AUTH0_METADATA_URL`
- When a provider's three env vars are all set, a "Continue with {Name}" button appears on the login page
- `APP_URL` — used for redirect URIs; falls back to `req.protocol + req.get('host')`

### Flow
1. `/api/auth/oauth/config` — returns `{ oauth_enabled, providers: [{ id, name }] }` for the frontend
2. `/api/auth/oauth/authorize?provider=google` — fetches OIDC metadata (or uses static URLs for GitHub), generates CSRF state, stores in `oauthStates` Map (10min expiry), redirects to the provider's authorization endpoint
3. `/api/auth/oauth/callback` — exchanges code for token using the stored provider, fetches userinfo (GitHub also calls `/user/emails` for primary email), creates/finds user (no password), generates JWT, redirects to `/?token=<jwt>`

### User Schema
- OAuth users have `password_hash: ''` and `oauth_provider` set to the provider id (e.g. `'google'`, `'github'`) — they cannot log in with password; a specific error message directs them to the SSO button

## Gotchas
- React curly braces `{}` in JSX - use `{{}}` for object literals
- Modal placement matters - must be outside conditional tab renders
- API key is returned only on creation - after that it's hashed
- `/v1/chat/completions` is non-streaming only
- Duplicate key names are prevented per user (409 Conflict)
- `DEFAULT_PROVIDER_MODELS` env var renamed to `DEFAULT_PROVIDER_MODEL` (singular)
- New env vars: `DEFAULT_PROVIDER_MODEL_IN_PRICE_1M`, `DEFAULT_PROVIDER_MODEL_OUT_PRICE_1M` (default 0) for model cost tracking, `DEFAULT_PROVIDER_MODEL_QUEUE_MAX_SIZE` (default 5)
- `activeTab` persisted to localStorage (`app_active_tab`) so refreshes keep the current tab
- `thinking_content` saved separately in DB messages — on page reload, thinking is restored in its own section instead of being merged into the message content
- Queue dequeue must happen before response logs so `queue.size` reflects remaining items after this request
- Early returns after enqueue must explicitly dequeue (try/finally doesn't cover them)
- SSE endpoint dequeues on stream `[DONE]` event not in finally (finally ran right after headers arrived)
- `rate_limit_remaining/limit/unit` deprecated — use `rate_limit_windows` array instead
- `user.name` is the correct field for user identity (not `user.username`)
- `JWT_SECRET` auto-generated if unset — set for production persistence (session-less auth)
- JWT token stored in `localStorage` under `jwt_token` key; must be removed on logout/delete-account
- `getAuthContext` checks JWT by `sub` (user.id), not `name` — so user renames break auth until re-login
- `enqueue` returns `{ ok, reason }` not boolean — check `reason === 'timeout'` for 504 vs `reason === 'full'` for 429
- API keys and providers support an optional `group_id` field — null = user-owned, string = group-owned; group members can CRUD resources scoped to their groups
- `crypto.randomUUID()` and `navigator.clipboard.writeText()` require secure context (HTTPS/localhost). `genId()` and `copyToClipboard()` helpers provide fallbacks using `document.execCommand('copy')` for insecure HTTP
- Usage events store `group_id` from the API key used — `GET /api/usage?group_id=X` filters by group-owned key usage
