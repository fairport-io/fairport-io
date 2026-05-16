# kvm

Virtual machines for linux

## Insallation

```shell
apt uupdate && apt install qemu-kvm libvirt-daemon-system libvirt-clients bridge-utils -y
```

## Create a VMs

<details>

<summary>CPU=2 | RAM=4GiB | Disk=20GiB | Boot: BIOS | Network: NAT</summary>

```
#!/bin/bash

info () { echo "[INFO] $*" ;}

[ $1 ] && NAME=$1 || NAME=default

info "Cleanup"
virsh destroy $NAME || true
virsh undefine $NAME || true
rm -rf /var/lib/libvirt/images/$NAME.qcow2 || true

info "Create"
qemu-img create -f qcow2 /var/lib/libvirt/images/$NAME.qcow2 20G
cat << EOF > $NAME.xml
<domain type='kvm'>
  <name>$NAME</name>
  <memory unit='MiB'>4096</memory>
  <vcpu>2</vcpu>
  <os>
    <type arch='x86_64'>hvm</type>
    <boot dev='hd'/>
    <boot dev='network'/>
  </os>
  <devices>
    <disk type='file' device='disk'>
      <driver name='qemu' type='qcow2'/>
      <source file='/var/lib/libvirt/images/$NAME.qcow2'/>
      <target dev='vda' bus='virtio'/>
    </disk>
    <interface type='network'>
      <source network='default'/>
      <model type='virtio'/>
    </interface>
    <graphics type='vnc' port='-1'/>
    <console type='pty'>
      <target type='serial'/>
    </console>
    <rng model='virtio'>
      <backend model='random'>/dev/urandom</backend>
    </rng>
  </devices>
</domain>
EOF

virsh define $NAME.xml
virsh start $NAME
```
  
</details>

<details>

<summary>CPU=2 | RAM=4GiB | Disk=20GiB | Boot: uEFI | Network: NAT</summary>

```shell
#!/bin/bash

info () { echo "[INFO] $*" ;}

[ $1 ] && NAME=$1 || NAME=default

info "Cleanup"
virsh destroy $NAME || true
virsh undefine $NAME --nvram || true
rm -rf /var/lib/libvirt/images/$NAME.qcow2 || true

info "Create"
qemu-img create -f qcow2 /var/lib/libvirt/images/$NAME.qcow2 20G
cat << EOF > $NAME.xml
<domain type='kvm'>
  <name>$NAME</name>
  <memory unit='MiB'>4096</memory>
  <vcpu>2</vcpu>
  <os firmware='efi'>
    <type arch='x86_64' machine='q35'>hvm</type>
    <firmware>
      <feature enabled='no' name='secure-boot'/>
      <feature enabled='no' name='enrolled-keys'/>
    </firmware>
    <boot dev='hd'/>
    <boot dev='network'/>
    <bootmenu enable='yes' timeout='5000'/>
  </os>
  <features>
    <acpi/>
    <smm state='on'/>
  </features>
  <devices>
    <disk type='file' device='disk'>
      <driver name='qemu' type='qcow2'/>
      <source file='/var/lib/libvirt/images/$NAME.qcow2'/>
      <target dev='vda' bus='virtio'/>
    </disk>
    <interface type='network'>
      <source network='default'/>
      <model type='virtio'/>
    </interface>
    <!-- Q35 requires a PCIe controller layout, unlike the default PCI -->
    <!-- Libvirt will usually auto-add the necessary pcie-root controllers -->
    <graphics type='vnc' port='-1'/>
    <console type='pty'>
      <target type='serial'/>
    </console>
    <rng model='virtio'>
      <backend model='random'>/dev/urandom</backend>
    </rng>
  </devices>
</domain>
EOF

virsh define $NAME.xml
virsh start $NAME
```
  
</details>

<details>

<summary>CPU=2 | RAM=4GiB | Disk=20GiB | Boot: BIOS | Network: Bridge</summary>

```shell
#!/bin/bash

info () { echo "[INFO] $*" ;}

[ $1 ] && NAME=$1 || NAME=default

# Cleanup old deployment
virsh net-destroy pxe
virsh net-undefine pxe
virsh destroy $NAME
virsh undefine $NAME
rm -rf /var/lib/libvirt/images/$NAME.qcow2
qemu-img create -f qcow2 /var/lib/libvirt/images/$NAME.qcow2 20G

# Create bridge
NETPLAN_FILE=/etc/netplan/99-pxe-net.yaml
DEFAULT_IP=$(sed -i 's/^# DEFAULT_IP=//p' $NETPLAN_FILE)
DEFAULT_DEV=$(sed -i 's/^# DEFAULT_DEV=//p' $NETPLAN_FILE)
[ "$DEFAULT_IP"  ] || DEFAULT_IP=$(ip route show 1.1.1.1 | grep -o "src .*" | cut -d ' ' -f2)
[ "$DEFAULT_DEV" ] || DEFAULT_DEV=$(ip route show 1.1.1.1 | grep -o "dev .*" | cut -d ' ' -f2)
cat << EOF > /etc/netplan/99-pxe-net.yaml
# DEFAULT_IP=$DEFAULT_IP
# DEFAULT_DEV=$DEFAULT_DEV
network:
  version: 2
  renderer: networkd
  ethernets:
    eno1:
      dhcp4: no
  bridges:
    virbr1:
      dhcp4: yes
      interfaces:
        - eno1
EOF
chmod 600 /etc/netplan/*.yaml
netplan apply

# Create the virtual network XML
cat << EOF > pxe-network.xml
<network>
  <name>pxe-net</name>
  <forward mode='bridge'/>
  <bridge name='virbr1'/>
</network>
EOF

# Create and start the network
virsh net-define pxe-network.xml
virsh net-start pxe-net
virsh net-autostart pxe-net

rm -rf *.xml

# Create the virtual machine XML
cat << EOF > $NAME.xml
<domain type='kvm'>
  <name>$NAME</name>
  <memory unit='MiB'>4096</memory>
  <vcpu>2</vcpu>
  <os>
    <type arch='x86_64'>hvm</type>
    <boot dev='hd'/>
    <boot dev='network'/>
  </os>
  <devices>
    <disk type='file' device='disk'>
      <driver name='qemu' type='qcow2'/>
      <source file='/var/lib/libvirt/images/$NAME.qcow2'/>
      <target dev='vda' bus='virtio'/>
    </disk>
    <interface type='network'>
      <source network='pxe-net'/>
      <model type='virtio'/>
    </interface>
    <graphics type='vnc' port='-1'/>
    <console type='pty'>
      <target type='serial'/>
    </console>
    <rng model='virtio'>
      <backend model='random'>/dev/urandom</backend>
    </rng>
  </devices>
</domain>
EOF

# Define and start the virtual machine
virsh define $NAME.xml
virsh start $NAME

rm -rf *.xml
```

</details>

## Connecting to VNC Console

From the hypervisor:

```shel
# List running VMs
virsh list

# Get the vnc port
virsh vncdisplay $VM | sed 's/127.0.0.1:/590/g'
```

From your local machine:
```shell
ssh $HYPERVISOR -L $PORT:localhost:$PORT
```

Then you can open your vnc client (like realvnc and go to localhost:$PORT
