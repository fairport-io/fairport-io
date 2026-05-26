## Objective
<!-- One sentence description of the goal. -->

## Requirements
### Setup
- [ ] Fetch latest: `git fetch origin`
- [ ] Read root AGENTS.md: `cat "$(git rev-parse --show-toplevel)/AGENTS.md"`
- [ ] Create branch: `git checkout -b agent/<branch-name> origin/main`
- [ ] Survey component: read README.md and relevant source files: `cat "$(git rev-parse --show-toplevel)/README.md" "$(git rev-parse --show-toplevel)/<app>/README.md"`

### Implementation
- [ ] <!-- Specific code change 1 -->
- [ ] <!-- Specific code change 2 -->

### Tests
- [ ] <!-- Specific test to add 1 -->
- [ ] <!-- Specific test to add 2 -->

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
