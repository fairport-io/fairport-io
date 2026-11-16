# Sync provisioning with Tinkerbell v0.26.0

## Request

Update the provisioning chart for https://github.com/tinkerbell/tinkerbell/releases/tag/v0.26.0.
Use deterministic WorkflowRuleSet selection from https://github.com/tinkerbell/tinkerbell/pull/1138
to avoid deleting and recreating Tinkerbell objects on every Helm run. Dedupe
related code where upstream behavior makes it unnecessary.

## Scope

- Upgrade the Tinkerbell chart dependency and lockfile from v0.23.0 to v0.26.0.
- Reconcile wrapper values with upstream configuration changes, preserving the
  existing provisioning image cache and boot environment where needed.
- Update generated WorkflowRuleSets and Templates in place, with deterministic
  precedence and an explicit upgrade path for existing objects.
- Limit edits to the provisioning chart. Preserve unrelated code and comments.
- Do not install host software, commit, push, or deploy.

## Agent Plan

- [x] Create branch `agent/provisioning-tinkerbell-v026` and this spec.
- [x] Compare upstream chart defaults and APIs with the current wrapper.
- [x] Trace object installation, runtime patching, and workflow cleanup.
- [x] Implement the smallest compatible update and remove redundant regeneration.
- [x] Leave one runnable regression check for non-trivial changes.
- [x] Run `make build` and `make test` in `charts/provisioning`.
- [x] Review `git diff origin/main` against this scope.

## Agent Results

- Updated the OCI dependency and Helm-generated lockfile to v0.26.0.
- Explicitly disabled upstream CaptainOS to retain cached HookOS and its kernel
  and initrd filenames. Existing values map to upstream's IPv4 environment names;
  v1alpha1 WorkflowRuleSets and Templates remain supported.
- Removed delete/recreate operations, reversed installation order, and the unused
  artifact-IP lookup. Existing object names and UIDs survive upgrades; runtime
  Template URL substitution remains in the object manager.
- Documented rule-count precedence, alphabetical tie-breaking, and manual cleanup
  for renamed/removed objects. No existing objects are renamed automatically.
- Added `sh charts/provisioning/test-upstream.sh`, also run by the Docker test
  target. It renders default and custom workflows, checks boot configuration,
  executes installer scripts twice with mocked kubectl, rejects destructive or
  unused calls, and compares the submitted manifests.
- Validation passed: `make build`, `make test`, strict lint of the packaged chart,
  and `git diff --check`. Restoring the old delete/recreate block in a temporary
  chart made the regression check fail as expected.
- Source-tree lint encounters the existing numeric `version: 0` build placeholder;
  the packaged chart receives its version from VERSION and passes strict lint.
- Validation did not provision hardware or apply objects to a live cluster.
