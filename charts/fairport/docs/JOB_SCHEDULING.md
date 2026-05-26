# Job Scheduling

Kueue (Kubernetes native scheduler) is used for job scheduling with advanced features like priority and gang scheduling beyond that which is available in the default Kubernetes scheduler.  For legacy environments still using Slurm, the Fairport chart also includes the Slinky project so teams can continue to use their existing pipelines

## Tools

| Name       | Source                                                         | Description |
| -          | -                                                              | -           |
| Kubernetes | https://kubernetes.io/docs/concepts/workloads/controllers/job/ | Kubernetes ships with a native job scheduler that doesn't have any additonal requirements.  Paired with other controllers like Kueue or Volcano it can be an even more powerful tool than a batch or cron job scheduler |
| Kueue      | https://kueue.sigs.k8s.io/                                     | Kueue is a Kubernetes native job scheduler that provides advanced scheduling capabilities such as priority and gang scheduling. It allows users to define job queues and manage resource allocation effectively. |
| Slinky     | https://github.com/slinkyproject                               | Slinky is a project that provides a Slurm-compatible API for Kubernetes, allowing teams to continue using their existing Slurm-based pipelines while taking advantage of Kubernetes features. |

## Kubernetes Native

### Examples
```
$ cat << EOF | kubectl apply -f -
---
apiVersion: batch/v1
kind: Job
metadata:
  name: example
spec:
  ttlSecondsAfterFinished: 300
  template:
    spec:
      containers:
      - name: hello
        image: busybox
        command: ["sh", "-c", "echo \"Hello from $(cat /etc/hostname)\""]
      restartPolicy: Never
EOF
```

## Kueue

### Default Priority Classes

Fairport will install kueue with a set of default priority classes with varying priority and behaviors. 

| Name          | Description                                                                             |
| -             | -                                                                                       |
| default-low   | Jobs which and can be evicted at any time by `default-medium` or `default-high` jobs.   |
| deault-medium | Jobs which will evict `default-low` jobs but may be queued behind `default-high` jobs.  |
| default-high  | Jobs which will be scheduled before `default-medium` and will evict `default-low` jobs. |

### Examples

```shell
$ cat << EOF | kubectl apply -f -
---
apiVersion: batch/v1
kind: Job
metadata:
  name: low-priority-job
  namespace: kueue-system
  labels:
    kueue.x-k8s.io/queue-name: default
    kueue.x-k8s.io/priority-class: default-low
spec:
  suspend: true
  template:
    spec:
      containers:
      - name: work-container
        image: ubuntu
        command: ["/bin/bash", "-c", "echo 'I am a Low Priority Job'; sleep 60"]
        resources:
          requests:
            cpu: "1m"
            memory: "1Mi"
      restartPolicy: Never
EOF
```

## Slinky/Slurm

### Examples

Slurm cluster information
```shell
$ kubectl -n slurm exec -it slurm-controller-0 -- sinfo

PARTITION AVAIL  TIMELIMIT  NODES  STATE NODELIST
slinky       up   infinite      1   idle slinky-0
all*         up   infinite      1   idle slinky-0
```

Adhoc srun job
```shell
$ kubectl -n slurm exec -it slurm-controller-0 -- srun --nodes=1 --ntasks=1 'cat /etc/hostname'

Hello from slinky-0
```
