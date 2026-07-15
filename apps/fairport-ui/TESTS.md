# tests

Definitions
| Key | Value |
|-----|-------|
| ✅  | Test is written and working |
| ❌  | Test is broken/flaky/skipped |
| -   | Not implemented |
| pw  | test uses playwright |
| vi  | test uses vitest |

## /login
| State | Suite | Endpoint | Method | Test |
|-------|-------|----------|--------|------|
| -     |       | /login   | -    | bypass login not possible |
| ✅    | pw    | /login   | -    | renders email/password fields — login.spec.ts |
| ✅    | pw    | /login   | -    | error on invalid login — login.spec.ts |
| ✅    | pw    | /login   | -    | redirects to /chat on success — login.spec.ts |
| ❌    | pw    | /login   | -    | pressing Enter triggers login (flaky, skipped) |
| -     | pw    | /login   | -    | OAuth buttons shown when configured |

## POST /api/auth/signup
| State | Suite | Endpoint           | Method | Test |
|-------|-------|--------------------|--------|------|
| ✅    | vi    | /api/auth/signup   | POST   | valid email + password >= 8 creates user — auth.test.ts |
| ✅    | vi    | /api/auth/signup   | POST   | duplicate username returns 409 — auth.test.ts |
| ✅    | vi    | /api/auth/signup   | POST   | password < 8 returns 400 — auth.test.ts |
| ✅    | vi    | /api/auth/signup   | POST   | missing fields returns 400 — auth.test.ts |
| ✅    | vi    | /api/auth/signup   | POST   | returns JWT + user + api_key — auth.test.ts |
| ✅    | pw    | /api/auth/signup   | POST   | redirects to /chat on success — login.spec.ts |
| ✅    | pw    | /api/auth/signup   | POST   | duplicate signup shows error — login.spec.ts |
| ✅    | pw    | /api/auth/signup   | POST   | short password rejected — login.spec.ts |
| -     |       | /api/auth/signup   | POST   | bad email format rejected |

## GET /api/auth/session
| State | Suite | Endpoint          | Method | Test |
|-------|-------|-------------------|--------|------|
| ✅    | vi    | /api/auth/session | GET    | valid JWT returns user info — auth.test.ts |
| ✅    | vi    | /api/auth/session | GET    | invalid/expired JWT returns logged_in: false — auth.test.ts |
| ✅    | vi    | /api/auth/session | GET    | no token returns logged_in: false — auth.test.ts |

## POST /api/auth/logout
| State | Suite | Endpoint         | Method | Test |
|-------|-------|------------------|--------|------|
| ✅    | vi    | /api/auth/logout | POST   | returns success status — auth.test.ts |
| ✅    | pw    | /api/auth/logout | POST   | clears session — login.spec.ts |

## DELETE /api/auth/account
| State | Suite | Endpoint           | Method | Test |
|-------|-------|--------------------|--------|------|
| ✅    | vi    | /api/auth/account  | DELETE | deletes user + all associated data — auth.test.ts |
| ✅    | vi    | /api/auth/account  | DELETE | requires valid auth — auth.test.ts |

## OAuth
| State | Suite | Endpoint                      | Method | Test |
|-------|-------|-------------------------------|--------|------|
| -     |       | /api/auth/oauth/config        | GET    | returns enabled providers |
| -     |       | /api/auth/oauth/authorize     | GET    | redirects to provider with state |
| -     |       | /api/auth/oauth/callback      | GET    | exchanges code, creates user, redirects with token |
| -     |       | /api/auth/oauth/callback      | GET    | invalid state rejected |
| -     |       | /api/auth/oauth/callback      | GET    | missing code rejected |
| -     |       | /api/auth/oauth/callback      | GET    | OAuth user cannot login with password |

