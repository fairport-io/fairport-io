# charts

A collection of Helm Charts that can be used for everythying from provisioning a datacenter to running AI training and inference jobs (and everything in between).

## Kubernetes

Much of the Fairport software stack aggregates open source projects into Kubernetes compatible components.  The easiest way to get started (if you don't have a Kubernetes cluster) is to use our installer which will setup a single or multi node Kubernetes cluster on Linux in a single command: https://github.com/fairport-io/get-fairport-io

## Fairport Chart

If you have a Kubernetes cluster already, then the Fairport Helm Chart can install and manage all of these charts in a single cluster while maintaining a dependency graph to ensure consistent and repeatable installations: [fairport](fairport/)
