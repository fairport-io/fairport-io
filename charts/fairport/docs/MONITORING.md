# Monitoring

The Fairport chart includes a robust monitoring stack to help visualize, debug, triage, and alert on your workloads and cluster health.  It leverages Prometheus for metrics collection, Open Telemetry for log and trace collections, and Opensearch for storage.

## Tools

| Name           | Source                    | Description |
| -              | -                         | -           |
| Prometheus     | https://prometheus.io/    | Prometheus is used to scrape and collect metrics from the cluster and workloads running within the cluster.  It provides a powerful query language (PromQL) to help build dashboards and alerts. |
| Open Telemetry | https://opentelemetry.io/ | Open Telemetry is used to collect logs and traces from the cluster and workloads running within the cluster.  It provides a unified way to collect and export telemetry data. |
| Opensearch     | https://opensearch.org/   | Opensearch is used to store and index logs and traces collected by Open Telemetry.  It provides a powerful search and analytics engine to help visualize and analyze telemetry data. |