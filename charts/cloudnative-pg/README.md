# cloudnative-pg

Helm wrapper for the [CloudNativePG](https://cloudnative-pg.io/) operator with automated cluster provisioning and credential management.

## Overview

This chart installs the CNPG operator and provides a Job-based mechanism to dynamically create PostgreSQL clusters from `values.yaml`. Credentials are auto-generated and preserved across Helm upgrades.

## Architecture

- **Operator:** Installs the upstream `cloudnative-pg` subchart (CRDs, controller, webhooks)
- **Cluster Init Job:** Creates `Cluster` CRs by applying YAML manifests via `kubectl apply --server-side`
- **Secret Manager:** Auto-generates passwords with `randAlphaNum 32`, preserves existing secrets across upgrades using Helm's `lookup` function

## Usage

```bash
helm install cloudnative-pg oci://gcr.io/fairport-io/charts/cloudnative-pg
```

### Adding a Cluster

Add cluster definitions under `pg-cluster-installer.clusters` in `values.yaml`:

```yaml
pg-cluster-installer:
  clusters:
    mycluster:
      bootstrap:
        initdb:
          database: appdb
          owner: appuser
          secret:
            name: mycluster-credentials
      instances: 3
      storage:
        storageClass: openebs-hostpath
        size: "10Gi"
```

The init Job will create the cluster and a corresponding Secret with auto-generated credentials.

## High Availability

For production, configure at least 3 instances with anti-affinity:

```yaml
instances: 3
affinity:
  podAntiAffinityType: preferred
topologySpreadConstraints:
  - maxSkew: 1
    topologyKey: topology.kubernetes.io/zone
    whenUnsatisfiable: DoNotSchedule
```

## Monitoring

Enable Prometheus Operator integration and Grafana dashboards:

```yaml
cloudnative-pg:
  monitoring:
    podMonitorEnabled: true
    grafanaDashboard:
      create: true
```
