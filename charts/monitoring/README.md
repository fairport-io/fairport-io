# monitoring

Helm umbrella chart that bundles [kube-prometheus-stack](https://github.com/prometheus-community/helm-charts/tree/main/charts/kube-prometheus-stack) (Prometheus + Alertmanager + Grafana) along with VictoriaLogs and VictoriaTraces clusters for comprehensive metrics, logging, and tracing observability.

## kube-prometheus-stack

The industry standard for metrics collection and alert routing. It includes a Time Series Database (TSDB), service discovery, alert routing, high availability, and visualization (both Prometheus itself and Grafana).

```
+--------------------------+    +--------------------------+
| Node 1: Pod A / Node Exp |    | Node 2: Pod B / Node Exp |
+--------------------------+    +--------------------------+
             \                                /
              \______( Scrape Metrics )______/
                             |
                             v
            +----------------------------------+
            |       PROMETHEUS (HA PAIR)       |
            |  +------------+  +------------+  |
            |  |   Prom 1   |  |   Prom 2   |  |
            |  |   (TSDB)   |  |   (TSDB)   |  |
            |  +------------+  +------------+  |
            +----------------------------------+
              /              |              \
     (Alerts) /              | (Query)       \ (Remote Write)
            v                v                v
      +--------------+  +--------------+  +--------------+
      | Alertmanager |  | Grafana Pod  |  | Remote-Write |
      | (Slack / PD) |  | (Dashboards) |  | (Thanos/Ctx) |
      +--------------+  +--------------+  +--------------+
                             |
                             v
                      +--------------+
                      | Your Browser |
                      +--------------+
```

## victoria-logs-cluster

An ultra-scalable, low-resource log management and analytics solution. In this umbrella chart, it is packaged as a high-availability cluster using three distinct microservices to scale ingestion, storage, and querying independently:

- **`vlinsert`**: Ingestion microservice. Receives log streams, parses them, and distributes them to storage nodes. Formatted to run with 2 replicas and hard pod anti-affinity.
- **`vlstorage`**: Storage backend. Stores the log data securely with standard OpenEBS hostpath persistent volumes (10Gi requested per replica) and compressed column-oriented storage. Handles retention limits (2 hours by default).
- **`vlselect`**: Query engine. Fetches logs from storage nodes and computes aggregations for dashboards.
- **Vector Agent**: Bundled as a local logging daemonset. It runs on every Kubernetes node, auto-discovers and tails pod log files, structures the logs into JSON, and stream-forwards them to `vlinsert`.

```
+--------------------------+    +--------------------------+
| Node 1: Pods (App Logs)  |    | Node 2: Pods (App Logs)  |
+--------------------------+    +--------------------------+
             |                                |
   (Read stdout/stderr)             (Read stdout/stderr)
             v                                v
+--------------------------+    +--------------------------+
| Vector DaemonSet Pod 1   |    | Vector DaemonSet Pod 2   |
+--------------------------+    +--------------------------+
             \                                /
              \______( Forward Logs )________/
                             |
                             v
            +----------------------------------+
            |      vlinsert (HA INGEST)        |
            |  +------------+  +------------+  |
            |  | vlinsert 1 |  | vlinsert 2 |  |
            |  +------------+  +------------+  |
            +----------------------------------+
                             |
                   (Store Compressed Logs)
                             v
            +----------------------------------+
            |      vlstorage (HA STORAGE)      |
            |  +------------+  +------------+  |
            |  |vlstorage 1 |  |vlstorage 2 |  |
            |  +------------+  +------------+  |
            +----------------------------------+
                             ^
                   (Read Logs for Query)
                             |
            +----------------------------------+
            |       vlselect (HA QUERY)        |
            |  +------------+  +------------+  |
            |  | vlselect 1 |  | vlselect 2 |  |
            |  +------------+  +------------+  |
            +----------------------------------+
                             |
                    (LogQL/Query API)
                             v
                      +--------------+
                      | Grafana Pod  |
                      | (Dashboards) |
                      +--------------+
                             |
                             v
                      +--------------+
                      | Your Browser |
                      +--------------+
```

## victoria-traces-cluster

A distributed tracing backend designed for high ingestion performance, low storage overhead, and Jaeger-compatible query support. Like VictoriaLogs, it decouples trace processing into a microservice-based cluster:

- **`vtinsert`**: Ingestion endpoint. Receives traces from application instrumentation (e.g., OpenTelemetry SDKs, Jaeger/Zipkin clients) over standard protocols and streams them to the storage nodes. Formatted to run with 2 replicas and hard pod anti-affinity.
- **`vtstorage`**: Storage backend. Stores structured trace spans in highly compressed columnar formats using OpenEBS hostpath volumes (10Gi requested per replica).
- **`vtselect`**: Query engine. Provides a standard Jaeger-compatible Query API so Grafana or Jaeger UI can seamlessly query and visualize transaction timelines and service dependency graphs.

```
+----------------------------------------------------------+
|                  APPLICATIONS / PODS                     |
|  (OpenTelemetry SDKs, Jaeger Client, Zipkin Client, etc) |
+----------------------------------------------------------+
             \                                /
              \______( Push Traces )_________/
                             |
                             v
            +----------------------------------+
            |      vtinsert (HA INGEST)        |
            |  +------------+  +------------+  |
            |  | vtinsert 1 |  | vtinsert 2 |  |
            |  +------------+  +------------+  |
            +----------------------------------+
                             |
                   (Store Structured Spans)
                             v
            +----------------------------------+
            |      vtstorage (HA STORAGE)      |
            |  +------------+  +------------+  |
            |  |vtstorage 1 |  |vtstorage 2 |  |
            |  +------------+  +------------+  |
            +----------------------------------+
                             ^
                   (Read Traces for Query)
                             |
            +----------------------------------+
            |       vtselect (HA QUERY)        |
            |  +------------+  +------------+  |
            |  | vtselect 1 |  | vtselect 2 |  |
            |  +------------+  +------------+  |
            +----------------------------------+
                             |
                     (Jaeger Query API)
                             v
                      +--------------+
                      | Grafana Pod  |
                      | (Dashboards) |
                      +--------------+
                             |
                             v
                      +--------------+
                      | Your Browser |
                      +--------------+
```

## Configuration & Quick Start

By default, only the core metrics stack is enabled:
- **kube-prometheus-stack**: Enabled (`true`)
- **victoria-logs-cluster**: Disabled (`false`)
- **victoria-traces-cluster**: Disabled (`false`)

### Enabling Logs and Traces

To enable comprehensive logging and tracing, update your `values.yaml` or pass the following flags during installation:

```bash
helm upgrade --install monitoring ./charts/monitoring \
  --set victoria-logs-cluster.enabled=true \
  --set victoria-traces-cluster.enabled=true
```

### Persistent Volume Requirements

This chart uses OpenEBS hostpath provisioners (`openebs-hostpath`) for high-speed local storage but can be modified according to requirements:
- **Prometheus**: 2x 5Gi PVCs
- **Alertmanager**: 2x 2Gi PVCs
- **VictoriaLogs Storage**: 2x 10Gi PVCs
- **VictoriaTraces Storage**: 2x 10Gi PVCs

Make sure your Kubernetes cluster has OpenEBS or another compatible storage class configured before enabling the storage-backed services.
=======
The industry standrd metrics 


```
===================================================================================
                       KUBE-PROMETHEUS-STACK (HA MODE)
===================================================================================

 [ NODE 1 ]                                       [ NODE 2 ]
 +-----------------------------------+            +-----------------------------------+
 | [Pod A] -> App Exporter (Metrics) |            | [Pod B] -> App Exporter (Metrics) |
 |                                   |            |                                   |
 | Node Exporter (Server Metrics)    |            | Node Exporter (Server Metrics)    |
 +-----------------------------------+            +-----------------------------------+
                    \_______________________________/
                     \                             /
                      \   Both replicas pull      /
     [ NODE 3 ]        \  identical data twice   /          [ NODE 4 ]
     +-----------------------+              +------------------------+
     |  PROMETHEUS SERVER #1 |              |   PROMETHEUS SERVER #2 |
     |      (Replica A)      |              |      (Replica B)       |
     +-----------------------+              +------------------------+
        /                 \                    /                 \
       /                    \                /                     \
      /                       \            /                         \
   +-------------------------------------------------------------------------+
   |       ALERTS       |       REMOTE WRITES       |     VISUALIZATIONS     |
   +-------------------------------------------------------------------------+
   |    Alertmanager    |  Data Dog, Thanos/Cortex  |        Grafana         |
   +-------------------------------------------------------------------------+
   | Slack/Pagerduty    |         Browser           |         Browser        |
   +-------------------------------------------------------------------------+
```