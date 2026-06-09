## Objective
Add kubernetes tools to the ui to allow it to interact with kubernetes clusters. This will allow the agent to perform tasks such as deploying applications, managing resources, and monitoring cluster health.

## Requirements
### Setup
- [ ] Fetch latest: `git fetch origin`
- [ ] Read root AGENTS.md: `cat "$(git rev-parse --show-toplevel)/AGENTS.md"`
- [ ] Create branch: `git checkout -b agent/<branch-name> origin/main`
- [ ] Survey component: read README.md and relevant source files: `cat "$(git rev-parse --show-toplevel)/README.md" "$(git rev-parse --show-toplevel)/<app>/README.md"`

### Implementation
- [ ] Add any js dependencies required to interact with kubernetes clusters (e.g. kubernetes-client)
- [ ] The configuration should relate to the "Deployments" tab of the app.
  - [ ] If location is local, then use the in-cluster kubernetes configuration, else it should use a kubeconfig secret file.
  - [ ] After the user click "Create Deployment" add the item to the "DEPLOYMENTS" section and put it in a "provisioning" state until kubectl apply if successful.  Set timeout to 5 minutes, after which it should be marked as "failed" and the object deleted.
  - [ ] The different states should be provisioning, active, failed, and deleted.
  - [ ] The provisioning and active states should show a number of healthy replicas which are up and receiving traffic.
  - [ ] If the apply action fails, immediately show it as failed.
  - [ ] Add a refresh button for each deployment to allow the user to manually refresh the status of the deployment (kubectl get pods).
- [ ] Ask the user questions to fully understand the requirements for the kubernetes tools (e.g. what specific tasks they want to perform, what kind of clusters they are using, etc.)

### Tests
- [ ] Add any required tests to ensure the kubernetes tools are working correctly (e.g. unit tests for any new functions, integration tests for interacting with a test kubernetes cluster).

### Verification
- [ ] `make build` passes (if applicable)
- [ ] `make test` passes (if applicable)
- [ ] Run `git diff origin/main` and verify the changeset matches this spec
- [ ] Check this file again to ensure you met all requirements.  Update this file with your progress.
- [ ] The Agent Plan and Agent Implementation Details are filled out an all boxes checked to be considered done.
- [ ] Update README.md if necessary to reflect the changes made.

## Agent Plan
- Confirmed the spec is inside `charts/fairport-ui/.agents/` and read the root/app guidance before edits.
- Work from `agent/kube-integration` based on the local `origin/main` ref. `git fetch origin` was attempted but blocked by GitHub SSH public-key access.
- Add Kubernetes support to `apps/fairport-ui` with `@kubernetes/client-node`, keeping cluster operations on the Express server.
- Add server APIs for creating, listing, refreshing, and deleting Deployments. `local` will use in-cluster configuration; non-local locations will load kubeconfig files from a secret-mounted directory.
- Update the Deployments tab to call those APIs, show provisioning/active/failed/deleted states, healthy replica counts, failure messages, and per-row refresh.
- Update Helm chart RBAC/env/readme so the app can manage Kubernetes Deployments/Services/Pods in its namespace.
- Add focused tests for the Kubernetes deployment helpers and run build/test verification where possible.

## Agent Implementation Details
<!-- Agent fills this in when complete. -->
