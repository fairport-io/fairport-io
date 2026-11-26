# nvidia-gpu-operator

Helm wrapper for the [NVIDIA GPU Operator](https://docs.nvidia.com/datacenter/cloud-native/gpu-operator) to provision and manage NVIDIA GPUs in Kubernetes (drivers, device plugin, monitoring, time-slicing, MIG).

Fresh installs use `GPUCluster` for Dynamic Resource Allocation (DRA). GPU nodes need a CDI-enabled container runtime. Workloads can use `ResourceClaim`s or keep using `nvidia.com/gpu` requests on Kubernetes 1.36 and later through the Fairport `DeviceClass`.

The Fairport installer defaults to `ClusterPolicy` on existing device-plugin clusters and on Kubernetes versions below 1.36. For a direct Helm upgrade of a device-plugin cluster, set the following values. [NVIDIA DRA guide](https://docs.nvidia.com/datacenter/cloud-native/gpu-operator/26.7/dra-intro-install.html)

```yaml
nvidia-gpu-operator:
  clusterPolicy:
    deployCR: true
  gpuCluster:
    deployCR: false
  devicePlugin:
    enabled: true
  driver:
    nvidiaDriverCRD:
      enabled: false
    manager:
      version: v0.12.1
```
