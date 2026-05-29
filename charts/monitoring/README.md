# monitoring

Helm umbrella chart that bundles [kube-prometheus-stack](https://github.com/prometheus-community/helm-charts/tree/main/charts/kube-prometheus-stack) (Prometheus + Alertmanager + Grafana) along with VictoriaLogs and VictoriaTraces clusters for comprehensive metrics, logging, and tracing observability.

> [!NOTE]
> By default only metrics (kube-prometheus-stack) is be enabled because it's storage footprint is orders of magnitude less than what's required for logs and traces.
> To enable logging and tracing, first ensure you have enough storage, then update your `values.yaml` or pass the following flags during helm installation:
> ```bash
> --set victoria-logs-cluster.enabled=true --set victoria-traces-cluster.enabled=true
> ```


> [!NOTE]
> This chart uses OpenEBS hostpath provisioners (`openebs-hostpath`) which are bundled with the Fairport Helm Chart by default for high-speed local storage but can be modified according to requirements (like using another storage class or adjusting volume size).  The adjustments can be made based on the official helm chart: [kube-prometheus-stack](https://github.com/prometheus-community/helm-charts/tree/main/charts/kube-prometheus-stack)

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

