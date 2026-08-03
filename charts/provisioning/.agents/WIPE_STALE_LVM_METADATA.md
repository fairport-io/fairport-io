## Objective
Ensure Tinkerbell workflows with `wipe_all_disks` enabled remove stale LVM metadata from existing disk partitions before streaming a new OS image.

## Requirements
### Setup
- [ ] Fetch latest: `git fetch origin`
- [x] Read root `AGENTS.md`
- [x] Confirm this spec is in `charts/provisioning/.agents/`
- [x] Survey `charts/provisioning/` and read its `README.md`, values, and relevant template
- [x] Create branch: `git checkout -b agent/fix-tinkerbell-vg-wipe origin/main`

### Implementation
- [ ] Change only the `wipe_all_disks` block in `templates/tinkerbell-object-installer-job.yaml`
- [ ] When available, deactivate existing volume groups before wiping; abort with a clear error if deactivation fails
- [ ] For every disk already selected in `DISKS`, wipe signatures from its existing partitions before wiping the parent disk
- [ ] Abort with a clear error if any required partition or disk wipe fails
- [ ] Preserve the selected installation target in `DISK` and preserve existing behavior when `wipe_all_disks` is false
- [ ] Do not add a dependency, perform a full-disk zero/secure erase, or change unrelated installer behavior

### Tests
- [ ] Add or update one small runnable regression check that verifies child partitions are wiped before their parent disk without changing `DISK`
- [ ] Verify the rendered Helm template is valid with `wipe_all_disks` both disabled and enabled

### Verification
- [ ] `make build` passes
- [ ] `make test` passes
- [ ] Run `git diff origin/main` and verify the changeset matches this spec
- [ ] Check this file again and update all Agent sections and checkboxes with the implementation result

## Agent Plan
1. Re-read the disk-selection and disk-wipe flow and keep the change inside the existing conditional block.
2. Deactivate active LVM mappings when the installer image provides `vgchange`.
3. Enumerate each selected disk's current partition children, wipe those signatures, and then wipe the parent disk without reusing `DISK` as a loop variable.
4. Add the smallest dependency-free regression check for ordering, failure handling, and target preservation.
5. Render the chart, run the component build and tests, and review the final diff against this spec.

## Agent Implementation Details
Pending review and implementation.
