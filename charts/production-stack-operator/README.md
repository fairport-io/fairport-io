# Production Stack Operator

Deploys the [vLLM Production Stack Operator](https://github.com/vllm-project/production-stack) — a Kubernetes operator for managing vLLM inference workloads via Custom Resource Definitions (CRDs).

Source: https://github.com/vllm-project/production-stack

## CRDs

This chart installs 4 CRDs:
- `VLLMRuntime` — vLLM serving engine instances
- `VLLMRouter` — Request router deployments
- `CacheServer` — LMCache server for KV cache offloading
- `LoraAdapter` — LoRA adapter configurations

## Usage

### Install

```bash
helm upgrade --install production-stack-operator oci://ghcr.io/fairport-io/charts/production-stack-operator \
  --namespace production-stack-operator \
  --create-namespace \
  --set operator.enabled=true
```

### Deploy via samples

```yaml
samples:
  enabled: true
  runtimes:
    - name: my-model
      model:
        modelURL: "meta-llama/Llama-3.1-8B-Instruct"
        enableLoRA: true
        dtype: "bfloat16"
        maxModelLen: 4096
        maxNumSeqs: 32
        hfTokenSecretName: "huggingface-token"
        hfTokenKeyName: "token"
      vllm:
        enableChunkedPrefill: false
        enablePrefixCaching: false
        tensorParallelSize: 2
        gpuMemoryUtilization: "0.9"
        maxLoras: 4
        v1: true
        port: 8000
        env:
          - name: HF_HOME
            value: "/data"
        extraArgs: []
      deployment:
        replicas: 1
        deploymentStrategy: "Recreate"
        resources:
          cpu: "8"
          memory: "64Gi"
          gpu: "1"
          gpuType: "nvidia.com/gpu"
        image:
          registry: docker.io
          name: lmcache/vllm-openai:2025-05-27-v1
          pullPolicy: IfNotPresent
          pullSecretName: ""
        sidecar:
          enabled: true
          name: sidecar
          image:
            registry: docker.io
            name: lmcache/lmstack-sidecar:latest
            pullPolicy: Always
          resources:
            cpu: "0.5"
            memory: "128Mi"
          mountPath: /data
        nodeSelectorTerms: []
        tolerations: []
      storage:
        enabled: true
        size: "50Gi"
        accessMode: ReadWriteOnce
        storageClassName: ""
        mountPath: /data
      lmCache:
        enabled: true
        cpuOffloadingBufferSize: "15"
        diskOffloadingBufferSize: "0"
        remoteUrl: "lm://my-cacheserver.default.svc.cluster.local:80"
        remoteSerde: "naive"
      autoscaling:
        enabled: false
        minReplicas: 1
        maxReplicas: 5
        pollingInterval: 15
        triggers:
          prometheusAddress: "http://kube-prom-stack-kube-prome-prometheus.monitoring.svc:9090"
          requestsRunningThreshold: 5
          promptTokensThreshold: 100
          generationTokensThreshold: 100
  cacheservers:
    - name: my-cacheserver
      image:
        registry: docker.io
        name: lmcache/vllm-openai:2025-04-18
        pullPolicy: IfNotPresent
        pullSecretName: ""
      port: 8000
      resources:
        cpu: "2"
        memory: "16Gi"
      replicas: 1
      deploymentStrategy: Recreate
  routers:
    - name: my-router
      enableRouter: true
      replicas: 1
      port: 80
      serviceDiscovery: k8s
      k8sLabelSelector: "app.kubernetes.io/name=production-stack,model=my-model"
      routingLogic: roundrobin
      engineScrapeInterval: 15
      requestStatsWindow: 60
      image:
        registry: docker.io
        name: lmcache/lmstack-router
        pullPolicy: IfNotPresent
      resources:
        cpu: "2"
        memory: "8Gi"
      extraArgs: []
      env:
        - name: LOG_LEVEL
          value: "info"
        - name: METRICS_ENABLED
          value: "true"
```

### Deploy CRs manually

```yaml
apiVersion: production-stack.vllm.ai/v1alpha1
kind: CacheServer
metadata:
  name: my-cacheserver
spec:
  image:
    registry: docker.io
    name: lmcache/vllm-openai:2025-04-18
    pullPolicy: IfNotPresent
  port: 8000
  resources:
    cpu: "2"
    memory: "16Gi"
  replicas: 1
  deploymentStrategy: Recreate
---
apiVersion: production-stack.vllm.ai/v1alpha1
kind: VLLMRuntime
metadata:
  name: my-model
spec:
  model:
    modelURL: "meta-llama/Llama-3.1-8B-Instruct"
    enableLoRA: false
    dtype: "bfloat16"
    maxModelLen: 4096
    maxNumSeqs: 32
  vllmConfig:
    tensorParallelSize: 2
    gpuMemoryUtilization: "0.9"
    port: 8000
  lmCacheConfig:
    enabled: true
    cpuOffloadingBufferSize: "15"
    remoteUrl: "lm://my-cacheserver.default.svc.cluster.local:80"
    remoteSerde: "naive"
  deploymentConfig:
    replicas: 1
    resources:
      cpu: "8"
      memory: "64Gi"
      gpu: "1"
    image:
      registry: docker.io
      name: lmcache/vllm-openai:2025-05-27-v1
      pullPolicy: IfNotPresent
    sidecarConfig:
      enabled: true
      image:
        registry: docker.io
        name: lmcache/lmstack-sidecar:latest
      resources:
        cpu: "0.5"
        memory: "128Mi"
  storageConfig:
    enabled: true
    size: "50Gi"
    accessMode: ReadWriteOnce
    mountPath: /data
---
apiVersion: production-stack.vllm.ai/v1alpha1
kind: VLLMRouter
metadata:
  name: my-router
spec:
  enableRouter: true
  replicas: 1
  port: 80
  serviceDiscovery: k8s
  k8sLabelSelector: "app.kubernetes.io/name=production-stack,model=my-model"
  routingLogic: roundrobin
  image:
    registry: docker.io
    name: lmcache/lmstack-router
    pullPolicy: IfNotPresent
  resources:
    cpu: "2"
    memory: "8Gi"
  env:
    - name: LOG_LEVEL
      value: "info"
```

