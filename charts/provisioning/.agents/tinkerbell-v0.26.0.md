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
- Remove installer-managed WorkflowRuleSets absent from the current configuration,
  including when no workflows remain. Preserve existing dependent Workflows and
  Templates, and keep unmanaged resources untouched.
- Rename the shipped catch-all workflow from `default` to `zzz-default` as requested.
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

## Agent Plan: stale WorkflowRuleSets

- [x] Trace installer and object-manager ownership and deletion behavior.
- [x] Consolidate installation into one hook Job so all desired objects apply
  successfully before obsolete rule sets are pruned, including an empty config.
- [x] Prune only namespace-local, installer-labeled WorkflowRuleSets with orphan
  propagation so existing Workflows are preserved. Keep Templates for references.
- [x] Extend the existing runnable check for stale, retained, unmanaged, empty,
  repeated-run, and failed-apply/list cases.
- [x] Run `make build` and `make test` and review the complete diff.

## Agent Plan: fallback name

- [x] Rename the shipped fallback and update the related comment and documentation.
- [x] Check migration from `default` to `zzz-default`, run `make build` and
  `make test`, and review the diff.

## Agent Results

- Updated the OCI dependency and Helm-generated lockfile to v0.26.0.
- Explicitly disabled upstream CaptainOS to retain cached HookOS and its kernel
  and initrd filenames. Existing values map to upstream's IPv4 environment names;
  v1alpha1 WorkflowRuleSets and Templates remain supported.
- Removed wholesale delete/recreate operations, reversed installation order, and
  the unused artifact-IP lookup. Objects with unchanged names retain their UIDs;
  runtime Template URL substitution remains in the object manager.
- Consolidated per-workflow hook Jobs into one Job. After all desired objects
  apply, it deletes namespace-local WorkflowRuleSets bearing the installer label
  whose exact names are absent from the config. Empty configs prune managed rule
  sets too. Failed applies or listing prevent pruning; deletion errors fail the Job.
- Deletions use orphan propagation to preserve existing Workflows. Templates are
  retained for existing references; unlabeled rule sets are excluded from listing.
- Documented rule-count precedence, alphabetical tie-breaking, automatic stale
  rule-set cleanup, and retained Templates. The shipped fallback is `zzz-default`;
  custom workflow lists retain their explicit names and must rename their own
  fallback. Checks cover creating `zzz-default` and pruning the legacy `default`
  rule set while preserving existing Workflows and Templates.
- Added `sh charts/provisioning/test-upstream.sh`, also run by the Docker test
  target. It renders default and custom workflows, checks boot configuration,
  executes installer scripts twice with mocked kubectl, checks scoped orphan
  deletion, keeps desired/unmanaged names, compares submitted manifests, and
  exercises empty configs and apply/list/delete failures.
- Validation passed: `make build`, `make test`, and `git diff --check`. Removing
  pruning from a temporary copy made the regression check fail as expected.
- Source-tree lint encounters the existing numeric `version: 0` build placeholder;
  the packaged chart receives its version from VERSION and passes strict lint.
- Validation did not provision hardware or apply objects to a live cluster.
