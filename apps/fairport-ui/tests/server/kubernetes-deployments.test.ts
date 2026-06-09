import { describe, it, expect, beforeEach } from 'vitest';
import {
  createKubernetesDeployment,
  listKubernetesDeployments,
  refreshKubernetesDeployment,
  resetKubernetesDeploymentStore,
  type KubernetesClientFactory,
} from '../../src/kubernetes/deployments';

const input = {
  name: 'test-deployment',
  image: 'vllm/vllm-openai:v0.20.2',
  model: 'hf://test-model',
  minReplicas: 1,
  maxReplicas: 2,
  location: 'local',
  gpuType: 'NVIDIA A100',
  numGpus: 1,
  hostCpus: 2,
  hostMemory: '8Gi',
};

function flushPromises(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, 0));
}

class FakeAppsApi {
  deployments = new Map<string, any>();
  shouldFail = false;
  deleted: string[] = [];

  async readNamespacedDeployment(name: string, namespace: string) {
    const deployment = this.deployments.get(`${namespace}/${name}`);
    if (!deployment) throw { statusCode: 404 };
    return { body: deployment };
  }

  async createNamespacedDeployment(namespace: string, body: any) {
    if (this.shouldFail) throw new Error('apply failed');
    body.metadata.resourceVersion = '1';
    body.status = { replicas: body.spec.replicas };
    this.deployments.set(`${namespace}/${body.metadata.name}`, body);
    return { body };
  }

  async replaceNamespacedDeployment(name: string, namespace: string, body: any) {
    if (this.shouldFail) throw new Error('apply failed');
    body.status = { replicas: body.spec.replicas };
    this.deployments.set(`${namespace}/${name}`, body);
    return { body };
  }

  async deleteNamespacedDeployment(name: string, namespace: string) {
    this.deleted.push(`${namespace}/${name}`);
    this.deployments.delete(`${namespace}/${name}`);
    return { body: {} };
  }
}

class FakeCoreApi {
  services = new Map<string, any>();
  deleted: string[] = [];
  readyPods = 1;

  async readNamespacedService(name: string, namespace: string) {
    const service = this.services.get(`${namespace}/${name}`);
    if (!service) throw { statusCode: 404 };
    return { body: service };
  }

  async createNamespacedService(namespace: string, body: any) {
    body.metadata.resourceVersion = '1';
    this.services.set(`${namespace}/${body.metadata.name}`, body);
    return { body };
  }

  async replaceNamespacedService(name: string, namespace: string, body: any) {
    this.services.set(`${namespace}/${name}`, body);
    return { body };
  }

  async deleteNamespacedService(name: string, namespace: string) {
    this.deleted.push(`${namespace}/${name}`);
    this.services.delete(`${namespace}/${name}`);
    return { body: {} };
  }

  async listNamespacedPod(
    namespace: string,
    _pretty: any,
    _allowWatchBookmarks: any,
    _continue: any,
    _fieldSelector: any,
    labelSelector: string,
  ) {
    const pods = Array.from({ length: this.readyPods }, (_, index) => ({
      metadata: { name: `pod-${index}`, namespace, labels: { selector: labelSelector } },
      status: { conditions: [{ type: 'Ready', status: 'True' }] },
    }));
    return { body: { items: pods } };
  }
}

describe('kubernetes deployments', () => {
  let appsApi: FakeAppsApi;
  let coreApi: FakeCoreApi;
  let factory: KubernetesClientFactory;

  beforeEach(() => {
    resetKubernetesDeploymentStore();
    appsApi = new FakeAppsApi();
    coreApi = new FakeCoreApi();
    factory = () => ({ appsApi, coreApi, namespace: 'test-ns' });
  });

  it('creates a provisioning record and marks it active after Kubernetes apply succeeds', async () => {
    const record = createKubernetesDeployment(input, 'user-id-test', factory);

    expect(record.state).toBe('provisioning');
    expect(record.healthyReplicas).toBe(0);

    await flushPromises();
    const [stored] = listKubernetesDeployments('user-id-test');

    expect(stored.state).toBe('active');
    expect(stored.currentReplicas).toBe(1);
    expect(stored.healthyReplicas).toBe(1);
    expect(appsApi.deployments.size).toBe(1);
    expect(coreApi.services.size).toBe(1);
  });

  it('refreshes healthy replicas from ready pods', async () => {
    const record = createKubernetesDeployment(input, 'user-id-test', factory);
    await flushPromises();

    coreApi.readyPods = 2;
    const refreshed = await refreshKubernetesDeployment(record.id, 'user-id-test', factory);

    expect(refreshed?.healthyReplicas).toBe(2);
    expect(refreshed?.currentReplicas).toBe(1);
  });

  it('marks deployment failed and deletes objects when apply fails', async () => {
    appsApi.shouldFail = true;
    const record = createKubernetesDeployment(input, 'user-id-test', factory);

    await flushPromises();
    const [stored] = listKubernetesDeployments('user-id-test');

    expect(stored.id).toBe(record.id);
    expect(stored.state).toBe('failed');
    expect(stored.errorMessage).toContain('apply failed');
    expect(appsApi.deleted).toContain(`test-ns/${record.kubeName}`);
    expect(coreApi.deleted).toContain(`test-ns/${record.kubeName}`);
  });
});
