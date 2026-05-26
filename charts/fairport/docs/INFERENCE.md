# Inference

A demo inference app can be turned on showing full end-to-end capabilities of inference on GPUs or CPUs.  Other frameworks are also supported, for example  VLLM, TensorRT-LLM, etc. can all run on this platform.

## Tools

| Name    | Source                  | Description |
| -       | -                       | -           |
| Ollama  | https://ollama.com/     | Extremely simple AI inference framework built on top of llama.cpp and optimized for containers. |
| Litellm | https://www.litellm.ai/ | A http proxy for LLM inference that manages users, groups, rate-limits, and budgets for users.  |

## LiteLLM

## Ollama

### Demo

This demo will show you how to start and install a sipmle inference endpoint inside the cluster.

 1. Install the fairport chart with `demo-inference.enabled=true`:

```
helm upgrade --install -n fairport --create-namespace --set demo-inference.enabled=true fairport .
```

 2. Verify the pod is running:

```
kubectl -n demo-inference get pods
```

> [!NOTE]
> It should show pod `Running` and all containers `READY`:

```
NAME            READY   STATUS    RESTARTS   AGE
smollm-135m-0   1/1     Running   0          69m
```

 3. Make an inference request

```
curl -k https://localhost/api/generate -d '{"model": "smollm:135m", "prompt":"hi"}'
```
