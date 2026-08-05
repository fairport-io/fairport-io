## Objective
Fix API key deletion so clicking the trash icon removes the key from the UI and persists the deletion in the backing database.

## Requirements
### Setup
- [ ] Confirm this spec is in `apps/fairport-ui/.agents/`
- [ ] Read this spec fully before writing application code
- [ ] Survey component: `tree -a -L 3 -I '.git|node_modules|vendor|__pycache__|dist|build'`
- [ ] Find app files: `find . -name "*.ts" -o -name "*.tsx"`
- [ ] Read `README.md`
- [ ] Check for local `AGENTS.md` or `README.md` in the component directory
- [ ] Create branch: `git checkout -b agent/fix-api-key-delete origin/main`

### Implementation
- [ ] Trace the API key delete flow from `KeyManager` through the server endpoint
- [ ] Fix the bug that prevents a generated key from being deleted from the UI
- [ ] Ensure successful delete updates frontend state only after the server confirms deletion
- [ ] Preserve existing owner/group API key behavior

### Tests
- [ ] Add or update regression coverage for API key deletion

### Verification
- [ ] `make build` passes
- [ ] `make test` passes
- [ ] Run `git diff origin/main` and verify the changeset matches this spec
- [ ] Update relevant `.md` files for the next agent
- [ ] Check this file again to ensure all requirements are met

## Agent Plan
1. Inspect the current key delete UI handler, API request shape, and server `DELETE /api/keys/:id` logic.
2. Reproduce or identify the mismatch that leaves newly-created keys visible after deletion.
3. Apply a focused fix that keeps UI state, ownership checks, and group-scoped key behavior consistent.
4. Add regression coverage around deleting a generated API key.
5. Run `make build`, `make test`, and review `git diff origin/main`.

## Agent Implementation Details
To be completed after implementation.
