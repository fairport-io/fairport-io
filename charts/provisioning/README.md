# provisioning

Helm wrapper for [Tinkerbell](https://tinkerbell.org) that adds SSH key generation, OS image caching, and automated Tinkerbell workflow/template object management for bare-metal provisioning.

## Tinkerbell v0.26.0 upgrade

The wrapper keeps serving HookOS v0.11.1 from `os-image-cache`. Both upstream
artifact servers are disabled, including the newly enabled CaptainOS default,
so Smee continues requesting `vmlinuz-<arch>` and `initramfs-<arch>`.

WorkflowRuleSets and Templates are now updated in place on Helm install/upgrade.
For unchanged names, UIDs stay stable, preserving existing Workflows owned by a
WorkflowRuleSet. The object manager still resolves `$HOST_IP` in Template URLs.

[Upstream selection rules](https://github.com/tinkerbell/tinkerbell/blob/v0.26.0/docs/technical/AUTO_ENROLLMENT.md#choosing-between-matching-workflowrulesets)
choose the WorkflowRuleSet with the most matching rules, then break ties by
namespace and name in alphabetical order. List order and creation time do not
set priority. The shipped catch-all is named `zzz-default` so specific names like
`server-2404` sort before it. If you override the `workflows` list, rename your
catch-all there too and ensure it sorts after your specific workflows.

Unchanged names need no object migration. One installer Job applies all configured
objects, then removes installer-managed WorkflowRuleSets absent from `workflows`
in the release namespace. An empty list removes all installer-managed rule sets.
Cleanup only runs after every apply succeeds and uses `--cascade=orphan` to
preserve existing Workflows. Unlabeled rule sets remain untouched. Templates are
retained for Workflows that still reference them; remove obsolete Templates only
after those Workflows have finished.

## DHCP Configurations

### dnsmasq

```
# ==========================================
# 1. DHCP & Network Settings
# ==========================================
interface=eth0                        # Replace with your actual network interface (e.g., eno1, eth1)
bind-interfaces                       # Only listen on the specified interface
dhcp-range=10.1.1.100,10.1.1.200,12h  # The IP pool to hand out to bare-metal machines
dhcp-option=3,10.1.1.1                # Default Gateway / Router IP
dhcp-option=6,1.1.1.1,8.8.8.8         # DNS Servers

# ==========================================
# 2. Tinkerbell PXE Boot Process
# ==========================================

# Create a tag named "tinkerbell" if the DHCP User-Class (Option 77) is "Tinkerbell"
dhcp-match=tinkerbell, option:user-class, Tinkerbell

# STEP 1: INITIAL BOOT
# If the machine is NOT tagged "tinkerbell", it means it just powered on.
# Send it the iPXE bootloader over TFTP.
# (10.1.1.2 is the IP of your Tinkerbell Smee server hosting TFTP).
dhcp-boot=tag:!tinkerbell, ipxe.efi, none, 10.1.1.2

# STEP 2: iPXE BOOT
# If the machine IS tagged "tinkerbell", it means iPXE is now running.
# Hand it the HTTP URL to download the Tinkerbell workflow.
dhcp-boot=tag:tinkerbell, http://10.1.1.2:7171/ipxe/script/${net0/mac}/auto.ipxe

# ==========================================
# 3. Troubleshooting
# ==========================================
# Logs exactly what DHCP options are being requested and sent.
# Highly recommended for debugging PXE boot loops.
log-dhcp
```

## VM Passthrough

To pass devices to VMs ([kubevirt](../kubevirt/README.md)), image the node with:

- IOMMU on in the firmware: Intel VT-d or AMD-Vi, plus SR-IOV if a device will be split into virtual functions.
- Kernel arguments: `intel_iommu=on iommu=pt` on Intel, or just `iommu=pt` on AMD (its IOMMU is on whenever the firmware enables it). Add `vfio-pci.ids=<vendor:device>,...` for every accelerator VMs get, with IDs from `lspci -nn`. Leave NVIDIA GPUs out; the kubevirt chart binds those on nodes labeled `fairport.io/vm=true`.
- If a device's own driver could claim it first, load vfio-pci ahead of it with `softdep <driver> pre: vfio-pci` in `/etc/modprobe.d/vfio.conf`.

Check after boot:

```shell
dmesg | grep -i -e DMAR -e IOMMU         # the IOMMU is on
lspci -nnk -d <vendor:device>            # "Kernel driver in use: vfio-pci"
find /sys/kernel/iommu_groups -type l    # every device, by IOMMU group
```

A passed-through device should sit in an IOMMU group of its own, or only with its own functions; anything sharing its group goes to the same VM.

## Troubleshooting

### Tinkerbell Logs

From the kube control-plane:

```shell
# Check workflow status and if its stuck
fpk -n provisioning get wf <workflow> -o yaml

# Check tinkerbell's logs
fpk -n provisioning logs <tinkerbell pod>
```

### System logs

From the target system's console:

```shell
docker logs tink-worker
```

### Debug Inside System

If the workflow fails, you will be able to run commands manually inside of a chroot of the system (from the console):

```shell
mount <PARTITION> /mnt/
mount --bind /dev /mnt/dev
mount --bind /proc /mnt/proc
mount --bind /sys /mnt/sys
chroot /mnt /bin/bash
```

### DNS

Sometimes the target chroot will need to use a specific DNS server.

```
rm -f /etc/resolv.conf
echo "nameserver <your-nameserver>" > /etc/resolv.conf

```

