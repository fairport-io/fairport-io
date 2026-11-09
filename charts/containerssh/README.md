# containerssh

Helm chart for [ContainerSSH](https://containerssh.io): every SSH login gets its own pod in the cluster, deleted when the session ends.

## Usage - For Administrators

Enable the chart and add users in `authorized_keys` format:

```yaml
containerssh:
  enabled: true
  users:
    alice: |
      ssh-ed25519 AAAA... alice@laptop
```

```shell
helm install containerssh oci://ghcr.io/fairport-io/charts/containerssh --namespace containerssh --create-namespace -f values.yaml
```

For custom authentication, set `authorizedKeysCommand` to a script that gets the username and prints its keys, like sshd's `AuthorizedKeysCommand`. [values.yaml](values.yaml) has an example that logs users in with the keys on their GitHub profile.

## Usage - For Users

Connect, optionally picking the pod's shape after a `+` (CPUs, memory in GiB, image number, lifetime in seconds). The options, their defaults, limits and images, and the pod they write into are under `containerssh.guest` in [values.yaml](values.yaml), where you can add your own (GPUs, for example):

```shell
ssh -p 30022 alice@<any node>
ssh -p 30022 alice+c4m16i0t7200@<any node>
```

VS Code Remote-SSH works. Native `ssh -A` agent forwarding doesn't; use `ssh -R /tmp/containerssh-ssh-agent.sock:$SSH_AUTH_SOCK ...` instead.

The SSH host key is generated on first start and stored in the `containerssh-hostkey` Secret. `helm uninstall` leaves it behind, so users' `known_hosts` stay valid across a reinstall.

### VSCode Integration

Official Docs: https://code.visualstudio.com/docs/remote/ssh

#### Setup
- Install VSCode & Remote SSH Extension
- Open the VSCode browser (Windows: `CTRL + P`, MacOS: `CMD + P`) and type: `> open ssh configuration`
- Select your configuration file from the list (from your home directory)
- Add your target host and save (Command + S for MacOS).  You can update your machine shape in the User section if required.
  Sample Config:
  ```ssh
  Host example.com
    # Required: Set Host and User (be sure to update the User field)
    HostName example.com
    User <username>+<shape>

    # Recommended: Allows SSH Key Forwarding (Interact with Git)
    ForwardAgent yes
    RemoteForward /tmp/containerssh-ssh-agent.sock ${SSH_AUTH_SOCK}

    # Recommended: Keeps SSH Connection Alive
    ServerAliveInterval 60
    ServerAliveCountMax 3

    # Optional: Allows Multiplexing (Multiple SSH Shells Use Same Connection & Pod)
    ControlMaster auto
    ControlPath ~/.ssh/cm-%r@%h:%p
  ```
- Now you can connect to the host by going to your VSCode browser (Windows: `CTRL + P`, MacOS: `CMD + P`) and typing: `> connect to host`

## Testing

Check the hooks against the installed values:

```shell
kubectl -n containerssh exec deploy/containerssh -c hooks -- python /etc/hooks/hooks.py test
```
