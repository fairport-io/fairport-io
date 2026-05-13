# fairport-io

A repository of Fairport applications.

## Training

All users must complete the steps in [TRAINING.md](TRAINING.md) to contribute to this repository.

## Contributing

Each application should have its own `README.md` file with information about the application.

Each application should have its own `Makefile` symlinked to the root `Makefile` for the CI/CD system.

Update the `VERSION` files if you are making changes to allow applications to continue using existing code for backwards compatiabilty.  In each app there should be a `VERSION` file following symantic versioning (X.Y.Z).  If your app is part of the dmatrix helm chart, consider updating the `image:` as well.

Builds can be copmleted locally or in the CI/CD system.  All builds using the `Makefile` are hermetic and only require `docker` to be installed.  For arm64 Macs, if docker isn't installed then Rancher Desktop is a good option (https://rancherdesktop.io/) it will install a Kubernetes Cluster on a Linux VM which can be configured to use Rosetta virtualization and Docker so you can run `docker` natively on Appple Silicon without licensing issues.  Altenatives like Podman can also work.

The Makefile supports the following arguments:

| Command       | Action |
| -             | -      |
| `make build`  | Creates a container and builds artifacts inside the container specified in the `build` stage/target and saves the container if the build is successful |
| `make test`   | Launches the container and runs the `test` stage/target of the Dockerfile |
| `make deploy` | Uploads artifacts to the artifact registry and then runs the `deploy` stage/target of the Dockerfile |
| `make clean`  | Deletes the container on the local device |

## Agents

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
