# VM

Run virtual machines.

## Tools

| Name     | Source                  | Description |
| -        | -                       | -           |
| KubeVirt | https://kubevirt.io/    | Manage containers as Kubernetes objects. |

## Create A VM

> [!NOTE]
> Cilium users must use legacy routing for internal networking (between cluster pods and services)
> Set `socketLB.hostNamespaceOnly=true` and `bpf.hostLegacyRouting=true` in `/var/lib/rancher/rke2/server/manifests/rke2-cilium-config.yaml`

Create the VM
```
cat << EOF | kubectl apply -f -
apiVersion: kubevirt.io/v1
kind: VirtualMachine
metadata:
  name: ubuntu-vm-1
  namespace: kubevirt
spec:
  running: true
  template:
    metadata:
      labels:
        kubevirt.io/domain: ubuntu-vm-1
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
              user: ubuntu
              password: password123
              chpasswd: { expire: False }
              ssh_pwauth: True
EOF
```

Connect to the VM

```
virtctl -n kubevirt console ubuntu-vm-1
```

Disconnect from the VM

```
Ctrl+]
```
