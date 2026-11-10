# kubevirt

Runs virtual machines next to containers: [KubeVirt](https://kubevirt.io) v1.9.1, plus [CDI](https://github.com/kubevirt/containerized-data-importer) v1.66.1 to import VM disk images. VMs can get whole GPUs and other accelerators through PCI passthrough.

## Usage - For Administrators

Fairport skips this release unless the `fairport-installer-values` ConfigMap turns it on:

```yaml
kubevirt:
  enabled: true
```

Settings from [values.yaml](values.yaml) go under a second `kubevirt:` key, like `kubevirt.kubevirt.configuration`.

Outside fairport, install it into the `kubevirt` namespace:

```shell
helm install kubevirt oci://ghcr.io/fairport-io/charts/kubevirt --namespace kubevirt --create-namespace
```

On clusters that enforce Pod Security, label that namespace `pod-security.kubernetes.io/enforce=privileged`; virt-handler needs it.

### Accelerators

A VM gets each device whole, through VFIO. A device type needs two things: bound to `vfio-pci` on its nodes, and listed in `configuration.permittedHostDevices` ([values.yaml](values.yaml) has examples).

- **NVIDIA GPUs**: the GPU operator binds them. Turn on its VM mode with `nvidia-gpu-operator.nvidia-gpu-operator.sandboxWorkloads.enabled: true` (it may restart GPU operator pods, so pick a quiet time), then label each VM node `nvidia.com/gpu.workload.config=vm-passthrough`. That node's GPUs then serve only VMs, under the resource names shown by `kubectl describe node`.
- **Everything else** (d-matrix AIPs, other accelerators, RDMA NICs or their SR-IOV virtual functions): bind them with kernel arguments when imaging the node, see [provisioning](../provisioning/README.md#vm-passthrough).

A VM asks for a device by its resource name:

```yaml
spec:
  template:
    spec:
      domain:
        devices:
          hostDevices:
          - name: accel0
            deviceName: example.com/accelerator
```

### Confidential VMs

Each VM opts in. AMD SEV and SEV-SNP need no cluster setting: on nodes whose CPU, firmware and kernel have them enabled, add `launchSecurity: {snp: {}}` under the VM's `domain`. Intel TDX is alpha in KubeVirt 1.9, so add `WorkloadEncryptionTDX` to the feature gates first.

### Security

Enforced now:

- VMs only get devices listed in `permittedHostDevices`.
- Features that give a VM a way into its host stay off (Sidecar, HostDisk, DownwardMetrics, Root), and each VM's process runs as non-root under KubeVirt's seccomp profile.
- VM permissions come only from explicit RoleBindings, not the default admin, edit and view roles.
- KubeVirt and CDI refuse to be removed while VMs or DataVolumes exist, and uninstalling the release leaves their CRDs, custom resources and the `cdi` namespace.

Limits of passthrough:

- The IOMMU keeps a device's DMA inside its VM only if the device sits alone in its IOMMU group; devices sharing a group go to the same VM.
- A tenant controls the device while it has it. Use accelerators that only accept signed firmware, and reset devices between tenants, so one tenant can't leave something behind for the next.
- VMs with passthrough devices can't live-migrate.

Still to come for tenant isolation: tenant namespaces with default-deny network policies (VMs reach the SSH bastion and the internet, not cluster services or nodes), resource quotas, and admission rules.

### Networking

VMs use the pod network, so Cilium's network policies apply to them. For VMs to reach cluster Services, DNS included, Cilium needs `socketLB.hostNamespaceOnly: true` (see [VM.md](../fairport/docs/VM.md)). RDMA traffic over a passed-through NIC bypasses Cilium, so isolate it on the fabric (VLANs, or InfiniBand partition keys).

### Storage

VM disks use the default StorageClass, openebs hostpath. Each VM stays on the node holding its disk, can't live-migrate, and shuts down when that node drains.

## Updating KubeVirt or CDI

`files/` and `crds/` hold upstream's operator manifests, split so Helm installs the CRDs first:

```shell
KUBEVIRT=v1.9.1 CDI=v1.66.1
curl -sSfLo /tmp/kubevirt.yaml https://github.com/kubevirt/kubevirt/releases/download/$KUBEVIRT/kubevirt-operator.yaml
curl -sSfLo /tmp/cdi.yaml https://github.com/kubevirt/containerized-data-importer/releases/download/$CDI/cdi-operator.yaml
for n in kubevirt cdi; do
  yq 'select(.kind == "CustomResourceDefinition")' /tmp/$n.yaml > crds/$n.yaml
  yq 'select(.kind != "CustomResourceDefinition" and .kind != "Namespace")' /tmp/$n.yaml > files/$n-operator.yaml
done
```

Put back each file's one-line header comment, then bump [VERSION](VERSION) and the kubevirt `version` in [fairport's values.yaml](../fairport/values.yaml).

Helm installs `crds/` once and never upgrades it. If a new version changes the CRDs, existing clusters keep the old ones, so that rollout needs a step that applies them (`kubectl apply --server-side -f crds/`).
