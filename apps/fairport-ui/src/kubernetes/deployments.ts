import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import * as k8s from '@kubernetes/client-node';

export type DeploymentState = 'provisioning' | 'active' | 'failed' | 'deleted';

export interface DeploymentInput {
  name: string;
  image: string;
  model: string;
  minReplicas: number;
  maxReplicas: number;
  location: string;
  gpuType: string;
  numGpus: number;
  hostCpus: number;
  hostMemory: string;
}

export interface DeploymentRecord extends DeploymentInput {
  id: string;
  ownerId: string;
  namespace: string;
  kubeName: string;
  state: DeploymentState;
  healthyReplicas: number;
  currentReplicas: number;
  errorMessage?: string;
  createdAt: number;
  updatedAt: number;
}

export interface KubernetesApis {
  appsApi: any;
  coreApi: any;
  namespace: string;
}

export type KubernetesClientFactory = (location: string) => KubernetesApis;

const deploymentRecords = new Map<string, DeploymentRecord>();
const deploymentTimers = new Map<string, NodeJS.Timeout>();
const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;
const MANAGED_BY_LABEL = 'fairport-ui';

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

function sanitizeDnsLabel(value: string): string {
  const slug = value.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  return slug || 'deployment';
}

function truncateLabel(value: string): string {
  return sanitizeDnsLabel(value).slice(0, 63).replace(/-$/g, '') || 'value';
}

function kubeNameFor(name: string, id: string): string {
  const suffix = id.replace(/^deployment-/, '').slice(0, 8);
  const base = sanitizeDnsLabel(name).slice(0, 53).replace(/-$/g, '') || 'deployment';
  return `${base}-${suffix}`.slice(0, 63).replace(/-$/g, '');
}

function namespaceFromServiceAccount(): string {
  const namespaceFile = '/var/run/secrets/kubernetes.io/serviceaccount/namespace';
  try {
    return fs.readFileSync(namespaceFile, 'utf8').trim() || 'default';
  } catch {
    return 'default';
  }
}

export function createDefaultKubernetesClient(location: string): KubernetesApis {
  const kc = new k8s.KubeConfig();
  if (location === 'local') {
    kc.loadFromCluster();
  } else {
    const kubeconfigDir = process.env.KUBECONFIG_SECRET_DIR || '/var/run/secrets/fairport-ui/kubeconfigs';
    const kubeconfigPath = path.join(kubeconfigDir, `${sanitizeDnsLabel(location)}.kubeconfig`);
    kc.loadFromFile(kubeconfigPath);
  }
  return {
    appsApi: kc.makeApiClient(k8s.AppsV1Api),
    coreApi: kc.makeApiClient(k8s.CoreV1Api),
    namespace: process.env.KUBE_NAMESPACE || namespaceFromServiceAccount(),
  };
}

function labelsFor(record: DeploymentRecord): Record<string, string> {
  return {
    'app.kubernetes.io/name': record.kubeName,
    'app.kubernetes.io/managed-by': MANAGED_BY_LABEL,
    'fairport.io/deployment-id': truncateLabel(record.id),
    'fairport.io/owner-id': truncateLabel(record.ownerId),
  };
}

function annotationsFor(record: DeploymentRecord): Record<string, string> {
  return {
    'fairport.io/display-name': record.name,
    'fairport.io/model': record.model,
    'fairport.io/location': record.location,
    'fairport.io/max-replicas': String(record.maxReplicas),
  };
}

function gpuResourceName(gpuType: string): string | null {
  const lower = gpuType.toLowerCase();
  if (lower.includes('amd')) return 'amd.com/gpu';
  if (gpuType !== 'None') return 'nvidia.com/gpu';
  return null;
}

function buildDeploymentManifest(record: DeploymentRecord): any {
  const labels = labelsFor(record);
  const gpuResource = gpuResourceName(record.gpuType);
  const limits: Record<string, string | number> = {};
  if (gpuResource && record.numGpus > 0) limits[gpuResource] = record.numGpus;

  return {
    apiVersion: 'apps/v1',
    kind: 'Deployment',
    metadata: {
      name: record.kubeName,
      namespace: record.namespace,
      labels,
      annotations: annotationsFor(record),
    },
    spec: {
      replicas: Math.max(0, record.minReplicas),
      selector: { matchLabels: labels },
      template: {
        metadata: { labels },
        spec: {
          containers: [{
            name: 'model-server',
            image: record.image,
            env: [{ name: 'MODEL', value: record.model }],
            ports: [{ name: 'http', containerPort: 8000 }],
            resources: {
              requests: {
                cpu: String(record.hostCpus),
                memory: record.hostMemory,
              },
              limits,
            },
          }],
        },
      },
    },
  };
}

