# Fairport Helm Chart

An extremely opinionated full stack platform including everything from bare-metal provisioning to AI inference/training and everything in between.  Simple enough to be installed and managed by a single person, powerful enough to support thousdands of machines, gpus, and developers.

## Install

> [!NOTE]
> Don't have a Kubernetes cluster?  No problem! `curl https://get.fairport.io | sudo bash -`

> [!NOTE]
> The following command will install the latest release.  Get specific versions with: `gcloud artifacts docker images list us-docker.pkg.dev/fairport-io/gcr.io/fairport --include-tags`

```shell
helm upgrade --install fairport oci://gcr.io/fairport-io/fairport
```

## Delete

```shell
helm delete fairport
```

## Features

| Feature                | Documentation | Helm Charts |
| -                      | -                                                           | - |
| Provisioning           | [PROVISIONING.md](docs/PROVISIONING.md)                     | `tinkerbell` |
| Storage                | [STORAGE.md](docs/STORAGE.md)                               | `openebs`, `seaweedfs` |
| Networking             | [NETWORKING.md](docs/NETWORKING.md)                         | `kube-vip`, `cilium`, `traefik` |
| Monitoring             | [MONITORING.md](docs/MONITORING.md)                         | `kube-prometheus-stack`, `victoria-logs-cluster`, `victoria-traces-cluster` |
| Job Scheduling         | [JOB_SCHEDULING.md](docs/JOB_SCHEDULING.md)                 | `slurm`, `slurm-operator`, `kueue` |
| RBAC                   | [RBAC.md](docs/RBAC.md)                                     | `rancher`, `kyverno` |
| Certificate Management | [CERTIFICATE_MANAGEMENT.md](docs/CERTIFICATE_MANAGEMENT.md) | `cert-manager` |
| Inference              | [INFERENCE.md](docs/INFERENCE.md)                           | `kubeai`, `bifrost`, `anythingllm` |
| Training               | [TRAINING.md](docs/TRAINING.md)                             | `slurm`, `slurm-operator`, `kueue` |
| GPU                    | [GPU.md](docs/GPU.md)                                       | `nvidia-gpu-operator`, `amd-gpu-operator` |
| Database               | [DATABASE.md](docs/DATABASE.md)                             | `cloudnative-pg` |
| Air-Gap                | [AIR-GAP.md](docs/AIR-GAP.md)                               | *deployment mode, not a standalone chart* |

## Contributing

[CONTRIBUTING.md](docs/CONTRIBUTING.md)
