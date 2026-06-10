# system-upgrade-controller

Helm chart for Rancher's System Upgrade Controller to coordinate and automate rolling upgrades of Kubernetes nodes.

## How to Trigger a System Upgrade (RKE2)

To perform a rolling upgrade of your cluster nodes, you define `Plan` custom resources. It is recommended to upgrade control-plane (server) nodes first sequentially, and then upgrade agent (worker) nodes.

## Upgrade Server Nodes (Control Plane)

Create the server plan:

```shell
cat << EOF > server-plan.yaml
apiVersion: upgrade.cattle.io/v1
kind: Plan
metadata:
  name: rke2-server-plan
  namespace: system-upgrade
spec:
  version: $VERSION                         # Set the desired RKE2 version for the nodes, e.g. "v1.24.8+rke2r1"
  concurrency: 1                            # Leave this as 1 for servers
  serviceAccountName: system-upgrade
  nodeSelector:
    matchExpressions:
      - key: node-role.kubernetes.io/control-plane
        operator: In
        values: ["true"]
  drain:
    force: true
    ignoreDaemonSets: true
    deleteLocalData: true
    disableEviction: true
    timeout: 185s                           # Ensure your applications can shut down within this time, adjust if necessary
  upgrade:
    image: rancher/rke2-upgrade
    command:                                # This is specifically for Ubuntu nodes, may be different for other OS types
     - /bin/sh
     - -c
     - |
        mkdir -p /host/usr/local/lib/systemd/system && exec /bin/upgrade.sh upgrade
EOF
```

Apply the server plan:
```shell
fpk apply -f server-plan.yaml
```

## Upgrade Agent Nodes (Workers)

Once the server nodes have completed upgrading, create the agent plan:

```shell
cat << EOF > agent-plan.yaml
apiVersion: upgrade.cattle.io/v1
kind: Plan
metadata:
  name: rke2-agent-plan
  namespace: system-upgrade
spec:
  version: $VERSION                         # Set the desired RKE2 version for the nodes, e.g. "v1.24.8+rke2r1"
  prepare:
    image: rancher/rke2-upgrade
    args: ["prepare", "rke2-server-plan"]   # Wait for server plan to finish
  concurrency: 1                            # Leave as 1 for safety, can be increased for larger clusters
  serviceAccountName: system-upgrade
  nodeSelector:
    matchExpressions:
      - key: node-role.kubernetes.io/control-plane
        operator: DoesNotExist
  drain:
    force: true
    ignoreDaemonSets: true
    deleteLocalData: true
    disableEviction: true
    timeout: 185s                           # Ensure your applications can shut down within this time, adjust if necessary
  upgrade:
    image: rancher/rke2-upgrade
    command:                                # This is specifically for Ubuntu nodes, may be different for other OS types
     - /bin/sh
     - -c
     - |
        mkdir -p /host/usr/local/lib/systemd/system && exec /bin/upgrade.sh upgrade
EOF
```

Apply the agent plan
```shell
fpk apply -f agent-plan.yaml
```

### Monitoring the Upgrade

You can track the progress of the upgrade by inspecting the plan's status or watching the upgrade pods:
```shell
# Check status of the plans
fpk get plans -n system-upgrade

# Watch the upgrade pods executing on the nodes
fpk get pods -n system-upgrade -w
```
