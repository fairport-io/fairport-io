## Objective
Add an environment variable `DATABASE_TYPE` where the default is yaml (the current implementation).  If DATABASE_TYPE=yaml also keep the existing config.  If DATABASE_TYPE=pglite then use the embedded pglite (if this wont work let me know and we can change the plan).  If DATABASE_TYPE=postgres then expect the common postgres variables like PGHOST PGPORT PGDATABASE PGUSER PGPASWORD (PGHOST PGUSER and PGPASSWORD being required), the other ones can use the defaults.  Maybe the default databaes is called fairport-ui.

## Requirements
### Setup
- [x] Fetch latest: `git fetch origin`
- [x] Read root AGENTS.md: `cat "$(git rev-parse --show-toplevel)/AGENTS.md"`
- [x] Create branch: `git checkout -b agent/signups-enabled origin/main`
- [x] Survey components: read all of the `*.md` files to understand structure and code.

### Implementation
- [x] Add the DATABASE_TYPE env var, default to yaml, support pglite or postgres
- [x] Update all of the yaml interactions so that they can also update postgres depending on the DATABASE_TYPE
- [x] Add pglite as a dependency so we can build it into the continer
- [x] Add some logic for DATABASE_TYPE if its using postgres then ensure it will work with no configuration (create the database it if doesnt exist and tables etc.)

### Tests
- [x] Write a test that should work with pglite.

### Verification
- [x] `make build` passes
- [ ] `make test` passes (vitest passes; E2E has pre-existing EMFILE issue from Vite HMR watcher in Docker, not related to this change)
- [ ] Run `git diff origin/main` and verify the changeset matches this spec (branch diverged from origin/main, verified manually)
- [x] Check this file again to ensure you met all requirements.
- [x] Update any `*.md` files if things have changed to keep them up-to-date.
- [ ] All boxes checked — task complete.
- [x] Only update checkboxes above this line.  All other planning and changes go below this line in the spec file

--- AGENTS EDITS BELOW THIS LINE ONLY EXCEPT CHECKBOXES ---

## Agent Plan

1. Survey codebase: understand YAML DB operations in server.ts, test structure, dependencies
2. Create database abstraction module in `src/db/`:
   - `types.ts` — TypeScript interfaces for all entity types and DatabaseAdapter
   - `yaml-adapter.ts` — Sync YAML I/O wrapped as async (preserves existing behavior)
   - `pglite-adapter.ts` — PGlite WASM engine adapter (tables created on first load)
   - `postgres-adapter.ts` — Full PostgreSQL via `pg` Pool (auto-creates database + tables)
   - `index.ts` — Factory function `createDatabase(type)`
3. Update `server.ts`:
   - Import `createDatabase` and replace `loadDb()`/`saveDb()` with async versions
   - All endpoints updated to use `await loadDb()` / `await saveDb(db)`
   - `loadDb()` and `saveDb()` delegate to the selected adapter
4. Add `@electric-sql/pglite` and `pg` as `optionalDependencies` in `package.json`
5. Update `.env.example` with `DATABASE_TYPE` and PG* env vars
6. Write PGlite adapter test (`tests/server/pglite.test.ts`)
7. Update `AGENTS.md` and spec file

## Agent Implementation Details

### Database Abstraction Layer

The key design decision was to keep `loadDb()` and `saveDb()` as the sole API surface in `server.ts`,
avoiding a large refactor of all 2220+ lines. Each adapter implements these two methods:

- **YAML adapter**: wraps existing `js-yaml` sync I/O as async (unchanged behavior)
- **PGlite adapter**: uses `@electric-sql/pglite` with SQL `CREATE TABLE IF NOT EXISTS` on first access;
  stores JSON fields (`permissions`, `members`, `api_keys`) as `TEXT` (SQLite-compatible).
  Uses `query()` for all SQL, with `$1, $2` parameterized queries.
- **Postgres adapter**: uses `pg` Pool; connects to `postgres` database first to CREATE DATABASE if needed,
  then connects to target DB and creates tables. Uses `JSONB` for complex fields.
  `PGHOST`, `PGUSER`, `PGPASSWORD` are required; `PGPORT` defaults to 5432,
  `PGDATABASE` defaults to `fairport-ui`.

### Key changes to server.ts

- `const dbAdapter: DatabaseAdapter = createDatabase(DATABASE_TYPE)` at module scope
- `loadDb()` and `saveDb()` became async wrappers around the adapter
- `ensureDefaults()` and `ensureAdminForEmail()` became async (they call `saveDb()`)
- All sync handlers that called `loadDb()` (signup, config) made async
- Test mode init wrapped in IIFE for async

### Tests
- All 73 existing unit tests pass unchanged (they use DATABASE_TYPE=yaml implicitly)
- New PGlite adapter test tests: empty DB load, save+load roundtrip, overwrite, immutable boolean handling

