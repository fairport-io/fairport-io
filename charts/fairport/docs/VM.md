# VM

Run virtual machines next to containers. The [kubevirt](../../kubevirt/README.md) chart covers GPU and accelerator passthrough, confidential VMs, and security.

## Tools

| Name     | Source                                                 | Description |
| -        | -                                                      | -           |
| KubeVirt | https://kubevirt.io/                                   | Runs virtual machines as Kubernetes objects |
| CDI      | https://github.com/kubevirt/containerized-data-importer | Imports VM disk images into PVCs |

## Turn It On

In the `fairport-installer-values` ConfigMap:

```yaml
kubevirt:
  enabled: true
```

> [!NOTE]
> For VMs to reach cluster Services (DNS included), Cilium's socket-level load balancing has to stay out of pod namespaces.
> Add `socketLB: {hostNamespaceOnly: true}` to the `rke2-cilium` HelmChartConfig in `/var/lib/rancher/rke2/server/manifests/rke2-cilium-config.yaml`.
> VMs that only talk to the internet and the SSH bastion work without it.

## Create A VM

```
kubectl create namespace vms
cat << EOF | kubectl apply -f -
apiVersion: kubevirt.io/v1
kind: VirtualMachine
metadata:
  name: ubuntu-vm-1
  namespace: vms
spec:
  runStrategy: Always
  template:
    spec:
      domain:
        cpu:
          cores: 2
        resources:
          requests:
            memory: 2Gi
        devices:
          disks:
            - name: containerdisk
              disk: {bus: virtio}
            - name: cloudinit
              disk: {bus: virtio}
      volumes:
        - name: containerdisk
          containerDisk:
            image: quay.io/containerdisks/ubuntu:24.04
        - name: cloudinit
          cloudInitNoCloud:
            userData: |
              #cloud-config
              ssh_authorized_keys:
                - ssh-ed25519 AAAA... you@laptop
EOF
```

## Connect To The VM

Tenants come in through the SSH bastion. Admins can use the serial console:

```
virtctl -n vms console ubuntu-vm-1
```

Disconnect with `Ctrl+]`.
