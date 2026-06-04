---
name: create-chart
description: Interactive guide to scaffold a new Helm chart following established repository patterns
---

## What to do

When this skill is active, guide the user through creating a new Helm chart. Ask questions interactively and scaffold the chart based on answers.

### Questions to ask (in order)

1. **What is the chart name?** (kebab-case, e.g. `mpi-operator`, `kueue`)

2. **What archetype does this chart follow?**
   - **bare-operator**: Deploy an operator from a static upstream manifest (renders templates like ServiceAccount, ClusterRole, ClusterRoleBinding, Deployment). Example: `mpi-operator`.
   - **wrapper**: Thin wrapper around an upstream Helm chart (declares it as a Chart.yaml dependency, optionally adds extra templates). Examples: `kueue`, `slurm-operator`, `nvidia-gpu-operator`.
   - **platform**: Full platform orchestrator with embedded helmfile (like `fairport`).

3. **For bare-operator:**
   - What is the URL of the upstream manifest? (e.g. `https://raw.githubusercontent.com/kubeflow/mpi-operator/v0.8.0/deploy/v2beta1/mpi-operator.yaml`)
   - Does the manifest define a `CustomResourceDefinition`? If so, extract it into `crds/<name>-crd.yaml`.
   - Does it need Kubeflow integration roles (admin/edit/view aggregation)? (yes/no)
   - Does it use `--lock-namespace` or other operator-specific CLI flags?

4. **For wrapper:**
   - What is the upstream chart name? (e.g. `kueue`, `gpu-operator`)
   - What is the upstream chart version? (e.g. `0.14.1`, `v25.10.0`)
   - What is the upstream chart repository URL? (e.g. `oci://registry.k8s.io/kueue/charts`, `https://helm.ngc.nvidia.com/nvidia`)
   - Does the upstream chart need an alias in Chart.yaml? (e.g. `gpu-operator` aliased as `nvidia-gpu-operator`)
   - Does it need extra templates beyond the upstream chart? (e.g. post-install Jobs, PriorityClasses)
   - Point the user at the upstream chart's values.yaml so they can decide what to expose/override.

5. **For platform:**
   - Refer them to the `fairport` chart as the template and ask what helmfile releases they need.

6. **What initial version?** (default: `0.3.0`, semver X.Y.Z)

7. **What labels should be used?** Default suggestion:
   ```yaml
   app: <chart-name>
   app.kubernetes.io/component: <short-component>
   app.kubernetes.io/name: <chart-name>
   ```

### Files to create

Always create these (follow patterns from existing charts):

| File | Source / Pattern |
|---|---|
| `Chart.yaml` | `apiVersion: v2`, `version: 0`, annotation `publish-repository: oci://gcr.io/fairport-io` |
| `VERSION` | Single line: `0.3.0` (or user-provided version) |
| `Makefile` | Symlink to `../Makefile` |
| `README.md` | Docs about the app and how to install/use it with common parameters |
| `Dockerfile` | Standard multi-stage alpine/helm:3.20 Dockerfile with `helm template <chart-name> . --namespace <chart-name>` in the test stage |
| `.helmignore` | `./<chart-name>-*.tgz` |
| `.dockerignore` | Exactly `Makefile`, `Dockerfile` |
| `values.yaml` | Top-level key matching chart name, with `enabled`, `image`, `replicaCount`, resources, scheduling fields |

### Bare-operator specific templates

Create these with `{{- $var := index .Values "<chart-name>" -}}` pattern:

| Template | Contents |
|---|---|
| `templates/serviceaccount.yaml` | Conditional ServiceAccount, guarded by `$var.serviceAccount.create` |
| `templates/clusterrole.yaml` | RBAC rules extracted from upstream manifest |
| `templates/clusterrolebinding.yaml` | Binds ClusterRole to ServiceAccount in `.Release.Namespace` |
| `templates/deployment.yaml` | Deployment with configurable image, resources, nodeSelector, tolerations, affinity |
| `templates/clusterrole-kubeflow.yaml` | (optional) Kubeflow admin/edit/view aggregation roles |

### Wrapper specific setup

- Add `dependencies` to `Chart.yaml` pointing at the upstream chart.
- Run `helm dependency update` (or commit `.tgz` into `charts/` directory for offline builds).
- Set `condition: <chart-name>.enabled` on the dependency.

### values.yaml structure for bare-operator

```yaml
---
<chart-name>:
  enabled: false
  image: <upstream-image>:<version>
  imagePullPolicy: IfNotPresent
  replicaCount: 1
  serviceAccount:
    create: true
    name: <chart-name>
  <any-operator-specific-args-as-fields>
  resources: {}
  nodeSelector: {}
  tolerations: []
  affinity: {}
  labels:
    app: <chart-name>
    app.kubernetes.io/component: <component>
    app.kubernetes.io/name: <chart-name>
```

### Post-creation checklist

- [ ] Ensure that the README.md is updated
- [ ] `make build` passes
- [ ] `make test` passes
- [ ] `git diff origin/main` shows only the expected new files
