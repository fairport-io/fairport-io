# containerssh

Helm chart for [ContainerSSH](https://containerssh.io): every SSH login gets its own pod in the cluster, deleted when the session ends.

## Usage

Add users in `authorized_keys` format:

```yaml
users:
  alice: |
    ssh-ed25519 AAAA... alice@laptop
```

```shell
helm install containerssh oci://ghcr.io/fairport-io/charts/containerssh --namespace containerssh --create-namespace -f values.yaml
```

Connect, optionally picking the pod's shape after a `+` (CPUs, memory in GiB, image number, lifetime in seconds). The options, their defaults, limits and images, and the pod they write into are under `guest` in [values.yaml](values.yaml), where you can add your own (GPUs, for example):

```shell
ssh -p 30022 alice@<any node>
ssh -p 30022 alice+c4m16i0t7200@<any node>
```

VS Code Remote-SSH works. Native `ssh -A` agent forwarding doesn't; use `ssh -R /tmp/containerssh-ssh-agent.sock:$SSH_AUTH_SOCK ...` instead.

The SSH host key is generated on first start and stored in the `containerssh-hostkey` Secret. `helm uninstall` leaves it behind, so users' `known_hosts` stay valid across a reinstall.

## Testing

Check the hooks against the installed values:

```shell
kubectl -n containerssh exec deploy/containerssh -c hooks -- python /etc/hooks/hooks.py test
```
