# bifrost

Helm wrapper for [Bifrost](https://github.com/maximhq/bifrost) — an AI gateway with unified interface for multiple providers, load balancing, guardrails, and governance.

## Overview

Bifrost provides a high-performance AI gateway that routes requests across 1000+ models from providers like OpenAI, Anthropic, Azure, Bedrock, and Vertex. It supports semantic caching, rate limiting, virtual keys, MCP, and cluster mode.

## Usage

```bash
helm install bifrost oci://ghcr.io/fairport-io/charts/bifrost --namespace bifrost --create-namespace
```

### Configuration

| Parameter | Description | Default |
|-----------|-------------|---------|
| `bifrost.enabled` | Enable bifrost | `false` |
| `bifrost.image.repository` | Bifrost image repository | `docker.io/maximhq/bifrost` |
| `bifrost.image.tag` | Bifrost image tag | `""` (upstream default) |
| `bifrost.replicaCount` | Number of replicas | `1` |
| `bifrost.service.type` | Service type | `ClusterIP` |
| `bifrost.service.port` | Service port | `8080` |
| `bifrost.ingress.enabled` | Enable ingress | `false` |
| `bifrost.storage.mode` | Storage backend (`sqlite` or `postgres`) | `postgres` |
| `bifrost.postgresql.enabled` | Deploy bundled PostgreSQL | `false` |
| `bifrost.postgresql.external.enabled` | Use external PostgreSQL | `false` |

For full configuration, see the [upstream chart values](https://github.com/maximhq/bifrost/blob/main/helm-charts/bifrost/values.yaml) and [Bifrost docs](https://docs.getbifrost.ai/).
