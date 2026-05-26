## Objective
Sometimes the fairport installer will be too slow on small machines and may need to be re-run a few times before it succeeds.  Lets let the installer exit with code 1 if the helm install fails.  This way it should default to use kube's retry and backoff mechanism.

## Requirements
- The fairport-installer should exit 1 if the install fails for any chart.

## Tests
- Nothing to test here.

## Implementation Details

Changed `charts/fairport/templates/helmfile-all.yaml` line 178 so that when `helmfile sync` fails, the container exits with code 1 instead of printing an error and continuing the loop. This allows Kubernetes' built-in restart policy to handle retries with backoff.
