# KubeAI

Deploys [KubeAI](https://www.kubeai.org) — an open-source AI inference platform for Kubernetes.

## Resource Profile Manager

This chart also deploys the **kubeai-resourceprofile-manager**, a Kopf-based Kubernetes operator that watches ConfigMaps for the `kubeai.org/resource-profile` annotation and logs create/update/delete events. It is designed to integrate with KubeAI's resource profile system.

Source: [`apps/kubeai-resourceprofile-manager/`](/apps/kubeai-resourceprofile-manager/)

