# Switch from Session to JWT Authentication

## Goal
Replace `express-session` cookie-based sessions with JWT tokens so auth works across multiple processes/servers.

## Requirements
- Login/signup return a JWT access token instead of setting a session cookie
- All API endpoints validate JWT from `Authorization: Bearer <token>` header
- UI stores token in `localStorage` and sends it on every request
- OAuth flow also returns a JWT instead of setting a session cookie
- Remove `express-session` dependency
- `getAuthContext` reads JWT instead of session
- Backwards compatible: API key auth (Bearer with `sk-*`) still works unchanged

## Token Structure
```json
{
  "sub": "<user-id>",
  "name": "<username>",
  "iat": <issued-at>,
  "exp": <expiry>
}
```

## Env Vars
- `JWT_SECRET` — JWT signing secret (auto-generated if not set)
- `JWT_EXPIRY` — Token expiry duration (default `24h`)

## Changes Made

### server.ts
- Removed `express-session` import and middleware
- Added `jsonwebtoken` import
- Added `JWT_SECRET` and `JWT_EXPIRY` config vars
- Added `signJwt(user)` helper — signs `{ sub: user.id, name: user.name }` with expiry
- Added `verifyJwtToken(token)` helper — verifies and returns payload or null
- Added in-memory `oauthStates` Map (replaces session-based OAuth CSRF state)
- Rewrote `getAuthContext`: checks JWT Bearer first (validates token via `verifyJwtToken`, finds user by `sub`), falls through to API key Bearer (`sk-*` prefix + bcrypt)
- `POST /api/auth/login` — returns `{ token, user: { id, name }, api_key }`
- `POST /api/auth/signup` — returns `{ token, user: { id, name }, api_key }`
- `POST /api/auth/logout` — no-op (returns `{ status: "success" }`)
- `GET /api/auth/session` — validates JWT from Bearer header, returns `{ logged_in, username, user }` or `{ logged_in: false }`
- `DELETE /api/auth/account` — no session destroy, returns `{ status: "success" }`
- OAuth authorize — stores CSRF state in `oauthStates` Map (10min expiry)
- OAuth callback — reads state from `oauthStates` Map, redirects to `/?token=<jwt>`

### src/App.tsx
- Added `token` state (initialized from `localStorage.getItem('jwt_token')`)
- Added `authHeaders()` helper — returns `{ Authorization: 'Bearer <token>' }` if token exists
- All authenticated fetch calls now include `...authHeaders()` in their headers
- `handleAuth` — stores `data.token` in localStorage + state on success
- `logout` — removes token from localStorage + clears state
- `checkSession` — sends JWT in Bearer header, clears token on invalid response
- `useEffect` — checks URL for `?token=` param (OAuth redirect), stores it, cleans URL with `history.replaceState`
- Config/oauth-config fetches remain unauthenticated (public)
