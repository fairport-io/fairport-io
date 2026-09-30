# Grafana VictoriaLogs and VictoriaTraces datasources

## Spec

Configure Grafana in `charts/monitoring/values.yaml` to query the monitoring
chart's VictoriaLogs and VictoriaTraces services. Include the VictoriaLogs
Grafana plugin and use Grafana's built-in Jaeger datasource for VictoriaTraces.
Verify the proposed VictoriaTraces endpoint
`http://monitoring-vt-cluster-vtselect.monitoring.svc.cluster.local:10471/select/jaeger`
against the pinned chart's service naming.

Scope: add Grafana plugin and datasource values, preserving existing settings,
comments, and backend enablement flags. No deployment or software installation.

## Agent Plan

- [x] Create this spec and a task branch.
- [x] Inspect chart dependencies, service names, and provisioning support.
- [x] Add the minimum Grafana configuration for both datasources.
- [x] Run the applicable build and test checks and review the scoped diff.

## Agent Validation

Added `grafana.plugins` and `grafana.additionalDataSources` using the existing
kube-prometheus-stack provisioning support. With release and namespace
`monitoring`, the rendered endpoints are:

- VictoriaLogs: `http://vlselect.monitoring.svc.cluster.local:9471`
- VictoriaTraces: `http://monitoring-vt-cluster-vtselect.monitoring.svc.cluster.local:10471/select/jaeger`

Validated against the pinned chart dependencies in a temporary copy:

- Helm lint passed with default values and with both backends enabled. The
  temporary Chart.yaml version was set from VERSION, matching the Docker build.
- Helm rendering checks passed with backends disabled, both enabled, and with
  release `observability` in namespace `telemetry`. Checked datasource types,
  URLs, proxy access, service ports, the VictoriaLogs plugin ConfigMap reference,
  and Prometheus remaining the default datasource.
- Helm packaging passed. `git diff --check` passed and the diff against
  `origin/main` contains only the intended values additions; this spec is new.
- `make build` and `make test` were attempted independently; both failed before
  building because the configured remote Docker builder rejected SSH access:
  `Permission denied (publickey,password).` These checks remain blocked.

No deployment or live connectivity check was performed. Backend enablement
flags remain false by default; deployments must enable the backends separately.

To repeat the chart render after dependencies are available, from this component:

```sh
helm template monitoring . --namespace monitoring \
  --set victoria-logs-cluster.enabled=true \
  --set victoria-traces-cluster.enabled=true
```
