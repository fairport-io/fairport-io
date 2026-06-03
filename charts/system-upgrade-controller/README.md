# system-upgrade-controller

Helm chart for Rancher's System Upgrade Controller to coordinate and automate rolling upgrades of Kubernetes nodes.

## How to Trigger a System Upgrade (RKE2)

To perform a rolling upgrade of your cluster nodes, you define `Plan` custom resources. It is recommended to upgrade control-plane (server) nodes first sequentially, and then upgrade agent (worker) nodes.

### 1. Upgrade Server Nodes (Control Plane)

Create a file named `upgrade-servers.yaml` with the target `version` (e.g., `v1.36.1+rke2r2`):

```yaml
apiVersion: upgrade.cattle.io/v1
kind: Plan
metadata:
  name: rke2-server-plan
  namespace: system-upgrade
spec:
  version: v1.36.1+rke2r2  # Target RKE2 version
  concurrency: 1          # Upgrade servers one-by-one
  nodeSelector:
    matchExpressions:
      - key: node-role.kubernetes.io/control-plane
        operator: In
        values: ["true"]
  drain:
    force: true
    ignoreDaemonSets: true
  upgrade:
    image: rancher/rke2-upgrade
```

Apply the plan to the cluster:
```shell
fpk apply -f upgrade-servers.yaml
```

### 2. Upgrade Agent Nodes (Workers)

Once the server nodes have completed upgrading, create `upgrade-agents.yaml`:

```yaml
apiVersion: upgrade.cattle.io/v1
kind: Plan
metadata:
  name: rke2-agent-plan
  namespace: system-upgrade
spec:
  version: v1.36.1+rke2r2  # Target RKE2 version
  prepare:
    image: rancher/rke2-upgrade
    args: ["prepare", "rke2-server-plan"]  # Wait for server plan to finish
  concurrency: 2                            # Upgrade up to 2 workers concurrently
  nodeSelector:
    matchExpressions:
      - key: node-role.kubernetes.io/control-plane
        operator: DoesNotExist
  drain:
    force: true
    ignoreDaemonSets: true
  upgrade:
    image: rancher/rke2-upgrade
```

Apply the plan:
```shell
fpk apply -f upgrade-agents.yaml
```

### Monitoring the Upgrade

You can track the progress of the upgrade by inspecting the plan's status or watching the upgrade pods:
```shell
# Check status of the plans
fpk get plans -n system-upgrade

# Watch the upgrade pods executing on the nodes
fpk get pods -n system-upgrade -w
```
