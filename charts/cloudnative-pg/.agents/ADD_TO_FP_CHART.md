## Objective
This chart is missing from charts/fairport/values.yaml.  Add it following the pattern of the other charts in that file
## Requirements
### Setup
- [x] Fetch latest: `git fetch origin`
- [x] Read root AGENTS.md: `cat "$(git rev-parse --show-toplevel)/AGENTS.md"`
- [x] Create branch: `git checkout -b agent/add-cloudnative-pg-to-fp-chart origin/main`
- [x] Survey component: read README.md and relevant source files

### Implementation
- [x] Update charts/fairport/values.yaml to include the missing chart
- [x] Update charts/fairport/VERSION if necessary

### Tests

### Verification
- [ ] `make build` passes (if applicable)
- [ ] `make test` passes (if applicable)
- [ ] Run `git diff origin/main` and verify the changeset matches this spec
- [ ] Check this file again to ensure you met all requirements.  Update this file with your progress.
- [ ] The Agent Plan and Agent Implementation Details are filled out an all boxes checked to be considered done.

## Agent Plan
<!-- Agent fills this in before starting. -->

## Agent Implementation Details
<!-- Agent fills this in when complete. -->