function buildServiceManifest(record: DeploymentRecord): any {
  return {
    apiVersion: 'v1',
    kind: 'Service',
    metadata: {
      name: record.kubeName,
      namespace: record.namespace,
      labels: labelsFor(record),
      annotations: annotationsFor(record),
    },
    spec: {
      selector: labelsFor(record),
      ports: [{ name: 'http', port: 8000, targetPort: 'http' }],
    },
  };
}

function bodyOf(response: any): any {
  return response?.body ?? response;
}

async function invoke(api: any, method: string, objectArg: any, positionalArgs: any[]): Promise<any> {
  const fn = api[method];
  if (typeof fn !== 'function') throw new Error(`Kubernetes client does not implement ${method}`);
  if (fn.length <= 1) return bodyOf(await fn.call(api, objectArg));
  return bodyOf(await fn.call(api, ...positionalArgs));
}

function isNotFound(error: any): boolean {
  return error?.statusCode === 404 || error?.response?.statusCode === 404 || error?.body?.code === 404;
}

async function upsertDeployment(appsApi: any, namespace: string, manifest: any): Promise<void> {
  try {
    const existing = await invoke(
      appsApi,
      'readNamespacedDeployment',
      { name: manifest.metadata.name, namespace },
      [manifest.metadata.name, namespace],
    );
    manifest.metadata.resourceVersion = existing?.metadata?.resourceVersion;
    await invoke(
      appsApi,
      'replaceNamespacedDeployment',
      { name: manifest.metadata.name, namespace, body: manifest },
      [manifest.metadata.name, namespace, manifest],
    );
  } catch (error: any) {
    if (!isNotFound(error)) throw error;
    await invoke(
      appsApi,
      'createNamespacedDeployment',
      { namespace, body: manifest },
      [namespace, manifest],
    );
  }
}

async function upsertService(coreApi: any, namespace: string, manifest: any): Promise<void> {
  try {
    const existing = await invoke(
      coreApi,
      'readNamespacedService',
      { name: manifest.metadata.name, namespace },
      [manifest.metadata.name, namespace],
    );
    manifest.metadata.resourceVersion = existing?.metadata?.resourceVersion;
    await invoke(
      coreApi,
      'replaceNamespacedService',
      { name: manifest.metadata.name, namespace, body: manifest },
      [manifest.metadata.name, namespace, manifest],
    );
  } catch (error: any) {
    if (!isNotFound(error)) throw error;
    await invoke(
      coreApi,
      'createNamespacedService',
      { namespace, body: manifest },
      [namespace, manifest],
    );
  }
}

function countHealthyPods(pods: any[]): number {
  return pods.filter((pod: any) => {
    const conditions = pod?.status?.conditions || [];
    return conditions.some((c: any) => c.type === 'Ready' && c.status === 'True');
  }).length;
}

function selectorFor(record: DeploymentRecord): string {
  return Object.entries(labelsFor(record)).map(([key, value]) => `${key}=${value}`).join(',');
}

async function applyDeployment(record: DeploymentRecord, factory: KubernetesClientFactory): Promise<void> {
  const { appsApi, coreApi, namespace } = factory(record.location);
  record.namespace = namespace;
  await upsertDeployment(appsApi, namespace, buildDeploymentManifest(record));
  await upsertService(coreApi, namespace, buildServiceManifest(record));
  clearDeploymentTimer(record.id);
  await refreshKubernetesDeployment(record.id, record.ownerId, factory);
  const refreshed = deploymentRecords.get(record.id);
  if (refreshed && refreshed.state !== 'deleted') {
    refreshed.state = 'active';
    refreshed.errorMessage = undefined;
    refreshed.updatedAt = nowSeconds();
  }
}

