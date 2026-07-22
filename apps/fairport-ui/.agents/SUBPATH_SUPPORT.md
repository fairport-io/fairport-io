## Status

Complete.

## Objective

Allow the existing container image to serve the complete Fairport UI from an optional runtime URL prefix such as `/chat`, without requiring an ingress rewrite or a separate image build.

## Public Behavior

- Add `BASE_PATH`, defaulting to empty so current root deployments remain unchanged.
- Accept a leading-slash path with no query or fragment; normalize trailing slashes (`/chat/` becomes `/chat`).
- With `BASE_PATH=/chat`, serve:
  - UI landing/chat at `/chat/`
  - UI tabs beneath `/chat/` (for example `/chat/providers`)
  - REST endpoints beneath `/chat/api/`
  - the OpenAI-compatible endpoint at `/chat/v1/chat/completions`
  - static assets beneath `/chat/assets/`
- Redirect the bare mount path `/chat` to `/chat/` so relative URLs resolve consistently.
- The ingress must forward `/chat` and `/chat/*` unchanged to the service; it does not need to expose root-level `/assets`, `/api`, or UI routes.
- When `APP_URL` is set, it remains the full externally visible application URL, including `BASE_PATH`. When unset, OAuth URLs are derived from the request origin plus `BASE_PATH`.

## Requirements

### Setup

- [x] Confirm this spec is in `apps/fairport-ui/.agents/`
- [x] Read this spec, the root and local `AGENTS.md` files, `README.md`, and `TESTS.md`
- [x] Survey the component and trace all frontend URL construction, server routing, static assets, and OAuth redirects
- [x] Work on `agent/subpath-support`

### Implementation

- [x] Keep `/` as the default deployment behavior when `BASE_PATH` is unset
- [x] Mount or internally strip the configured prefix before existing Express API and SPA routing
- [x] Emit relative Vite asset URLs so `BASE_PATH` remains a runtime setting
- [x] Give browser-relative URLs a stable application base at both the mount root and nested UI routes
- [x] Prefix frontend API requests, OAuth links, tab/history URLs, and generated API examples
- [x] Include `BASE_PATH` in auto-derived OAuth callback and frontend redirect URLs
- [x] Avoid new dependencies and keep URL handling in one small shared frontend helper
- [x] Document `BASE_PATH` and its ingress/`APP_URL` behavior in `.env.example`, `README.md`, and `AGENTS.md`

### Tests

- [x] Add at least one focused automated regression test that starts/imports the app with `BASE_PATH=/chat` and proves an existing API endpoint works through `/chat/api/...`
- [x] Cover the `/chat` to `/chat/` redirect in the same test if it does not materially increase the test size
- [x] Keep all existing root-path tests passing to prove backwards compatibility
- [x] Record the new coverage in `TESTS.md`

### Verification

- [x] `make build` passes
- [x] `make test` passes
- [x] Verify the production HTML uses relative asset URLs
- [x] Verify `BASE_PATH=/chat` keeps UI navigation and browser API requests under `/chat`
- [x] Run `git diff origin/main` and confirm the changeset is limited to subpath support, its test, and required documentation
- [x] Check this file again and complete the implementation details below

## Agent Plan

1. Add and normalize `BASE_PATH` once in the server, redirect its bare form, and strip it before the existing route stack.
2. Make Vite assets and the HTML document base relative so the same build works at root or beneath a runtime prefix.
3. Reuse one frontend base-path helper for API calls, navigation, OAuth links, and code samples.
4. Add the smallest server regression test, update documentation, and run the containerized build/test workflow.

## Agent Implementation Details

- Added validated, trailing-slash-normalized `BASE_PATH` handling and one prefix middleware that reuses the existing Express route stack.
- Vite now emits relative asset URLs; production HTML receives a runtime absolute base, and the frontend derives one shared path/fetch prefix from it.
- Frontend API calls, SPA navigation, OAuth links/redirects, and generated API examples all honor the configured prefix. Root hosting remains unchanged.
- Added one Vitest regression covering prefixed API routing and the canonical bare-path redirect; no dependency was added.
- `make build` passed. `make test` passed with 80 Vitest tests and 22 Playwright tests; the 5 pre-existing intentional Playwright skips remain.
