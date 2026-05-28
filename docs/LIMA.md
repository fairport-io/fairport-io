# LIMA

Run a Linux VM on Apple Silicon devices that can emulate arm64 and amd64 architectures

If you do not have LIMA installed on your device you can follow the directions here: https://lima-vm.io/docs/installation/

## Usage

### Create a VM

```shell
limactl start --cpus=2 --memory=8 --vm-type=vz --rosetta --mount-writable --name=default template://ubuntu-lts
```

### Start the VM

```shell
limactl start default
```

### Connect to the VM

```shell
lima
```

### Stop the vm

```shell
limactl stop default
```

### Reset the vm

```
limactl factory-reset default
```

## Common Packages

Common packages to install inside your Lima vm

```shell
#    vim                # Text editor
#    make               # Tool used to build, test, and deploy code
#    docker.io          # Run containers with docker
#    docker-buildx      # Build containers with docker buildx
#    binfmt-support     # Run containers of different architectures
#    qemu-user-static   # Run containers of different architectures
sudo apt install \
    vim \
    make \
    docker.io \
    docker-buildx \
    binfmt-support \
    qemu-user-static
```

## Install Fairport (Optional)

```
curl https://get.fairport.io | sudo bash -
```

## Create a Bridged VM

A bridged VM may be helpful for bootstrapping things like nodes in a datacenter or at a remote site.  If your VM has Fairport's stack then it has Tinkerbell which means it can start imaging machines if connected to the network!

1. Install socket_vmnet: https://lima-vm.io/docs/config/network/vmnet/#socket_vmnet

2. Verify that there is a `bridged` network in the `~/.lima/_config/networks.yaml` file

```
cat ~/.lima/_config/networks.yaml
```

3. Create the VM

```
limactl start --cpus=2 --memory=8 --vm-type vz --rosetta --mount-writable --name=bridged-vm --network=lima:bridged template://ubuntu-lts
```
