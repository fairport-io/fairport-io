# mpi-operator

Helm wrapper for the [Kubeflow MPI Operator](https://github.com/kubeflow/mpi-operator) enabling distributed training workloads on Kubernetes.

## Overview

This chart installs the MPI Operator (v0.8.0) which manages `MPIJob` custom resources for running allreduce-style distributed training (Horovod, TensorFlow, PyTorch) on Kubernetes.

## Architecture

- **CRDs:** `mpijobs.kubeflow.org` (v2beta1)
- **RBAC:** Dedicated ServiceAccount, ClusterRole, and ClusterRoleBinding
- **Controller:** Single-replica Deployment of `mpioperator/mpi-operator:0.8.0`

## Usage

Deploy to any namespace:

```bash
helm install mpi-operator oci://gcr.io/fairport-io/charts/mpi-operator --namespace mpi-operator --create-namespace
```

### Configuration

| Parameter | Description | Default |
|-----------|-------------|---------|
| `mpi-operator.enabled` | Enable the MPI Operator | `true` |
| `mpi-operator.image` | Operator image | `mpioperator/mpi-operator:0.8.0` |
| `mpi-operator.replicaCount` | Number of replicas | `1` |
| `mpi-operator.lockNamespace` | Leader election namespace (defaults to `.Release.Namespace`) | `""` |
| `mpi-operator.serviceAccount.create` | Create ServiceAccount | `true` |
| `mpi-operator.serviceAccount.name` | ServiceAccount name | `mpi-operator` |
| `mpi-operator.nodeSelector` | Node selector | `{}` |
| `mpi-operator.tolerations` | Tolerations | `[]` |
| `mpi-operator.affinity` | Affinity rules | `{}` |
| `mpi-operator.resources` | Container resources | `{}` |

### Creating an MPI Job

```yaml
apiVersion: kubeflow.org/v2beta1
kind: MPIJob
metadata:
  name: tensorflow-benchmarks
spec:
  slotsPerWorker: 1
  runPolicy:
    cleanPodPolicy: Running
  mpiReplicaSpecs:
    Launcher:
      replicas: 1
      template:
        spec:
          containers:
          - image: mpioperator/tensorflow-benchmarks:latest
            name: mpi-launcher
    Worker:
      replicas: 2
      template:
        spec:
          containers:
          - image: mpioperator/tensorflow-benchmarks:latest
            name: mpi-worker
```

