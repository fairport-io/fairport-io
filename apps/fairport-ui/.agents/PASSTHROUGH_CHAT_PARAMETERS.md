## Objective
Pass unrecognized chat-completion JSON parameters through Fairport to the configured upstream provider for both API and UI streaming requests.

## Requirements
### Setup
- [x] Confirm this spec is in `apps/fairport-ui/.agents/`
- [x] Read this spec fully before writing application code
- [x] Survey component: `tree -a -L 3 -I '.git|node_modules|vendor|__pycache__|dist|build'` (`tree` unavailable; used depth-limited `find`)
- [x] Find app files: `find . -name "*.ts" -o -name "*.tsx"`
- [x] Read `README.md`
- [x] Check for local `AGENTS.md` or `README.md` in the component directory
- [x] Create branch: `git checkout -b agent/passthrough-chat-parameters origin/main`

### Implementation
- [x] Preserve unrecognized top-level JSON fields when forwarding `/v1/chat/completions` requests upstream
- [x] Preserve unrecognized top-level JSON fields when forwarding `/api/chat/stream` requests upstream
- [x] Strip Fairport-only provider-selection fields before forwarding
- [x] Keep existing provider-selection behavior unchanged
- [x] Keep Fairport authoritative for `model`, `messages`, and `stream`
- [x] Preserve nested values without transformation

### Tests
- [x] Add regression coverage for passthrough parameters on both endpoints
- [x] Verify Fairport-only fields are not forwarded
- [x] Verify server-controlled fields cannot be overridden by passthrough input

### Verification
- [x] `make build` passes
- [ ] `make test` passes
- [x] Run `git diff origin/main` and verify the changeset matches this spec
- [x] Update relevant `.md` files for the next agent
- [x] Check this file again to ensure all requirements are met

## Agent Plan
1. Trace both chat endpoints and their existing upstream request tests.
2. Introduce the smallest shared request-body transformation that removes Fairport-only fields and applies server-controlled values last.
3. Use the shared transformation in both streaming and non-streaming endpoints without changing provider selection.
4. Add focused regression coverage for unknown, nested, stripped, and server-controlled fields.
5. Run `make build`, `make test`, and review `git diff origin/main`.

## Agent Implementation Details
- Added shared `buildProviderChatBody()` handling for both chat endpoints. It removes Fairport-only provider selectors, preserves all other top-level fields, and applies server-controlled values last.
- Extended `tests/server/chat-stream.test.ts` with endpoint-level coverage for nested passthrough values, stripped selectors, and authoritative `model`, `messages`, and `stream` values.
- `make build` passes and all 79 Vitest server tests pass.
- Full `make test` remains blocked by the pre-existing Playwright failure in `tests/e2e/app.spec.ts:119`: the key-deletion locator resolves to three Delete buttons in strict mode.