## /chat
| State | Suite | Endpoint | Method | Test |
|-------|-------|----------|--------|------|
| ✅    | pw    | /chat    | -    | empty state shows example prompts — app.spec.ts |
| ✅    | pw    | /chat    | -    | clicking example prompt fills input — app.spec.ts |
| ✅    | pw    | /chat    | -    | send message and show typing indicator — app.spec.ts |
| ✅    | pw    | /chat    | -    | clear chat with confirmation — app.spec.ts |
| ✅    | pw    | /chat    | -    | sidebar tabs navigate and update URL — app.spec.ts |
| ✅    | pw    | /chat    | -    | active tab persists across refresh — app.spec.ts |
| -     |       | /chat    | -    | chat history stored per-user in localStorage |
| -     |       | /chat    | -    | ErrorBoundary catches and shows reload button |

## POST /api/chat/stream
| State | Suite | Endpoint          | Method | Test |
|-------|-------|-------------------|--------|------|
| -     |       | /api/chat/stream  | POST   | requires valid auth + API key |
| ✅    | vi    | /api/chat/stream  | POST   | forwards to provider and streams split SSE response chunks — chat-stream.test.ts |
| ✅    | vi    | /api/chat/stream  | POST   | passes through nested parameters, strips provider selectors, and controls model/messages/stream — chat-stream.test.ts |
| -     |       | /api/chat/stream  | POST   | thinking/reasoning content streamed separately |
| -     |       | /api/chat/stream  | POST   | TTFT tracked on first token |
| -     |       | /api/chat/stream  | POST   | input token limit enforced (400) |
| -     |       | /api/chat/stream  | POST   | permission check on provider |
| -     |       | /api/chat/stream  | POST   | usage event recorded on completion |
| -     |       | /api/chat/stream  | POST   | server persistence saves messages |

## POST /v1/chat/completions
| State | Suite | Endpoint                | Method | Test |
|-------|-------|-------------------------|--------|------|
| -     |       | /v1/chat/completions    | POST   | requires Bearer API key auth |
| ✅    | vi    | /v1/chat/completions    | POST   | passes through nested parameters, strips provider selectors, and controls model/messages/stream — chat-stream.test.ts |
| -     |       | /v1/chat/completions    | POST   | non-streaming only (stream=true returns 400) |
| -     |       | /v1/chat/completions    | POST   | returns OpenAI-format response |
| -     |       | /v1/chat/completions    | POST   | usage event recorded |

## /api
| State | Suite | Endpoint    | Method | Test |
|-------|-------|-------------|--------|------|
| ✅    | pw    | /api        | -    | shows registered keys in table — app.spec.ts |
| ✅    | pw    | /api        | -    | creates new key and shows one-time modal — app.spec.ts |
| ❌    | pw    | /api        | -    | deletes a key (flaky, skipped) |
| ❌    | pw    | /api        | -    | enforces max 5 keys (flaky, skipped) |
| ❌    | pw    | /providers  | -    | creates a new provider (flaky, skipped) |
| -     | pw    | /providers  | -    | immutable provider cannot be edited/deleted |

