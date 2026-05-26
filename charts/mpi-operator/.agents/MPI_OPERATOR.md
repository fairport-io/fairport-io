## Objective
Add mpi operator (https://raw.githubusercontent.com/kubeflow/mpi-operator/v0.8.0/deploy/v2beta1/) to this repository following patterns used for other charts.

## Requirements
### Setup
- [x] Fetch latest: `git fetch origin`
- [x] Read root AGENTS.md: `cat "$(git rev-parse --show-toplevel)/AGENTS.md"`
- [x] Create branch: `git checkout -b agent/mpi-operator origin/main`
- [x] Survey component: read README.md and relevant source files

### Implementation
- [x] Update values.yaml with operator configuration values
- [x] Update README.md for operator-based deployment

## Agent Plan

1. Surveyed existing operator chart patterns (`nvidia-gpu-operator`, `kueue`, `cloudnative-pg`, `slurm-operator`, `fairport`) in `charts/`
2. Fetched upstream v0.8.0 manifest from `https://raw.githubusercontent.com/kubeflow/mpi-operator/v0.8.0/deploy/v2beta1/mpi-operator.yaml`
3. Created chart structure:
   - `Chart.yaml` - v2 Helm chart with `publish-repository` annotation
   - `values.yaml` - operator configuration (image, replicaCount, args, RBAC settings, scheduling)
   - `crds/mpijob-crd.yaml` - CRD extracted from upstream manifest
   - `templates/serviceaccount.yaml` - conditional ServiceAccount creation
   - `templates/clusterrole.yaml` - operator RBAC rules
   - `templates/clusterrole-kubeflow.yaml` - Kubeflow integration roles (admin/edit/view)
   - `templates/clusterrolebinding.yaml` - binds ClusterRole to ServiceAccount
   - `templates/deployment.yaml` - operator Deployment with configurable image, resources, scheduling
   - `Dockerfile` - standard multi-stage build (alpine/helm:3.20)
   - `VERSION` - 0.3.0
   - `.helmignore` / `.dockerignore` - standard excludes
   - `README.md` - chart overview, config table, MPIJob example
