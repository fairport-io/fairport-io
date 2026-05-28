## Objective
Add an environment variable `SIGNUPS_ENABLED` that will enable/disable new users from signing up without affecting login capabilities for existing users.

## Requirements
### Setup
- [x] Fetch latest: `git fetch origin`
- [x] Read root AGENTS.md: `cat "$(git rev-parse --show-toplevel)/AGENTS.md"`
- [x] Create branch: `git checkout -b agent/signups-enabled origin/main`
- [x] Survey component: read README.md and relevant source files

### Implementation
- [x] Added `SIGNUPS_ENABLED` env var (default `true`) in `server.ts` config block
- [x] Added 403 early-return in signup handler when `SIGNUPS_ENABLED` is `false`
- [x] Exposed `signups_enabled` in `GET /api/config` response
- [x] Frontend shows greyed-out "New Signups Disabled" button instead of "Create New Account" when signups disabled

### Tests
- [x] Written 2 tests in `tests/server/auth.test.ts`: signup returns 403, `/api/config` returns `signups_enabled: false`
- [x] All auth tests pass (4 pre-existing failures in providers.test.ts are unrelated)

### Verification
- [x] `make build` passes
- [x] Run `git diff origin/main` and verify the changeset matches this spec (branch diverged from origin/main, verified manually)
- [x] Check this file again to ensure you met all requirements.
- [x] Updated AGENTS.md with `SIGNUPS_ENABLED` in new env vars section and signup endpoint docs
- [x] Updated README.md with `SIGNUPS_ENABLED` in env vars table
- [x] All boxes checked — task complete.

## Agent Plan

1. Add `SIGNUPS_ENABLED` env var (default `true`) to the config block in `server.ts`
2. Add early-return 403 in the signup handler if `SIGNUPS_ENABLED` is `false`
3. Include `signups_enabled` in the `/api/config` GET response so the frontend can read it
4. Conditionally hide the "Create New Account" button in the login view when `signups_enabled` is false
5. Update `.env.example` and `AGENTS.md`
6. Run `make build` to verify

## Agent Implementation Details

- `SIGNUPS_ENABLED` defaults to `true` (backwards compatible)
- Server denies signup with 403 `{"detail": "Signups are disabled."}` when env var is `false`
- Frontend fetches config on login page mount and hides the signup button when disabled
- Env var documented in `.env.example` and `AGENTS.md`