## /api/providers
| State | Suite | Endpoint            | Method | Test |
|-------|-------|---------------------|--------|------|
| ✅    | vi    | /api/providers      | POST   | creates with name + base_url — providers.test.ts |
| ✅    | vi    | /api/providers      | POST   | missing name/base_url returns 400 — providers.test.ts |
| ✅    | vi    | /api/providers      | POST   | invalid rate_limits format returns 400 — providers.test.ts |
| ✅    | vi    | /api/providers      | POST   | invalid queue_max_size returns 400 — providers.test.ts |
| ✅    | vi    | /api/providers      | POST   | duplicate name per user returns 409 — providers.test.ts |
| -     |       | /api/providers      | POST   | duplicate name per group returns 409 |
| -     |       | /api/providers      | POST   | API key encrypted at rest |
| ✅    | vi    | /api/providers      | GET    | returns public + user-owned — providers.test.ts |
| ✅    | vi    | /api/providers      | GET    | rate_limits + queue_max_size from model_pricing — providers.test.ts |
| -     |       | /api/providers      | GET    | returns group providers when group_id provided |
| ✅    | vi    | /api/providers/:id  | PUT    | owner can update — providers.test.ts |
| ✅    | vi    | /api/providers/:id  | PUT    | immutable provider returns 403 — providers.test.ts |
| -     |       | /api/providers/:id  | PUT    | group member can update group provider |
| -     |       | /api/providers/:id  | PUT    | non-owner returns 403 |
| -     |       | /api/providers/:id  | PUT    | rate_limits + queue_max_size upsert into model_pricing |
| ✅    | vi    | /api/providers/:id  | DELETE | owner can delete — providers.test.ts |
| ✅    | vi    | /api/providers/:id  | DELETE | immutable provider returns 403 — providers.test.ts |
| -     |       | /api/providers/:id  | DELETE | group member can delete group provider |
| -     |       | /api/providers/:id  | DELETE | non-owner returns 403 |

## /usage
| State | Suite | Endpoint | Method | Test |
|-------|-------|----------|--------|------|
| -     |       | /usage   | -    | monthly grouping + cost totals |

## /api/usage
| State | Suite | Endpoint    | Method | Test |
|-------|-------|-------------|--------|------|
| -     |       | /api/usage  | GET    | returns usage events for user's keys |
| -     |       | /api/usage  | GET    | joins with model_pricing for cost calculation |
| -     |       | /api/usage  | GET    | group-scoped when group_id provided |
| -     |       | /api/usage  | GET    | sorted newest first |

## /settings
| State | Suite | Endpoint   | Method | Test |
|-------|-------|------------|--------|------|
| ✅    | pw    | /settings  | -    | delete account requires email confirmation — app.spec.ts |
| -     |       | /settings  | -    | preferences persist to localStorage |
| ❌    |       | /settings  | -    | theme light/dark/system toggle + persistence (e2e skipped) |

## /deployments
| State | Suite | Endpoint      | Method | Test |
|-------|-------|---------------|--------|------|
| -     |       | /deployments  | -    | create/edit/delete (max 5) |

## /identity (header)
| State | Suite | Endpoint   | Method | Test |
|-------|-------|------------|--------|------|
| -     |       | (header)   | -    | dropdown switches between user and group |
| -     |       | (header)   | -    | API key, provider, model selects |

## /api/messages
| State | Suite | Endpoint       | Method | Test |
|-------|-------|----------------|--------|------|
| -     |       | /api/messages  | GET    | returns [] when CHAT_PERSISTENCE=client |
| -     |       | /api/messages  | GET    | returns user messages when CHAT_PERSISTENCE=server |
| -     |       | /api/messages  | DELETE | clears user messages (server mode) |
| -     |       | /api/messages  | DELETE | returns success in client mode (no-op) |

## /api/config
| State | Suite | Endpoint     | Method | Test |
|-------|-------|--------------|--------|------|
| -     |       | /api/config  | GET    | returns app config + providers without api_keys |
| -     |       | /api/config  | GET    | provider api_key stripped from response |

## /api/groups
| State | Suite | Endpoint                          | Method | Test |
|-------|-------|-----------------------------------|--------|------|
| -     |       | /api/groups                       | GET    | returns groups user is a member of |
| -     |       | /api/groups                       | GET    | is_admin flag for global_admin members |
| -     |       | /api/groups/:slug                 | GET    | admin-only access |
| -     |       | /api/groups/:slug                 | GET    | wildcard [*] groups return all users |
| -     |       | /api/groups/:slug                 | GET    | returns members list |
| -     |       | /api/groups/:slug/members         | POST   | admin-only |
| -     |       | /api/groups/:slug/members         | POST   | user must exist |
| -     |       | /api/groups/:slug/members         | POST   | already-member is idempotent |
| -     |       | /api/groups/:slug/members/:id     | DELETE | admin-only, removes from group |
| -     |       | /api/groups/:slug/members/search  | GET    | filters by email query |
| -     |       | /api/groups/:slug/members/search  | GET    | wildcard groups search all users |

