# Fairport UI

Yet another chat app.

## Usage

```
docker run -it --rm -p 8000:8000 \
  -e APP_NAME="fairport.io" \
  -e DEFAULT_PROVIDER_NAME="default" \
  -e DEFAULT_PROVIDER_URL="http://localhost:1234/v1" \
  -e DEFAULT_PROVIDER_MODEL="default" \
  -e DEFAULT_PROVIDER_API_KEY="sk-xxxx" \
  -e SECRET_KEY="$(openssl rand -hex 8)" \
  ghcr.io/fairport-io/apps/fairport-ui:0.0.1
```

## Highlights

### Auth

Local DB or OIDC integration.

<img width="1016" height="576" alt="image" src="https://github.com/user-attachments/assets/7931e63b-12f2-41b4-97c1-4f9bd9ea472b" />

### Chat Interface

See advanced telemetry (ttft, tokens/sec), and watch the model think in real time.

<img width="1016" height="576" alt="image" src="https://github.com/user-attachments/assets/041d5062-0855-4f20-a0e0-10e536dbe0c0" />

### API

Generate API Keys and use the app's /api endpoint to proxy requests between different models/providers.

<img width="1016" height="576" alt="image" src="https://github.com/user-attachments/assets/bf5acdff-2cb2-4add-8a02-0f48f48c9307" />

### Providers

Manage custom providers.

<img width="1016" height="576" alt="image" src="https://github.com/user-attachments/assets/959fddd4-0545-44d0-882f-4363aaebdf3c" />

### Usage

View usage and billing details.


<img width="1016" height="576" alt="image" src="https://github.com/user-attachments/assets/7e8753a5-4b58-4c49-b507-38eb60febc42" />

### Deployments

Manage deployments, and create a fleet of servers.

<img width="1016" height="576" alt="image" src="https://github.com/user-attachments/assets/9a6f3144-ae77-4356-b6f5-5e4df4e63a08" />

### Groups/Organization

Allow or deny users and groups access to models, providers, etc.

<img width="1016" height="576" alt="image" src="https://github.com/user-attachments/assets/73d41bbe-511b-4b99-b7e2-644c3054ceb2" />

### White-Label

