## Objective
Pass unrecognized chat-completion JSON parameters through Fairport to the configured upstream provider for both API and UI streaming requests, with per-chat Extra Parameters controls in the Chat UI.

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

### Extra Parameters UI
- [x] Add an `Extra Parameters` control to the Chat page with an active parameter count
- [x] Open a responsive modal for adding and removing key/value rows
- [x] Parse values as JSON so numbers, booleans, arrays, objects, and strings keep their types
- [x] Reject empty keys, invalid JSON values, duplicate keys, and reserved Fairport fields
- [x] Apply saved parameters to every subsequent UI chat request
- [x] Keep `messages`, `model`, `stream`, `provider`, and `provider_id` unavailable as extra parameter keys
- [x] Persist parameters for the current per-user chat across refreshes
- [x] Clear parameters with Clear History and logout so they do not outlive the chat session
- [x] Match existing light/dark styling and remain usable on mobile and desktop

### Tests
- [x] Add regression coverage for passthrough parameters on both endpoints
- [x] Verify Fairport-only fields are not forwarded
- [x] Verify server-controlled fields cannot be overridden by passthrough input
- [x] Cover Extra Parameters modal validation and typed request payloads
- [x] Cover refresh persistence and Clear History cleanup
- [x] Cover the responsive modal layout on a mobile viewport

### Verification
- [x] `make build` passes
- [ ] `make test` passes
- [x] Run `git diff origin/main` and verify the changeset matches this spec
- [x] Update relevant `.md` files for the next agent
- [x] Check this file again to ensure all requirements are met

## Agent Plan
1. Reuse the existing per-user chat-history lifecycle for Extra Parameters persistence and cleanup.
2. Add the smallest responsive modal using the current component styling and accessible labels.
3. Validate draft rows on Save and store parsed JSON values for subsequent chat requests.
4. Spread saved parameters into the UI request before Fairport-controlled fields.
5. Add focused Playwright coverage for validation, typed payloads, refresh/clear behavior, and mobile layout.
6. Update relevant documentation, run `make build` and `make test`, and review `git diff origin/main`.

## Agent Implementation Details
- Added shared `buildProviderChatBody()` handling for both chat endpoints. It removes Fairport-only provider selectors, preserves all other top-level fields, and applies server-controlled values last.
- Extended `tests/server/chat-stream.test.ts` with endpoint-level coverage for nested passthrough values, stripped selectors, and authoritative `model`, `messages`, and `stream` values.
- Added an accessible, responsive `Extra Parameters` modal to the Chat page with an active-count trigger and existing light/dark visual patterns.
- Extra values are JSON-parsed, validated against duplicates and reserved fields, stored per user alongside the current chat lifecycle, and applied to subsequent UI requests before controlled request fields.
- Added Playwright coverage for validation, typed forwarding, refresh persistence, Clear History cleanup, and a 375x667 mobile viewport.
- `make build` passes and all 79 Vitest server tests pass.
- The new Playwright test passes. Full `make test` remains blocked by the pre-existing key-deletion test: its locator resolves to three Delete buttons in strict mode (now at `tests/e2e/app.spec.ts:191` after the new coverage).
