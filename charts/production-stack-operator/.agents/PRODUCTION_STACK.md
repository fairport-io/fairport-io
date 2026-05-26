## Objective
Add the production stack chart (https://github.com/vllm-project/production-stack) to this repository following patterns used for other charts.

## Requirements
### Setup
- [x] Fetch latest: `git fetch origin`
- [x] Read root AGENTS.md: `cat "$(git rev-parse --show-toplevel)/AGENTS.md"`
- [x] Create branch: `git checkout -b agent/add-production-stack-chart origin/main`
- [x] Survey component: read README.md and relevant source files

### Implementation
- [x] Create Chart.yaml as self-contained (no dependency on upstream helm chart)
- [x] Create crds/ with 4 CRDs (cacheserver, loraadapter, vllmrouter, vllmruntime)
- [x] Create templates/ with operator deployment, RBAC, service, and sample CRs
- [x] Update values.yaml with operator configuration values
- [x] Update README.md for operator-based deployment

### Verification
- [x] `make build` passes
- [x] `make test` passes
- [x] Run `git diff origin/main` and verify the changeset matches this spec
- [x] Check this file again to ensure you met all requirements.  Update this file with your progress.
- [x] The Agent Plan and Agent Implementation Details are filled out an all boxes checked to be considered done.

## Agent Plan

1. Switch chart from wrapping `vllm-stack` Helm subchart to deploying production-stack operator
2. Fetch upstream operator CRDs and Kustomize config
3. Create `crds/` directory with 4 CRD YAMLs (cacheserver, loraadapter, vllmrouter, vllmruntime)
4. Create `templates/` with operator RBAC (ServiceAccount, Roles, ClusterRoles, Bindings), Deployment, Metrics Service, and optional sample CRs
5. Update `values.yaml` with operator config (image, resources, nodeSelector, tolerations)
6. Update `README.md` for operator-based deployment
7. Run `make build && make test` to verify

## Agent Implementation Details

- Changed `charts/production-stack/Chart.yaml` from dependency-based (vllm-stack) to self-contained `type: application`
- Created `crds/` with 4 CRDs fetched from upstream `operator/config/crd/bases/`:
  - `crd-cacheserver.yaml` — CacheServer CRD
  - `crd-loraadapter.yaml` — LoraAdapter CRD
  - `crd-vllmrouter.yaml` — VLLMRouter CRD
  - `crd-vllmruntime.yaml` — VLLMRuntime CRD
- Created `templates/operator-rbac.yaml` with ServiceAccount, leader-election Role/Binding, manager ClusterRole/Binding, metrics-auth ClusterRole/Binding, metrics-reader ClusterRole
- Created `templates/operator-deployment.yaml` parameterized with `.Values.operator` (image, replicas, resources, nodeSelector, tolerations, affinity, extraEnv)
- Created `templates/operator-service.yaml` for metrics endpoint
- Created `templates/operator-samples.yaml` for optionally deploying VLLMRuntime/VLLMRouter CRs
- Replaced `values.yaml`: removed 284 lines of `vllm-stack` wrapping values, added concise operator config
- Updated `README.md` to describe operator-based deployment with CRDs
- `make build` and `make test` both pass successfully