Use custom colors and logos - configured via [Environment Variables](https://github.com/fairport-io/fairport-io/blob/main/apps/fairport-ui/README.md#environment-variables).

## Features

| Category | Feature |
|----------|---------|
| **Auth** | Login / Signup with JWT tokens (no session cookies) |
| **Auth** | Logout |
| **Auth** | Bearer token API key auth for OpenAI-compatible endpoint |
| **Auth** | bcrypt-hashed API keys with prefix lookup |
| **Auth** | Duplicate key name prevention (409) |
| **Keys** | Create / delete API keys (max 5 per user or per group, 32-char name limit) |
| **Keys** | Masked key display (`sk-abc123********`) |
| **Keys** | One-time full key reveal modal on creation with copy button |
| **Keys** | Active key selector in header bar (persisted to localStorage) |
| **Keys** | curl / Python code samples with copy button |
| **Providers** | CRUD for AI providers (name, base URL, models, rate limits, queue max size, optional API key) |
| **Providers** | Immutable default provider (cannot be edited / deleted) |
| **Providers** | Inline table editing with rate limits column |
| **Providers** | Active provider selector in header bar |
| **Chat** | SSE streaming chat |
| **Chat** | Client-side persistence (browser localStorage) via `CHAT_PERSISTENCE=client` — no server-side message storage |
| **Chat** | Server-side persistence (db.yaml) via `CHAT_PERSISTENCE=server` |
| **Chat** | Rich Markdown rendering (headings, code blocks, tables, lists, blockquotes) |
| **Chat** | Example prompt grid on empty state |
| **Chat** | Typing indicator |
| **Chat** | Clear chat with confirmation |
| **Chat** | 100K token input limit with warning banner |
| **Chat** | Expandable thinking / reasoning content (persisted across reload) |
| **Chat** | Message copy button |
| **Chat** | Auto-scroll on new content |
| **Telemetry** | Input / Output tokens per message |
| **Telemetry** | Tokens per second (TPS) |
| **Telemetry** | Time to first token (TTFT) |
| **Telemetry** | Response time (RT) |
| **Telemetry** | Request ID (truncated) |
| **Telemetry** | Context usage percentage |
| **Telemetry** | Toggleable via Settings |
| **Usage** | Usage events grouped by month |
| **Usage** | Monthly cost totals |
| **Usage** | Per-request detail table with costs |
| **Usage** | Auto-refresh on tab select |
| **RBAC** | Role-based access control with groups |
| **Groups** | Identity dropdown in header bar — switch between "User: &lt;email&gt;" and "Group: &lt;name&gt;" to scope all resources |
| **Groups** | Group detail in Settings (shown when a group identity is active): Add Member (exact email + plus icon), Members search (partial email + search icon), selected member panel with Remove from Group, Delete User, API Keys, Providers, and 3-month usage summary |
| **Groups** | Groups can own API keys and providers via `group_id` field; group members can create/delete them |
| **Groups** | Wildcard `[*]` member resolution — groups with `ids: ["*"]` show all users |
| **Admin** | `BOOTSTRAP_ADMIN_EMAILS` env var grants Global Admin role on login/signup |
| **Admin** | Admin user search, user deletion, resource management across all users |
| **Theme** | Light / Dark / System modes |
| **Theme** | Persisted to localStorage |
| **Mobile** | Slide-over sidebar drawer on screens < 768px |
| **Mobile** | Fixed top bar with hamburger menu |
| **Mobile** | Responsive header dropdowns |
| **Sidebar** | 6 tabs: Chat, API, Providers, Usage, Deployments, Settings |
| **Sidebar** | Active tab highlighting |
| **Settings** | Delete account with email confirmation |
| **Rate Limiting** | Per-user-per-model multi-window sliding window rate limiting (429 with key/provider/model/limit in message) |
| **Rate Limiting** | Rate limits configured via `model_pricing.rate_limits` (e.g. `"10:request:minute,1:request:second"`) |
| **Rate Limiting** | Validated on create/update (must match `limit:request:unit` pattern) |
| **Rate Limiting** | All windows shown in telemetry and logs via `rate_limit_windows` array |
| **Queue** | Per-provider-model FIFO concurrency queue (1 processes at a time, up to N waiting) |
| **Queue** | Queue max size configured via `model_pricing.queue_max_size` (default 5, env `DEFAULT_PROVIDER_MODEL_QUEUE_MAX_SIZE`) |
| **Queue** | `queue_full` error type on 429 when at capacity, `queue_timeout` on 504 after 2min wait |
| **Queue** | GC purges stale pending items after 10 minutes |
| **Settings** | Advanced telemetry toggle |
| **Settings** | Preferences persisted to localStorage |
| **API** | `POST /v1/chat/completions` (non-streaming, Bearer auth) |
| **API** | `POST /api/chat/stream` (SSE streaming, session auth) |
| **Logging** | JSON request logging to stdout |
| **Logging** | Request IDs via `crypto.randomUUID()` |
| **Logging** | Chat endpoints get start + end log entries |
| **UI** | User / assistant avatar differentiation |
| **UI** | ErrorBoundary with reload button |
| **UI** | Dynamic page title (`"{appName} - {tab}"`) |
| **UI** | Configurable app name via `APP_NAME` env var |

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | HTTP server port |
| `APP_NAME` | `Chat` | Application name (title, header, login page) |
| `SECRET_KEY` | auto-generated | Generate this for production!  Provider key encryption key (set for persistence across restarts; rotating destroys encrypted provider keys) |
| `JWT_SECRET` | auto-generated | JWT signing secret — set for production persistence (session-less auth) |
| `JWT_EXPIRY` | `24h` | JWT token expiry duration (e.g. `1h`, `7d`) |
| `DEFAULT_PROVIDER_NAME` | `default` | Name for the immutable default provider |
| `DEFAULT_PROVIDER_URL` | `http://localhost:1234/v1` | Base URL for the default provider |
| `DEFAULT_PROVIDER_MODEL` | `default` | Model name for the default provider |
| `DEFAULT_PROVIDER_MODEL_IN_PRICE_1M` | `0` | Input cost per 1M tokens for default model |
| `DEFAULT_PROVIDER_MODEL_OUT_PRICE_1M` | `0` | Output cost per 1M tokens for default model |
| `DEFAULT_PROVIDER_API_KEY` | `` | API key for the default provider |
| `NODE_ENV` | `production` | Set to `development` for HMR and source maps |
| `DISABLE_HMR` | `` | Set to `true` to disable Vite HMR in development |
| `GEMINI_API_KEY` | `` | Google Gemini API key for Gemini-specific features |
| `DEFAULT_PROVIDER_MODEL_RATE_LIMITS` | `10:request:minute,1:request:second` | Default rate limits per user per model (`limit:type:unit`, comma-separated for multiple windows) |
| `DEFAULT_PROVIDER_MODEL_QUEUE_MAX_SIZE` | `5` | Default max concurrent requests per provider-model (queue capacity before 429) |
| `OAUTH_GOOGLE_CLIENT_ID` | `` | Google OAuth client ID |
| `OAUTH_GOOGLE_CLIENT_SECRET` | `` | Google OAuth client secret |
| `OAUTH_GOOGLE_METADATA_URL` | `` | Google OIDC Discovery URL |
| `OAUTH_MICROSOFT_CLIENT_ID` | `` | Microsoft OAuth client ID |
| `OAUTH_MICROSOFT_CLIENT_SECRET` | `` | Microsoft OAuth client secret |
| `OAUTH_MICROSOFT_METADATA_URL` | `` | Microsoft OIDC Discovery URL |
| `OAUTH_GITHUB_CLIENT_ID` | `` | GitHub OAuth client ID (non-OIDC, no metadata URL needed) |
| `OAUTH_GITHUB_CLIENT_SECRET` | `` | GitHub OAuth client secret |
| `OAUTH_OKTA_CLIENT_ID` | `` | Okta OAuth client ID |
| `OAUTH_OKTA_CLIENT_SECRET` | `` | Okta OAuth client secret |
| `OAUTH_OKTA_METADATA_URL` | `` | Okta OIDC Discovery URL |
| `OAUTH_AUTH0_CLIENT_ID` | `` | Auth0 OAuth client ID |
| `OAUTH_AUTH0_CLIENT_SECRET` | `` | Auth0 OAuth client secret |
| `OAUTH_AUTH0_METADATA_URL` | `` | Auth0 OIDC Discovery URL |
| `CHAT_PERSISTENCE` | `client` | Message storage mode: `client` stores in browser localStorage, `server` stores in `db.yaml` |
| `APP_URL` | `` | Public URL of the app (used for OAuth redirect URIs; auto-detected if behind proxy) |
| `SIGNUPS_ENABLED` | `true` | Set to `false` to disable new user registration (login unaffected) |
| `BOOTSTRAP_ADMIN_EMAILS` | `` | Comma-separated emails granted Global Admin role on login/signup (full `*` permissions) |
| `TRUST_PROXY` | `` | Set to `1` (or a number/string) to enable reverse-proxy IP trust for correct client IP detection |
| `AUTH_RATE_LIMIT_MAX` | `10` | Max failed auth attempts per IP before rate limiting kicks in |
| `AUTH_RATE_LIMIT_WINDOW_MS` | `900000` (15 min) | Auth rate limit sliding window in milliseconds |
| `DATABASE_TYPE` | `yaml` | Database backend: `yaml` (file-based), `pglite` (embedded WASM), or `postgres` (full PostgreSQL) |
| `PGHOST` | `` | PostgreSQL host (required when `DATABASE_TYPE=postgres`) |
| `PGPORT` | `5432` | PostgreSQL port |
| `PGDATABASE` | `fairport-ui` | PostgreSQL database name |
| `PGUSER` | `` | PostgreSQL user (required when `DATABASE_TYPE=postgres`) |
| `PGPASSWORD` | `` | PostgreSQL password (required when `DATABASE_TYPE=postgres`) |

## Database

The app supports three database backends via the `DATABASE_TYPE` env var:

### `yaml` (default)
Stores all data in a single `db.yaml` file at the app root. No dependencies required. Simple file-based persistence — the entire dataset is read on each request and written back on mutations. Suitable for single-user or development use.

### `pglite`
Uses [PGlite](https://github.com/electric-sql/pglite), an embedded PostgreSQL engine compiled to WASM. Runs in-process with no external services. Data is persisted to a `pglite-data/` directory. Tables (mirroring the YAML collections) are created automatically on first access. Enable with:

```
DATABASE_TYPE=pglite
```

### `postgres`
Connects to an external PostgreSQL server via the `pg` package. The database and tables are created automatically on first connection (no manual schema setup required). `PGHOST`, `PGUSER`, and `PGPASSWORD` are required:

```
DATABASE_TYPE=postgres PGHOST=db.example.com PGUSER=myuser PGPASSWORD=mypass
```

Optional vars: `PGPORT` (default `5432`), `PGDATABASE` (default `fairport-ui`).

### Schema

All backends share the same schema: `users`, `api_keys`, `roles`, `groups_table`, `models`, `messages`, `providers`, `model_pricing`, `usage_events`. Complex fields (permissions, members) are stored as JSON (`TEXT` in PGlite, `JSONB` in PostgreSQL).

## RBAC Schema

```yaml
users:
  - id: "user-id-123e4567-e89b-12d3-a456-426614174000"
    name: "user@example.com"
    password_hash: "$ABC123"

api_keys:
  - id: "key-id-123e4567-e89b-12d3-a456-426614174009"
    name: "default"
    owner_id: "user-id-123e4567-e89b-12d3-a456-426614174000"
    group_id: null
    key_prefix: "sk-12345678"
    key_hash: "$ABC123"
    created_at: 1778040101
    expires_at: 1780000000
    last_used_at: 1778050000

roles:
  - id: "role-id-default"
    name: "Default Base"
    permissions:
      - verbs:[ "use" ]
        resources: [ "models" ]
        resource_names_regex: [ ".*" ]

  - id: "role-id-global-admin"
    name: "Global Admin"
    permissions:
      - verbs: [ "*" ]
        resources: [ "*" ]
        resource_names_regex: [ ".*" ]

groups:
  - id: "default"
    name: "default"
    api_keys: []
    members:
      - ids: [ "*" ]
        role_ids: [ "role-id-default" ]

  - id: "global_admin"
    name: "Global Admin"
    api_keys: []
    members:
      - ids: [ "*" ]
        role_ids: [ "role-id-default" ]

  - id: "group-id-123e4567-e89b-12d3-a456-426614174002"
    name: "Example Organization"
    api_keys: []
    members:
      - ids:[ "user-id-123e4567-e89b-12d3-a456-426614174000" ]
        role_ids:[ "role-id-default-group-admin" ]

models:
  - id: "model-id-default"
    name: "default"
    base_url: "http://localhost:1234/v1"
    owner_id: null
    visibility: "public"

  - id: "model-id-123e4567-e89b-12d3-a456-426614174007"
    name: "user@example.com/llama3-8b"
    base_url: "http://localhost:1234/v1"
    owner_id: "user-id-123e4567-e89b-12d3-a456-426614174000"
    visibility: "private"

providers:
  - id: "provider-id-default"
    name: "default"
    base_url: "http://localhost:1234/v1"
    models: "default"
    api_key: "sk-xxxx"
    owner_id: null
    visibility: "public"
    immutable: true

  - id: "provider-id-123e4567-e89b-12d3-a456-426614174008"
    name: "Ollama Local"
    base_url: "http://localhost:11434/v1"
    models: "llama3.2,mistral,nomic-embed-text"
    api_key: ""
    owner_id: "user-id-123e4567-e89b-12d3-a456-426614174000"
    group_id: null
    visibility: "private"
    immutable: false

model_pricing:
  - model_id: "model-id-default"
    input_cost_per_1m_tokens: 0
    output_cost_per_1m_tokens: 0
    rate_limits: "10:request:minute,1:request:second"
    queue_max_size: 5

usage_events:
  - id: "usage-event-id-123e4567-e89b-12d3-a456-426614174003"
    api_key_id: "key-id-123e4567-e89b-12d3-a456-426614174009"
    model_id: "model-id-123e4567-e89b-12d3-a456-426614174007"
    provider_id: "provider-id-123e4567-e89b-12d3-a456-426614174008"
    user_id: "user-id-123e4567-e89b-12d3-a456-426614174000"
    group_id: "group-id-123e4567-e89b-12d3-a456-426614174002"
    timestamp: 1778050000
    input_tokens: 10
    output_tokens: 20
```

## Tests
[TESTS.md](TESTS.md)

## TODO
[TODO.md](TODO.md)
