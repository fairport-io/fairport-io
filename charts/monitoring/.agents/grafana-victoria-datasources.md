# Grafana VictoriaTraces datasource

## Spec

Configure Grafana in `charts/monitoring/values.yaml` to query the monitoring
chart's VictoriaTraces service using Grafana's built-in Jaeger datasource.
Remove the VictoriaLogs datasource and plugin configuration at the user's request.
Verify the proposed VictoriaTraces endpoint
`http://monitoring-vt-cluster-vtselect.monitoring.svc.cluster.local:10471/select/jaeger`
against the pinned chart's service naming.

Scope: configure only the VictoriaTraces datasource, preserving existing settings,
comments, and backend enablement flags. No deployment or software installation.

## Agent Plan

- [x] Create this spec and a task branch.
- [x] Inspect chart dependencies, service names, and provisioning support.
- [x] Add the minimum Grafana configuration for the VictoriaTraces datasource.
- [x] Run the applicable build and test checks and review the scoped diff.

## Agent Validation

Added `grafana.additionalDataSources` using the existing
kube-prometheus-stack provisioning support. With release and namespace
`monitoring`, the rendered endpoint is:

- VictoriaTraces: `http://monitoring-vt-cluster-vtselect.monitoring.svc.cluster.local:10471/select/jaeger`

Validated the traces-only configuration against the pinned dependencies in a
temporary copy, setting Chart.yaml's version from VERSION as the build does:

- Helm lint passed with VictoriaTraces enabled.
- Rendering checks passed with traces disabled, enabled, and an alternate release
  and namespace. Verified Jaeger provisioning, the service name and port,
  Prometheus remaining the default, and no VictoriaLogs datasource or plugin.
- `git diff --check` passed; reviewed the diff against `origin/main`.
- Reran `make build` and `make test`; both remain blocked by remote Docker builder
  SSH authentication: `Permission denied (publickey,password).`

No deployment or live connectivity check was performed. Backend enablement
flags remain false by default; deployments must enable the backends separately.

To repeat the chart render after dependencies are available, from this component:

```sh
helm template monitoring . --namespace monitoring \
  --set victoria-traces-cluster.enabled=true
```
