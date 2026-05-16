# k0s

K0s is a ultra-ligheweight kubernetes distribution which comes packaged as a binary or as a container.  It may be small, but it still has most of the features of other distributions like multi-node/high-availability and air-gap/offline support.

## Run K0s In A Container

Useful for CI and development, this method allows you to run a full kubernetes cluster without anything except docker installed.  It can be launched on bare-metal, vms, [google cloud shell](https://github.com/fairport-io/infra/blob/main/docs/CLOUD_SHELL.md), or run on a [laptop](https://github.com/fairport-io/infra/blob/main/docs/LIMA.md).

> [!WARNING]
> The following code block will overwrite your existing `~/.kube/config`

> [!NOTE]
> In some environments you may need to use sudo before running any `docker` commands

```shell
# Select a version from https://hub.docker.com/r/k0sproject/k0s/tags
export K0S_VERSION="v1.33.2-k0s.0"

# Start k0s using a container
docker run \
    -d \
    -it \
    --rm \
    --name k0s-controller-0 \
    --hostname k0s-controller-0 \
    --privileged \
    --cgroupns=host \
    -v /sys/fs/cgroup:/sys/fs/cgroup:rw \
    -v $PWD/k0s:/var/lib/k0s \
    -p 6443:6443 \
    -e ETCD_UNSUPPORTED_ARCH=arm \
    docker.io/k0sproject/k0s:${K0S_VERSION} \
    k0s controller --enable-worker --no-taints

# Allow the user to use kubectl outside of the running container
mkdir -p ~/.kube
docker exec k0s-controller-0 k0s kubeconfig admin > ~/.kube/config

# Wait for the cluster to become healthy (STATUS should show "Ready" after a few minutes)
kubectl get nodes
```
