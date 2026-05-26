# RBAC

Leverage Rancher to simplify user management and access to the cluster and workloads within the cluster.  It also provides a comprehensive UI for developers to use if they're uncomfortable with the command line.  It can even provide proxies to your in-cluster applications.

## Tools

| Name    | Source                   | Description |
| -       | -                        | -           |
| Rancher | https://www.rancher.com/ | Kubernetes cluster management software |

## Rancher

Rancher has many useful features, here are a few common use-cases:

| Feature   | Description |
| -         | -           |
| RBAC      | Assign users and groups specific access to cluster or namespaced Kubernetes resources.  This can be fine-grained (like access to read logs on pods in a namespace) or genereal (like admin access). |
| OIDC/SAML | Rancher can hook into many OIDC and SAML providers for user provisioning. |
| UI        | Rancher has a UI for developers who are not comfortable using a command-line interface. |
| Proxy     | Users can access their web applications directly in their web browser without any local software requirements |
