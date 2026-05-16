# CLOUD_SHELL

## Connect to Google-Cloud-Shell (Forward 443 on remote to 4443 on local)
```
gcloud auth print-access-token > /dev/null 2>&1 || gcloud auth login
gcloud cloud-shell ssh --authorize-session --ssh-flag="-A" --ssh-flag="-L 443:localhost:4443"
```

## Script to Start A Kubernetes Cluster In Google Cloud Shell With Fairport
```
#!/bin/sh

[ "$K0S_VERSION" ] || export K0S_VERSION="v1.33.2-k0s.0"
[ "$FP_VERSION"  ] || export FP_VERSION="0.3.4"

info () { echo "[$(date +%s)][INFO    ][${FUNCNAME[1]}] $*" >&2; }
crit () { echo "[$(date +%s)][CRITICAL][${FUNCNAME[1]}] $*" >&2; exit 1; }

run_cmd() {
    info "Running command: $*"
    eval "$*"
    [ $? -ne 0 ] && crit "Command did not exit successfully"
}

reset_cluster () {
    run_cmd 'docker stop k0s-controller-0 || true'
    run_cmd 'docker rm -f k0s-controller-0 || true'
    run_cmd 'docker volume create k0s-data || true'
}

wait_for_node_ready () {
    info "Wait for node to become ready"
    for I in $(seq 1 120); do
        kubectl get nodes | grep -q " Ready " && info "Cluster running"
        [ $I -eq 120 ] && crit "Failed to initalize the cluster in time"
        sleep 1
    done
}

start_k0s () {
    if docker ps 2> /dev/null | grep -q "k0s-controller-0"; then
        echo "Skipping cluster creation since k0s-controller-0 is already running"
        exit 0
    else
        echo "Starting kube cluster with K0S_VERSION=$K0S_VERSION and FP_VERSION=$FP_VERSION"
        run_cmd 'docker run \
            -d \
            -it \
            --rm \
            --name k0s-controller-0 \
            --hostname k0s-controller-0 \
            --privileged \
            --cgroupns=host \
            -v /sys/fs/cgroup:/sys/fs/cgroup:rw \
            -v /dev:/dev:rw \
            -v k0s-data:/var/lib/k0s \
            -p 6443:6443 \
            -e ETCD_UNSUPPORTED_ARCH=arm \
            --security-opt seccomp=unconfined \
            --security-opt apparmor=unconfined \
            --tmpfs /tmp \
            --tmpfs /run \
            docker.io/k0sproject/k0s:${K0S_VERSION} \
            k0s controller --enable-worker --no-taints'
        run_cmd 'sleep 20'
        run_cmd 'mkdir -p ~/.kube'
        run_cmd 'docker exec k0s-controller-0 k0s kubeconfig admin > ~/.kube/config'
        wait_for_node_ready
    fi
}

install_fairport() {
    read -p "Install fairport? (y/n)" INSTALL_FP
    if [ "$INSTALL_FP" = "y" ]; then
        helm upgrade \
            --install \
            --namespace fairport \
            --create-namespace \
            --version $FP_VERSION \
            fairport \
            oci://gcr.io/fairport-io/fairport
    fi
}

[ "$1" = "reset" ] && reset_cluster
start_k0s
install_fairport
```
