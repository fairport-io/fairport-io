# monitoring

Helm umbrella chart that bundles [kube-prometheus-stack](https://github.com/prometheus-community/helm-charts/tree/main/charts/kube-prometheus-stack) (Prometheus + Alertmanager + Grafana) along with VictoriaLogs and VictoriaTraces clusters for comprehensive metrics, logging, and tracing observability.

## kube-prometheus-stack

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
