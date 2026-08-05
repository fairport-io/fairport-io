## Objective
Add an OpenAI-compatible model catalog, provider-scoped model visibility, paginated model/provider management APIs, and separate Providers and Models UI pages without making provider selection mandatory for inference.

## Requirements

### Setup
- [x] Confirm this spec is in `apps/fairport-ui/.agents/`
- [x] Read this spec fully before writing application code
- [x] Survey component: `tree -a -L 3 -I '.git|node_modules|vendor|__pycache__|dist|build'`
- [x] Find app files: `find . -name "*.ts" -o -name "*.tsx"`
- [x] Read `README.md`
- [x] Check for local `AGENTS.md` or `README.md` in the component directory
- [x] Create branch: `git checkout -b agent/model-catalog origin/main`

### Provider Model Data
- [x] Store models as provider-scoped offerings with stable IDs
- [x] Track manual/discovered source, public/private visibility, enabled state, and stable creation/last-seen timestamps
- [x] Enforce uniqueness for `(provider_id, model_id)`
- [x] Migrate existing provider model strings without losing data
- [x] Keep the immutable default provider's models public and other migrated offerings private
- [x] Use one provider-model source of truth for discovery, management, catalog listing, and chat routing
- [x] Scope model pricing, rate limits, and queue settings by provider where existing behavior requires it

### OpenAI-Compatible Catalog
- [x] Add `GET /v1/models` with the OpenAI list response shape
- [x] Add `GET /v1/models/:model` with the OpenAI retrieve response shape
- [x] Keep the default OpenAI endpoints unpaginated
- [x] Support optional Fairport `provider` and `provider_id` selectors
- [x] Return only default-provider models for anonymous unfiltered requests
- [x] Return only public models for anonymous provider-filtered requests
- [x] Return all models usable by an authenticated API key for authenticated unfiltered requests
- [x] Return usable models on the selected provider for authenticated filtered requests
- [x] Reject invalid credentials instead of treating them as anonymous
- [x] Avoid leaking inaccessible provider existence
- [x] Deduplicate unfiltered model IDs using the same deterministic provider resolution as chat

### Management APIs
- [x] Add a cursor-paginated model-offering endpoint with search, provider, and visibility filters
- [x] Add an authorized per-offering public/private visibility update
- [x] Paginate the provider-management endpoint while preserving a compatibility path for current callers
- [x] Limit visibility changes to offering owners, owning-group members, and Global Admins
- [x] Never expose provider credentials or private endpoint details through public catalog responses

### UI
- [x] Split Providers and Models into separate sidebar pages
- [x] Keep provider creation, testing, discovery, editing, and deletion on Providers
- [x] Add a paginated model table with provider, visibility, source, availability, and actions
- [x] Add model search plus provider and visibility filters
- [x] Add an explicit public/private control with a capacity/cost warning
- [x] Link provider model counts to a filtered Models page
- [x] Preserve existing light/dark and responsive behavior

### Tests
- [x] Cover all four authentication/provider-selector catalog cases
- [x] Cover invalid authentication, inaccessible providers, duplicate model IDs, and retrieve-model behavior
- [x] Cover legacy offering migration/source-of-truth behavior plus PGlite/YAML persistence; verify additive PostgreSQL handling in implementation and build review
- [x] Cover management pagination, filtering, and visibility authorization
- [x] Cover provider pagination compatibility
- [x] Cover Models navigation, table/filter/pagination behavior, and visibility controls in Playwright
- [x] Confirm chat routing still works without a provider selector and honors visibility/access rules

### Verification
- [x] `make build` passes
- [x] `make test` passes
- [x] Run `git diff origin/main` and verify the changeset matches this spec
- [x] Update relevant `.md` files for the next agent
- [x] Check this file again and mark completed requirements

## Agent Plan
1. Trace provider/model persistence, authorization, discovery, routing, and UI consumers before changing the schema.
2. Add the minimum provider-scoped offering representation and adapter migration needed to make one model source authoritative.
3. Reuse shared provider-access and deterministic routing helpers for chat and catalog endpoints.
4. Keep `/v1/models` OpenAI-shaped and unpaginated; expose management metadata only through cursor-paginated `/api` endpoints.
5. Split the existing provider UI from a focused model-offering table and retain current responsive styling.
6. Add focused server, adapter, and browser regressions; update docs; run `make build` and `make test`; inspect the final diff.

## Agent Implementation Details

- Offerings are embedded on providers because every current adapter persists a complete `DbData` snapshot. A deterministic hash of provider ID and model ID supplies stable IDs and enforces one active record per pair without adding another table or dependency.
- Startup converts legacy model strings into offerings. `providers.models` remains the compatibility projection, and legacy `model_pricing` supplies initial/fallback settings only.
- Catalog and chat both use shared offering-access and deterministic provider-order helpers. Publishing an offering grants authenticated RBAC-authorized use without exposing provider credentials/base URLs or enabling anonymous inference.
- Chat loads a cursor-paginated `usable=true` offering view for the selected API key, so public offerings on another user's private provider are selectable without broadening provider-management visibility.
- Usage events snapshot provider-offering prices. PGlite/PostgreSQL add the JSON offering and price-snapshot columns with additive migrations; YAML needs no schema migration.
- Providers retains its bare array response for existing callers and adds opt-in cursor pagination. Models management is a separate JWT-only API and UI page; the OpenAI catalog remains unpaginated.
