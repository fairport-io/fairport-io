## Objective
Pass chat-completion parameters through Fairport to the configured upstream provider, including OpenAI-compatible SSE streaming from `/v1/chat/completions`, with per-chat Extra Parameters controls in the Chat UI.

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

### OpenAI-Compatible API Streaming
- [x] Accept the strict boolean `stream: true` on `/v1/chat/completions`
- [x] Forward `stream: true` and other passthrough fields to the selected provider
- [x] Relay upstream SSE bytes without applying the Chat UI event transformation
- [x] Preserve the existing JSON response path when `stream` is false, omitted, or not the boolean `true`
- [x] Release the request queue on `[DONE]`, upstream end/error, and client disconnect
- [x] Preserve API usage recording and completion logging for successful streams

### Tests
- [x] Add regression coverage for passthrough parameters on both endpoints
- [x] Verify Fairport-only fields are not forwarded
- [x] Verify server-controlled fields cannot be overridden by passthrough input
- [x] Cover Extra Parameters modal validation and typed request payloads
- [x] Cover refresh persistence and Clear History cleanup
- [x] Cover the responsive modal layout on a mobile viewport
- [x] Cover OpenAI-compatible SSE passthrough and authoritative streaming fields
- [x] Cover split SSE chunks and queue cleanup after a completed API stream
- [x] Keep non-streaming API regression coverage passing

### Streaming Extension Verification
- [x] `make build` passes after the streaming extension
- [x] `make test` passes after the streaming extension
- [x] Review `git diff origin/main` for streaming-extension scope
- [x] Update relevant `.md` files for the next agent

### Verification
- [x] `make build` passes
- [x] `make test` passes
- [x] Run `git diff origin/main` and verify the changeset matches this spec
- [x] Update relevant `.md` files for the next agent
- [x] Check this file again to ensure all requirements are met

## Agent Plan
1. Reuse the existing `/v1/chat/completions` authentication, provider selection, rate limit, queue, logging, and usage flow.
2. Add a strict `stream === true` branch that forwards provider SSE bytes unchanged while parsing a copy for usage accounting.
3. Make stream finalization idempotent across `[DONE]`, end, error, and client disconnect so the queue is always released once.
4. Add focused server tests for passthrough fields, split SSE chunks, and the unchanged non-streaming path.
5. Update documentation, run `make build` and `make test`, and review `git diff origin/main`.

## Agent Implementation Details
- Added shared `buildProviderChatBody()` handling for both chat endpoints. It removes Fairport-only provider selectors, preserves all other top-level fields, and applies server-controlled values last.
- Extended `tests/server/chat-stream.test.ts` with endpoint-level coverage for nested passthrough values, stripped selectors, and authoritative `model`, `messages`, and `stream` values.
- Added an accessible, responsive `Extra Parameters` modal to the Chat page with an active-count trigger and existing light/dark visual patterns.
- Extra values are JSON-parsed, validated against duplicates and reserved fields, stored per user alongside the current chat lifecycle, and applied to subsequent UI requests before controlled request fields.
- Added Playwright coverage for validation, typed forwarding, refresh persistence, Clear History cleanup, and a 375x667 mobile viewport.
- `make build` passes and all 80 Vitest server tests pass.
- Fixed the key-deletion Playwright locator to scope both the click and disappearance assertion to the exact key row.
- Full `make test` passes: 80 Vitest tests and 22 Playwright tests passed; 5 Playwright tests remain intentionally skipped.
- Added strict boolean `stream: true` support to `/v1/chat/completions`; provider SSE bytes are relayed unchanged while a parsed copy captures usage and output for accounting.
- Streaming finalization is idempotent so `[DONE]`, upstream end/error, and client disconnect release the provider queue exactly once.
- Added regression coverage for split SSE chunks, passthrough fields, provider-selector filtering, upstream usage accounting, and immediate queue reuse.
- Final verification passes: `make build`; `make test` with 80 Vitest tests and 22 Playwright tests passed, with 5 intentionally skipped.
