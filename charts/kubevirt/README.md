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

A VM gets each device whole, through VFIO, from a node where the device is bound to `vfio-pci`. `permittedHostDevices` is unset, so a VM can get any device its node offers.

- **NVIDIA GPUs**, every model: label each node that should serve VMs.

  ```shell
  kubectl label node <node> fairport.io/vm=true nvidia.com/gpu.deploy.operands=false
  ```

  The second label makes the GPU operator leave the node alone; every other node keeps serving containers and keeps its automatic driver upgrades. On labeled nodes, this chart binds every NVIDIA GPU to `vfio-pci` with NVIDIA's own vfio-manager, then NVIDIA's device plugin offers each one under its model name, like `nvidia.com/GH100_H100_SXM5_80GB`. On HGX boards it binds the NVSwitches too, so one VM can take the whole board (see the example). If a GPU stays with the host driver, reboot the node. To give a node back to containers, move its VMs off, remove both labels, and reboot it. Leave the GPU operator's own VM mode (`sandboxWorkloads`) off: it would stop automatic driver upgrades on every GPU node.
- **Everything else** (any other accelerator, RDMA NICs or their SR-IOV virtual functions): bind them with kernel arguments when imaging the node (see [provisioning](../provisioning/README.md#vm-passthrough)), then list them in `configuration.permittedHostDevices` so KubeVirt offers them. Any list is an allowlist for every device, so list the cluster's NVIDIA GPUs there too, with `externalResourceProvider: true` ([values.yaml](values.yaml) shows the format).

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

- Your customer decides which devices each VM gets; tenants never write VM specs. KubeVirt passes through any device a node offers unless `permittedHostDevices` is set, which makes it an allowlist.
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

Put VM disks on openebs hostpath by naming it (`storageClassName: openebs-hostpath`); fairport sets no default StorageClass. Each VM stays on the node holding its disk, can't live-migrate, and shuts down when that node drains.

CDI reserves each disk's full size when it creates it (`preallocation: true`), so a node's disk is never overcommitted and one tenant can't fill space another was promised. That covers every disk made as a DataVolume, like the one in the example below; imports take longer, and there's no thin provisioning.

## Example - A Tenant VM With An Accelerator

Tenant `tenant-a` gets one VM with 8 cores, 32 GiB of memory, a 50 GiB Ubuntu 24.04 disk and one accelerator, reached over SSH through the bastion. Swap `1234:5678` for your device's PCI ID (`lspci -nn`), and `example.com/accelerator` for a resource name of your choosing.

**1. Prepare the node.** Image it with the IOMMU on and the accelerator bound to `vfio-pci` (see [provisioning](../provisioning/README.md#vm-passthrough)). On the node, `lspci -nnk -d 1234:5678` should show `Kernel driver in use: vfio-pci`.

**2. Turn on KubeVirt and list the device.** Run `kubectl -n fairport edit configmap fairport-installer-values` and add this to its `values.yaml`, keeping anything already there:

```yaml
kubevirt:
  enabled: true
  kubevirt:
    configuration:
      permittedHostDevices:
        pciHostDevices:
        - pciVendorSelector: "1234:5678"
          resourceName: example.com/accelerator
```

Listing a device makes `permittedHostDevices` an allowlist for every device, so if VMs on this cluster also get NVIDIA GPUs, list those too (see the NVIDIA steps below).

On a cluster installed with `FAIRPORT_CONFIG_FILE`, add it to that file and under `values:` in the `fairport` HelmChart in `kube-system` instead; the installer can't combine the two sources yet.

KubeVirt and CDI should report `Deployed`, and the node should offer the device:

```shell
kubectl -n kubevirt get kubevirt kubevirt -o jsonpath='{.status.phase}{"\n"}'
kubectl get cdi cdi -o jsonpath='{.status.phase}{"\n"}'
kubectl get node <node> -o jsonpath='{.status.allocatable.example\.com/accelerator}{"\n"}'
```

**3. Create the VM.**

```shell
kubectl create namespace tenant-a
kubectl apply -f - << EOF
apiVersion: kubevirt.io/v1
kind: VirtualMachine
metadata:
  name: vm-1
  namespace: tenant-a
spec:
  runStrategy: Always
  dataVolumeTemplates:
  - metadata:
      name: vm-1-root
    spec:
      source:
        http:
          # Air-gapped clusters: point this at an internal mirror
          url: https://cloud-images.ubuntu.com/noble/current/noble-server-cloudimg-amd64.img
      storage:
        storageClassName: openebs-hostpath
        accessModes: [ReadWriteOnce]
        volumeMode: Filesystem
        resources:
          requests:
            storage: 50Gi
  template:
    spec:
      domain:
        cpu:
          cores: 8
        resources:
          requests:
            memory: 32Gi
        firmware:
          bootloader:
            # UEFI maps the large memory windows that GPUs and accelerators expose
            efi:
              secureBoot: false
        devices:
          disks:
          - name: root
            disk: {bus: virtio}
          - name: cloudinit
            disk: {bus: virtio}
          interfaces:
          # NAT behind the pod's IP; KubeVirt's default is bridge
          - name: default
            masquerade: {}
          hostDevices:
          - name: accel0
            deviceName: example.com/accelerator
      networks:
      - name: default
        pod: {}
      volumes:
      - name: root
        dataVolume:
          name: vm-1-root
      - name: cloudinit
        cloudInitNoCloud:
          userData: |
            #cloud-config
            ssh_authorized_keys:
            - ssh-ed25519 AAAA... tenant@laptop
EOF
```

**4. Check it and connect.** The disk imports first, then the VM boots on the node with the device:

```shell
kubectl -n tenant-a get datavolume,vm,vmi
kubectl -n tenant-a get vmi vm-1 -o jsonpath='{.status.interfaces[0].ipAddress}{"\n"}'
```

The tenant connects from the bastion with `ssh ubuntu@<that address>`. Admins can also use the serial console with `virtctl -n tenant-a console vm-1`, and leave it with `Ctrl+]`.

**For an NVIDIA GPU instead,** the node still needs its IOMMU on (step 1) but nothing bound by kernel arguments. Leave `permittedHostDevices` out of step 2, then:

1. Label the node: `kubectl label node <node> fairport.io/vm=true nvidia.com/gpu.deploy.operands=false`.
2. Read the GPU's resource name off the node: `kubectl get node <node> -o jsonpath='{.status.allocatable}'` shows names like `nvidia.com/GH100_H100_SXM5_80GB`. Nothing needs permitting while `permittedHostDevices` is unset. If the cluster lists other accelerators there, add the GPU to that list too:

   ```yaml
   - pciVendorSelector: "10DE:2330"
     resourceName: nvidia.com/GH100_H100_SXM5_80GB
     externalResourceProvider: true
   ```

3. In the VM, replace `hostDevices` with:

   ```yaml
   gpus:
   - name: gpu0
     deviceName: nvidia.com/GH100_H100_SXM5_80GB
   ```

**For a whole HGX board,** give one VM every GPU and NVSwitch on the node, and let the VM run NVIDIA Fabric Manager, which wires up NVLink between the GPUs:

1. Label the node as above. Its NVSwitches get bound along with its GPUs and show up next to them in `kubectl get node <node> -o jsonpath='{.status.allocatable}'`, like `nvidia.com/GH100_H100_NVSWITCH: 4`.
2. In the example VM, ask for all of them, one entry per device, and size `cpu` and `memory` to most of the node:

   ```yaml
   gpus:
   - {name: gpu0, deviceName: nvidia.com/GH100_H100_SXM5_80GB}
   - {name: gpu1, deviceName: nvidia.com/GH100_H100_SXM5_80GB}
   - {name: gpu2, deviceName: nvidia.com/GH100_H100_SXM5_80GB}
   - {name: gpu3, deviceName: nvidia.com/GH100_H100_SXM5_80GB}
   - {name: gpu4, deviceName: nvidia.com/GH100_H100_SXM5_80GB}
   - {name: gpu5, deviceName: nvidia.com/GH100_H100_SXM5_80GB}
   - {name: gpu6, deviceName: nvidia.com/GH100_H100_SXM5_80GB}
   - {name: gpu7, deviceName: nvidia.com/GH100_H100_SXM5_80GB}
   hostDevices:
   - {name: nvswitch0, deviceName: nvidia.com/GH100_H100_NVSWITCH}
   - {name: nvswitch1, deviceName: nvidia.com/GH100_H100_NVSWITCH}
   - {name: nvswitch2, deviceName: nvidia.com/GH100_H100_NVSWITCH}
   - {name: nvswitch3, deviceName: nvidia.com/GH100_H100_NVSWITCH}
   ```

3. The VM's image needs NVIDIA's driver plus the Fabric Manager package of the same version, with the `nvidia-fabricmanager` service running. Until it runs, CUDA reports the system as not yet initialized.

The board belongs to one tenant at a time. Splitting it between VMs with NVLink inside each needs Fabric Manager on the host, which this chart doesn't do yet.

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
