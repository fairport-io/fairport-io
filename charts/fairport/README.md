# Fairport Helm Chart

An extremely opinionated full stack platform including everything from bare-metal provisioning to AI inference/training and everything in between.  Simple enough to be installed and managed by a single person, powerful enough to support thousdands of machines, gpus, and developers.

## Install

> [!NOTE]
> Don't have a Kubernetes cluster?  No problem! `curl https://get.fairport.io | sudo bash -`

> [!NOTE]
> A list of different versions you can install: https://github.com/fairport-io/fairport-io/releases/

> [!NOTE]
> The following command will install the latest released version (use specific versions by adding the `--version` flag)

```shell
helm upgrade --namespace fairport --create-namespace --install fairport oci://gcr.io/fairport-io/fairport
```

## Delete

```shell
helm delete --namespace fairport fairport
```

## Default Features

| Category                             | Default Status | Applicaiton & Documentation                                         | Summary |
| ---                                  | ---            | ---                                                                 | ---           |
| [Provisioning](#provisioning) 🛠️     | ✅ Enabled     | [tinkerbell](../provisioning/README.md)                             | Installs and manages operating systems on bare metal and/or virtual machines |
| [Storage](#storage) 💾               | ✅ Enabled     | [openebs](../openebs/README.md)                                     | Provisions and manages block storage within a Kubernetes cluster |
| [Storage](#storage) 💾               | ❌ Disabled    | [seaweedfs](../seaweedfs/README.md)                                 | Provisions and manages distributed file storage for Kubernetes (s3 compatible) |
| [Networking](#networking) 🌐         | ✅ Enabled     | [kube-vip](../kube-vip/README.md)                                   | Provides highly available cluster ingress and east-west routing |
| [Networking](#networking) 🌐         | ✅ Enabled     | `cilium`                                                            | High performance network CNI providing encryption-in-transit, network policies, service mesh, and ingress/egress gateways |
| [Networking](#networking) 🌐         | ✅ Enabled     | `traefik`                                                           | Provides TLS-enabled ingress and API gateway for Kubernetes clusters if Cilium cannot be used |
| [Monitoring](#monitoring) 📊         | ✅ Enabled     | [kube-prometheus-stack](../monitoring/README.md)                    | Metric collector and database with service-discovery, visualization, and alerting components |
| [Monitoring](#monitoring) 📊         | ✅ Enabled     | [victoria-logs-cluster](../monitoring/README.md)                    | Log aggregation and analysis platform with service-discovery, visualization, and alerting components |
| [Monitoring](#monitoring) 📊         | ✅ Enabled     | [victoria-traces-cluster](../monitoring/README.md)                  | Distributed tracing platform with service-discovery, visualization, and alerting components |
| [Job Scheduling](#job-scheduling) ⏱️ | ✅ Enabled     | [slurm](../slurm/README.md)                                         | HPC job scheduler |
| [Job Scheduling](#job-scheduling) ⏱️ | ✅ Enabled     | [slurm-operator](../slurm-operator/README.md)                       | HPC job scheduler component |
| [Job Scheduling](#job-scheduling) ⏱️ | ✅ Enabled     | [kueue](../kueue/README.md)                                         | Kubernetes native job scheduler extension |
| [Access Control](#access-control) 🔐 | ✅ Enabled     | [rancher](../rancher/README.md)                                     | User authentication and authorization with UI and API components |
| [Access Control](#access-control) 🔐 | ✅ Enabled     | [kyverno](../kyverno/README.md)                                     | Allows creation of policies to manage user and application access with fine-grained scopes |
| [Certificate Management](#certs)  🔏 | ✅ Enabled     | [cert-manager](../cert-manager/README.md)                           | Manages and generates certificates for applications (internal or external with providers like LetsEncrypt) |
| [Inference](#inference) 🤖           | ✅ Enabled     | [kubeai](../kubeai/README.md)                                       | Extremely simple inference solution capable of running backends like vllm, whisper, ollama |
| [Inference](#inference) 🤖           | ❌ Disabled    | [production-stack-operator](../production-stack-operator/README.md) | Industry standard backend for VLLM with distributed kv cacheing and intelligent queueing and routing |
| [Inference](#inference) 🤖           | ❌ Disabled    | [bifrost](../bifrost/README.md)                                     | Inference router with user management, rate limiting, virtual keys, and budgets |
| [Inference](#inference) 🤖           | ❌ Disabled    | [mpi-operator](../mpi-operator/README.md)                           | Distributed inference framework for running workloads across nodes |
| [Training](#training) 🏋️             | ✅ Enabled     | [slurm](../slurm/README.md)                                         | HPC job scheduler |
| [Training](#training) 🏋️             | ✅ Enabled     | [slurm-operator](../slurm-operator/README.md)                       | HPC job scheduler component |
| [Training](#training) 🏋️             | ✅ Enabled     | [kueue](../kueue/README.md)                                         | Kubernetes native job scheduler extension |
| [Training](#training) 🏋️             | ❌ Disabled    | [mpi-operator](../mpi-operator/README.md)                           | Distributed inference framework for running workloads across nodes |
| [GPU](#gpu) 🚀                       | ✅ Enabled     | [nvidia-gpu-operator](../nvidia-gpu-operator/README.md)             | Installs, manages, and updates nvidia components (device plugin, exporter, etc.) |
| [GPU](#gpu) 🚀                       | ❌ Disabled    | [amd-gpu-operator](../amd-gpu-operator/README.md)                   | Installs, manages, and updates amd components (device plugin, exporter, etc.) |
| [Database](#database) 🗄️             | ✅ Enabled     | [cloudnative-pg](../cloudnative-pg/README.md)                       | A Kubernetes native implementation of Postgres with high availability and speed optimizations |