async function deleteKubernetesObjects(record: DeploymentRecord, factory: KubernetesClientFactory): Promise<void> {
  const { appsApi, coreApi, namespace } = factory(record.location);
  const deleteOptions = {};
  await Promise.allSettled([
    invoke(appsApi, 'deleteNamespacedDeployment', { name: record.kubeName, namespace, body: deleteOptions }, [record.kubeName, namespace, undefined, undefined, undefined, undefined, undefined, deleteOptions]),
    invoke(coreApi, 'deleteNamespacedService', { name: record.kubeName, namespace, body: deleteOptions }, [record.kubeName, namespace, undefined, undefined, undefined, undefined, undefined, deleteOptions]),
  ]);
}

function clearDeploymentTimer(id: string): void {
  const timer = deploymentTimers.get(id);
  if (timer) clearTimeout(timer);
  deploymentTimers.delete(id);
}

function setProvisioningTimeout(record: DeploymentRecord, factory: KubernetesClientFactory, timeoutMs: number): void {
  const timer = setTimeout(async () => {
    const current = deploymentRecords.get(record.id);
    if (!current || current.state !== 'provisioning') return;
    current.state = 'failed';
    current.errorMessage = 'Deployment provisioning timed out after 5 minutes.';
    current.updatedAt = nowSeconds();
    await deleteKubernetesObjects(current, factory);
  }, timeoutMs);
  timer.unref?.();
  deploymentTimers.set(record.id, timer);
}

export function listKubernetesDeployments(ownerId: string): DeploymentRecord[] {
  return Array.from(deploymentRecords.values()).filter(record => record.ownerId === ownerId);
}

export function getKubernetesDeployment(id: string, ownerId: string): DeploymentRecord | null {
  const record = deploymentRecords.get(id);
  return record && record.ownerId === ownerId ? record : null;
}

export function createKubernetesDeployment(
  input: DeploymentInput,
  ownerId: string,
  factory: KubernetesClientFactory = createDefaultKubernetesClient,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): DeploymentRecord {
  const id = `deployment-${crypto.randomUUID()}`;
  const location = input.location || 'local';
  const namespace = process.env.KUBE_NAMESPACE || 'default';
  const record: DeploymentRecord = {
    ...input,
    id,
    ownerId,
    location,
    namespace,
    kubeName: kubeNameFor(input.name, id),
    state: 'provisioning',
    healthyReplicas: 0,
    currentReplicas: 0,
    createdAt: nowSeconds(),
    updatedAt: nowSeconds(),
  };
  deploymentRecords.set(id, record);
  setProvisioningTimeout(record, factory, timeoutMs);
  void applyDeployment(record, factory).catch(async (error: any) => {
    clearDeploymentTimer(record.id);
    record.state = 'failed';
    record.errorMessage = error?.message || 'Kubernetes apply failed.';
    record.updatedAt = nowSeconds();
    await deleteKubernetesObjects(record, factory);
  });
  return record;
}

export async function refreshKubernetesDeployment(
  id: string,
  ownerId: string,
  factory: KubernetesClientFactory = createDefaultKubernetesClient,
): Promise<DeploymentRecord | null> {
  const record = getKubernetesDeployment(id, ownerId);
  if (!record || record.state === 'deleted') return record;

  const { appsApi, coreApi, namespace } = factory(record.location);
  const deployment = await invoke(
    appsApi,
    'readNamespacedDeployment',
    { name: record.kubeName, namespace },
    [record.kubeName, namespace],
  );
  const pods = await invoke(
    coreApi,
    'listNamespacedPod',
    { namespace, labelSelector: selectorFor(record) },
    [namespace, undefined, undefined, undefined, undefined, selectorFor(record)],
  );
  record.currentReplicas = deployment?.status?.replicas || 0;
  record.healthyReplicas = countHealthyPods(pods?.items || []);
  if (record.state !== 'provisioning' && record.state !== 'failed') record.state = 'active';
  record.updatedAt = nowSeconds();
  return record;
}

export async function deleteKubernetesDeployment(
  id: string,
  ownerId: string,
  factory: KubernetesClientFactory = createDefaultKubernetesClient,
): Promise<DeploymentRecord | null> {
  const record = getKubernetesDeployment(id, ownerId);
  if (!record) return null;
  clearDeploymentTimer(record.id);
  await deleteKubernetesObjects(record, factory);
  record.state = 'deleted';
  record.currentReplicas = 0;
  record.healthyReplicas = 0;
  record.updatedAt = nowSeconds();
  return record;
}

export function resetKubernetesDeploymentStore(): void {
  for (const id of deploymentTimers.keys()) clearDeploymentTimer(id);
  deploymentRecords.clear();
}