## /api/admin/users
| State | Suite | Endpoint                               | Method | Test |
|-------|-------|----------------------------------------|--------|------|
| -     |       | /api/admin/users                       | GET    | admin-only, filters by email |
| -     |       | /api/admin/users/:userId               | GET    | returns user's keys, providers, groups |
| -     |       | /api/admin/users/:userId               | DELETE | admin-only, cannot delete yourself |
| -     |       | /api/admin/users/:userId               | DELETE | cascades: keys, providers, messages, usage |
| -     |       | /api/admin/users/:userId/keys/:keyId   | DELETE | admin-only, key must belong to user |
| -     |       | /api/admin/users/:userId/providers/:id | DELETE | admin-only, provider must belong to user |
| -     |       | /api/admin/users/:userId/groups/:slug  | DELETE | admin-only, remove from group |
| -     |       | /api/admin/users/:userId/usage         | GET    | admin-only, returns usage for user's keys |

## RateLimiter
| State | Suite | Endpoint     | Method | Test |
|-------|-------|--------------|--------|------|
| ✅    | vi    | (internal)   | -    | sliding window per user per model — rate-limiter.test.ts |
| ✅    | vi    | (internal)   | -    | multiple windows (second + minute) — rate-limiter.test.ts |
| ✅    | vi    | (internal)   | -    | two-pass: check all, then record all — rate-limiter.test.ts |
| ✅    | vi    | (internal)   | -    | returns rate_limit_windows array — rate-limiter.test.ts |
| ✅    | vi    | (internal)   | -    | 429 when any window exceeded — rate-limiter.test.ts |

## RequestQueue
| State | Suite | Endpoint     | Method | Test |
|-------|-------|--------------|--------|------|
| ✅    | vi    | (internal)   | -    | FIFO per provider:model — request-queue.test.ts |
| ✅    | vi    | (internal)   | -    | first request processes immediately — request-queue.test.ts |
| ✅    | vi    | (internal)   | -    | subsequent requests wait in pending — request-queue.test.ts |
| ✅    | vi    | (internal)   | -    | returns {ok, reason} — 'full' or 'timeout' — request-queue.test.ts |
| ✅    | vi    | (internal)   | -    | GC purges items older than 10 minutes — request-queue.test.ts |
| ✅    | vi    | (internal)   | -    | empty queues deleted — request-queue.test.ts |
| ✅    | vi    | (internal)   | -    | getQueueSize returns processing + pending — request-queue.test.ts |

## Encryption
| State | Suite | Endpoint     | Method | Test |
|-------|-------|--------------|--------|------|
| ✅    | vi    | (internal)   | -    | encryptProviderKey: AES-256-GCM, key from SECRET_KEY + userId — encryption.test.ts |
| ✅    | vi    | (internal)   | -    | decryptProviderKey: reverses encryption — encryption.test.ts |
| ✅    | vi    | (internal)   | -    | immutable provider key not encrypted — encryption.test.ts |
| ✅    | vi    | (internal)   | -    | empty key returns empty string — encryption.test.ts |

## RBAC
| State | Suite | Endpoint     | Method | Test |
|-------|-------|--------------|--------|------|
| ✅    | vi    | (internal)   | -    | hasPermission: verb + resource + name regex match — rbac.test.ts |
| ✅    | vi    | (internal)   | -    | wildcard verb "*" matches all — rbac.test.ts |
| ✅    | vi    | (internal)   | -    | wildcard resource "*" matches all — rbac.test.ts |
| ✅    | vi    | (internal)   | -    | wildcard member ids ["*"] matches all users — rbac.test.ts |
| ✅    | vi    | (internal)   | -    | global admin has full permissions — rbac.test.ts |
