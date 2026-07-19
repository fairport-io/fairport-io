## Objective
Allow operators to restrict new account creation to configured email addresses or email domains without affecting existing-user login.

## Requirements

### Setup
- [x] Read the root and component `AGENTS.md` files
- [x] Create branch `agent/signup-allowlist` from `origin/main`
- [x] Survey the component README and authentication flow

### Implementation
- [x] Add optional comma-separated email and domain allowlist environment variables
- [x] Enforce the allowlist in every new-user creation path
- [x] Preserve unrestricted signup when both allowlists are empty
- [x] Preserve login for existing users

### Tests
- [x] Test exact-email, domain, case-normalization, and denied signup behavior
- [x] Test unrestricted signup when no allowlist is configured
- [x] Run `make build` and `make test`

### Documentation
- [x] Update `.env.example`, `README.md`, `TESTS.md`, and `AGENTS.md`
- [x] Review `git diff origin/main`

## Agent Plan

1. Trace password and OAuth signup to find the shared new-user boundary.
2. Add one allowlist predicate configured by environment variables.
3. Apply it only when creating a user, leaving existing-user authentication unchanged.
4. Add focused server tests covering exact email, domain, normalization, rejection, and the unrestricted default.
5. Document the configuration and run the required build and test targets.

## Agent Implementation Details

- `SIGNUP_ALLOWED_EMAILS` and `SIGNUP_ALLOWED_DOMAINS` are comma-separated and case-insensitive.
- A new user is accepted when either their full email or exact domain is allowed.
- Empty allowlists preserve the existing unrestricted behavior.
- User verification completed the Docker build/test targets; the final Playwright stage reported 20 passed and 6 skipped.
