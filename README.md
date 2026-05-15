# fairport-io

A repository of Fairport applications.

## Training: [TRAINING.md](TRAINING.md)

All users must complete the steps in [TRAINING.md](TRAINING.md) to contribute to this repository.

## Contributing: [CONTRIBUTING.md](CONTRIBUTING.md)

Guidelines for contributing to this repository.

## Agents: [AGENTS.md](AGENTS.md)

This repo is designed to work with AI agents.  Users should add `<SPEC_NAME>.md` files inside a `.agents` directory for the app they wish to modify or in the root of the repository.

<details>
<summary>Example Prompt</summary>

This is an example prompt for a spec file at `.agents/EXAMPLE_EXPORTER_FIX_COUNTERS.md`

```
Implement .agents/TEMPLATE.md exactly.
```

</details>

<details>
<summary>Example Spec File</summary>

This is a template spec for a file called `.agents/TEMPLATE.md`

```
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
```
</details>
