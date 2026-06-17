# fairport-ui

Helm chart for [Fairport UI](https://github.com/fairport-io/fairport-io) — a chat interface with API proxy, provider management, usage tracking, and OIDC integration.

## Overview

Fairport UI provides a web-based chat interface backed by an Express + React stack. It supports multiple database backends (PGlite, YAML, PostgreSQL), OAuth/OIDC SSO, rate limiting, request queuing, RBAC with groups, and usage tracking.

## Usage

```bash
helm install fairport-ui oci://ghcr.io/fairport-io/charts/fairport-ui --namespace fairport-ui --create-namespace
```

### Configuration

| Parameter | Description | Default |
|-----------|-------------|---------|
| `fairport-ui.enabled` | Enable fairport-ui | `false` |
| `fairport-ui.image` | Application image | `ghcr.io/fairport-io/fairport-ui:0.0.1` |
| `fairport-ui.imagePullPolicy` | Image pull policy | `IfNotPresent` |
| `fairport-ui.replicaCount` | Number of replicas | `1` |
| `fairport-ui.serviceAccount.create` | Create ServiceAccount | `true` |
| `fairport-ui.serviceAccount.name` | ServiceAccount name | `fairport-ui` |
| `fairport-ui.kubeconfigSecret.enabled` | Mount a Secret containing non-local kubeconfig files | `false` |
| `fairport-ui.kubeconfigSecret.name` | Secret name for kubeconfig files | `""` |
| `fairport-ui.kubeconfigSecret.mountPath` | Mount path used by `KUBECONFIG_SECRET_DIR` | `/var/run/secrets/fairport-ui/kubeconfigs` |
| `fairport-ui.env` | Environment variables | `[{name: PORT, value: "8000"}, {name: NODE_ENV, value: "production"}]` |
| `fairport-ui.extraEnv` | Additional env vars | `[]` |
| `fairport-ui.ingress.enabled` | Enable Ingress | `false` |
| `fairport-ui.ingress.className` | Ingress class name | `""` |
| `fairport-ui.ingress.annotations` | Ingress annotations | `{}` |
| `fairport-ui.ingress.hosts` | Ingress hosts | `[{host: fairport-ui.local, paths: [{path: /, pathType: Prefix}]}]` |
| `fairport-ui.ingress.tls` | Ingress TLS | `[]` |
| `fairport-ui.nodeSelector` | Node selector | `{}` |
| `fairport-ui.tolerations` | Tolerations | `[]` |
| `fairport-ui.affinity` | Affinity rules | `{}` |
| `fairport-ui.resources` | Container resources | `{}` |

### Environment Variables

Refer to the [upstream documentation](https://github.com/fairport-io/fairport-io/blob/main/apps/fairport-ui/README.md) for the full list of supported environment variables (JWT_SECRET, SECRET_KEY, DATABASE_TYPE, OAUTH_* vars, etc.).

Set them via `fairport-ui.extraEnv`:

```yaml
fairport-ui:
  extraEnv:
    - name: SECRET_KEY
      value: "my-secret-key"
    - name: JWT_SECRET
      value: "my-jwt-secret"
    - name: DATABASE_TYPE
      value: "pglite"
```
