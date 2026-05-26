# Certificate Management

Applications requiring certificate management can use cert-manager which comes with the Fairport chart.  Use it to generate tls certs with letsencrypt or have cert-manager create and update certificates within the cluster.  Some tools like Rancher and Slurm may require it.

## Tools

| Name         | Source                   | Description |
| -            | -                        | -           |
| Cert Manager | https://cert-manager.io/ | Certificate management software |

## Letsencrypt

Letsencrypt is a free service for generating public SSL/TLS certificates. It easily integrates with cert-manager to provide automated certificate issuance and renewal. Here’s how to set it up in your Kubernetes cluster using cert-manager:

```yaml
apiVersion: cert-manager.io/v1
kind: ClusterIssuer
metadata:
  name: letsencrypt-production
spec:
  acme:
    email: user@example.com
    server: https://acme-v02.api.letsencrypt.org/directory
    privateKeySecretRef:
      name: certmanager-production-issuer-account-key
    solvers:
    - http01:
        ingress:
          ingressClassName: nginx
```

```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: my-ingress
spec:
  tls:
  - hosts:
    - example.com
    - www.example.com
    secretName: my-certificate-secret
  rules:
  - host: example.com
    http:
      paths:
      - path: /
        pathType: Prefix
        backend:
          service:
            name: my-service
            port:
              number: 80
```
