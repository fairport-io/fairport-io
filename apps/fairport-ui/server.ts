
import express, { Request, Response, NextFunction } from 'express';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import dns from 'dns';
import http from 'http';
import https from 'https';
import net from 'net';
import { StringDecoder } from 'string_decoder';
import jwt from 'jsonwebtoken';
import axios from 'axios';
import helmet from 'helmet';
import { fileURLToPath } from 'url';
import bcrypt from 'bcryptjs';
import { createDatabase } from './src/db/index';
import type { DatabaseAdapter, DbData, ProviderOffering } from './src/db/index';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
// Only trust the first reverse-proxy hop when explicitly configured.
// Without this, an attacker behind no proxy could spoof X-Forwarded-For.
const TRUST_PROXY = process.env.TRUST_PROXY;
if (TRUST_PROXY !== undefined) {
  const parsed = parseInt(TRUST_PROXY, 10);
  app.set('trust proxy', isNaN(parsed) ? TRUST_PROXY : parsed);
}

// --- CONFIGURATION ---
const PORT = process.env.PORT || 3000;
const SECRET_KEY = process.env.SECRET_KEY || crypto.randomBytes(32).toString('hex');
const JWT_SECRET = process.env.JWT_SECRET || crypto.randomBytes(32).toString('hex');
const JWT_EXPIRY = process.env.JWT_EXPIRY || '24h';
const CHAT_PERSISTENCE = process.env.CHAT_PERSISTENCE || 'client';
const SIGNUPS_ENABLED = process.env.SIGNUPS_ENABLED !== 'false';
const RAW_BASE_PATH = process.env.BASE_PATH || '';
if (RAW_BASE_PATH && (!RAW_BASE_PATH.startsWith('/') || RAW_BASE_PATH.startsWith('//') || /[?#\\]/.test(RAW_BASE_PATH))) {
  throw new Error('BASE_PATH must start with one "/" and contain no query, fragment, or backslash');
}
const BASE_PATH = RAW_BASE_PATH.replace(/\/+$/, '');
const APP_CONFIG = {
  app_name: process.env.APP_NAME || "Chat",
  default_provider_name: process.env.DEFAULT_PROVIDER_NAME || "default",
  default_provider_url: process.env.DEFAULT_PROVIDER_URL || "http://localhost:1234/v1",
  default_provider_model: process.env.DEFAULT_PROVIDER_MODEL || "default",
  default_provider_model_in_price_1m: parseFloat(process.env.DEFAULT_PROVIDER_MODEL_IN_PRICE_1M || '0'),
  default_provider_model_out_price_1m: parseFloat(process.env.DEFAULT_PROVIDER_MODEL_OUT_PRICE_1M || '0'),
  default_provider_api_key: process.env.DEFAULT_PROVIDER_API_KEY || "",
  default_provider_model_rate_limits: process.env.DEFAULT_PROVIDER_MODEL_RATE_LIMITS || "10:request:minute,1:request:second",
  default_provider_model_queue_max_size: parseInt(process.env.DEFAULT_PROVIDER_MODEL_QUEUE_MAX_SIZE || '5', 10),
};

// --- OAUTH CONFIGURATION ---
interface OAuthProviderConfig {
  id: string;
  name: string;
  client_id: string;
  client_secret: string;
  metadata_url?: string;
  authorize_url?: string;
  token_url?: string;
  userinfo_url?: string;
  scope: string;
}

function discoverOAuthProviders(): OAuthProviderConfig[] {
  const providers: OAuthProviderConfig[] = [];

  const oidcProviders: { id: string; name: string }[] = [
    { id: 'google', name: 'Google' },
    { id: 'microsoft', name: 'Microsoft' },
    { id: 'okta', name: 'Okta' },
    { id: 'auth0', name: 'Auth0' },
  ];

  for (const { id, name } of oidcProviders) {
    const prefix = `OAUTH_${id.toUpperCase()}`;
    const client_id = process.env[`${prefix}_CLIENT_ID`] || '';
    const client_secret = process.env[`${prefix}_CLIENT_SECRET`] || '';
    const metadata_url = process.env[`${prefix}_METADATA_URL`] || '';
    if (client_id && client_secret && metadata_url) {
      providers.push({ id, name, client_id, client_secret, metadata_url, scope: 'openid email profile' });
    }
  }

  const ghId = process.env.OAUTH_GITHUB_CLIENT_ID || '';
  const ghSecret = process.env.OAUTH_GITHUB_CLIENT_SECRET || '';
  if (ghId && ghSecret) {
    providers.push({
      id: 'github', name: 'GitHub',
      client_id: ghId, client_secret: ghSecret,
      authorize_url: 'https://github.com/login/oauth/authorize',
      token_url: 'https://github.com/login/oauth/access_token',
      userinfo_url: 'https://api.github.com/user',
      scope: 'read:user user:email',
    });
  }

  return providers;
}

const OAUTH_PROVIDERS = discoverOAuthProviders();
const OAUTH_ENABLED = OAUTH_PROVIDERS.length > 0;
const APP_URL = process.env.APP_URL || '';

function getBaseUrl(req: Request): string {
  return (APP_URL || `${req.protocol}://${req.get('host')}${BASE_PATH}`).replace(/\/+$/, '');
}

async function resolveOAuthEndpoint(provider: OAuthProviderConfig, type: 'authorization_endpoint' | 'token_endpoint' | 'userinfo_endpoint'): Promise<string> {
  if (type === 'authorization_endpoint' && provider.authorize_url) return provider.authorize_url;
  if (type === 'token_endpoint' && provider.token_url) return provider.token_url;
  if (type === 'userinfo_endpoint' && provider.userinfo_url) return provider.userinfo_url;
  const response = await axios.get(provider.metadata_url!, { timeout: 10000 });
  return response.data[type];
}

const BOOTSTRAP_ADMIN_EMAILS = (process.env.BOOTSTRAP_ADMIN_EMAILS || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
const MAX_INPUT_TOKENS = 100000;
const estimateTokens = (messages: any[]) =>
  messages.reduce((sum: number, m: any) => sum + Math.ceil((m.content?.length || 0) / 4), 0);

function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9-]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');
}

// --- SSRF GUARD (C2/M4) ---
// Validates a provider base_url is not pointing at internal/private infrastructure.
// The naive string-match for '169.254.169.254' was bypassable via IPv6, URL auth,
// and other internal addresses. This function rejects all RFC-1918, loopback,
// link-local, and metadata service ranges.
// Global Admins may approve LAN/cluster ranges; immutable deployment providers
// retain the operator-controlled localhost exception documented in README.md.
type ProviderUrlAccess = 'public' | 'private' | 'operator';
type ResolvedAddress = { address: string; family: number };
type ValidatedProviderUrl = { parsed: URL; addresses: ResolvedAddress[]; requiresPrivateAccess: boolean };
const PROVIDER_DNS_TIMEOUT_MS = 3000;
const PROVIDER_TEST_TIMEOUT_MS = 3000;
const PROVIDER_MODELS_RESPONSE_MAX_BYTES = 1024 * 1024;
const PROVIDER_MODELS_PATH_MAX_LENGTH = 1024;
const PROVIDER_API_KEY_MAX_LENGTH = 8192;
const PROVIDER_MODELS_MAX_COUNT = 1000;
const PROVIDER_MODEL_ID_MAX_LENGTH = 256;

class ProviderUrlError extends Error {
  constructor(public kind: 'invalid' | 'forbidden' | 'private' | 'dns', message: string) {
    super(message);
  }
}

const FORBIDDEN_IPS = new net.BlockList();
FORBIDDEN_IPS.addSubnet('0.0.0.0', 8, 'ipv4'); // unspecified
FORBIDDEN_IPS.addSubnet('127.0.0.0', 8, 'ipv4'); // loopback
FORBIDDEN_IPS.addSubnet('169.254.0.0', 16, 'ipv4'); // link-local / AWS metadata
FORBIDDEN_IPS.addSubnet('224.0.0.0', 4, 'ipv4');
FORBIDDEN_IPS.addSubnet('240.0.0.0', 4, 'ipv4');
FORBIDDEN_IPS.addAddress('100.100.100.200', 'ipv4');
FORBIDDEN_IPS.addAddress('168.63.129.16', 'ipv4');
FORBIDDEN_IPS.addAddress('::', 'ipv6');
FORBIDDEN_IPS.addAddress('::1', 'ipv6'); // IPv6 loopback
FORBIDDEN_IPS.addSubnet('fe80::', 10, 'ipv6'); // IPv6 link-local
FORBIDDEN_IPS.addSubnet('ff00::', 8, 'ipv6');
FORBIDDEN_IPS.addAddress('fd00:ec2::254', 'ipv6');

const PRIVATE_IPS = new net.BlockList();
PRIVATE_IPS.addSubnet('10.0.0.0', 8, 'ipv4'); // RFC-1918
PRIVATE_IPS.addSubnet('100.64.0.0', 10, 'ipv4');
PRIVATE_IPS.addSubnet('172.16.0.0', 12, 'ipv4'); // RFC-1918
PRIVATE_IPS.addSubnet('192.168.0.0', 16, 'ipv4'); // RFC-1918
PRIVATE_IPS.addSubnet('198.18.0.0', 15, 'ipv4');
PRIVATE_IPS.addSubnet('fc00::', 7, 'ipv6'); // IPv6 ULA
PRIVATE_IPS.addSubnet('fec0::', 10, 'ipv6');

function normalizeHostname(hostname: string): string {
  return hostname.replace(/^\[|\]$/g, '').replace(/\.$/, '').toLowerCase();
}

function mappedIpv4(ip: string): string | null {
  const match = ip.toLowerCase().match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (!match) return ip.toLowerCase().startsWith('::ffff:') && net.isIP(ip.slice(7)) === 4 ? ip.slice(7) : null;
  const high = parseInt(match[1], 16);
  const low = parseInt(match[2], 16);
  return `${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`;
}

function classifyIp(rawIp: string): 'public' | 'private' | 'forbidden' {
  const ip = normalizeHostname(rawIp.split('%')[0]);
  const mapped = mappedIpv4(ip);
  const address = mapped || ip;
  const family = net.isIP(address);
  if (!family) throw new ProviderUrlError('invalid', 'Invalid base_url: Host resolved to an invalid address');
  const type = family === 6 ? 'ipv6' : 'ipv4';
  if (FORBIDDEN_IPS.check(address, type)) return 'forbidden';
  if (PRIVATE_IPS.check(address, type)) return 'private';
  return 'public';
}

function parseProviderUrl(rawUrl: unknown): URL {
  if (typeof rawUrl !== 'string') {
    throw new ProviderUrlError('invalid', 'Invalid base_url: Use a valid HTTP(S) URL');
  }
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new ProviderUrlError('invalid', 'Invalid base_url: Use a valid HTTP(S) URL');
  }
  // Reject URLs with userinfo — can be used to confuse URL parsers
  if ((parsed.protocol !== 'http:' && parsed.protocol !== 'https:') || parsed.username || parsed.password || !parsed.hostname) {
    throw new ProviderUrlError('invalid', 'Invalid base_url: Use an HTTP(S) URL without credentials');
  }
  return parsed;
}

function resolveProviderModelsEndpoint(rawBaseUrl: string, rawModelsPath: unknown): { endpoint: URL; modelsPath: string } {
  const baseUrl = parseProviderUrl(rawBaseUrl);
  if (baseUrl.search || baseUrl.hash) {
    throw new ProviderUrlError('invalid', 'Invalid base_url: Query strings and fragments are not supported');
  }
  if (rawModelsPath !== undefined && typeof rawModelsPath !== 'string') {
    throw new ProviderUrlError('invalid', 'Invalid models_path: Use a path such as models or /v1/models');
  }

  const modelsPath = (rawModelsPath as string | undefined)?.trim() || 'models';
  if (
    modelsPath.length > PROVIDER_MODELS_PATH_MAX_LENGTH ||
    modelsPath.startsWith('//') ||
    /^[a-z][a-z\d+.-]*:/i.test(modelsPath) ||
    /[\\?#\u0000-\u001f\u007f]/.test(modelsPath)
  ) {
    throw new ProviderUrlError('invalid', 'Invalid models_path: Use a same-origin path without a query or fragment');
  }

  for (const segment of modelsPath.split('/')) {
    let decoded = segment;
    try {
      decoded = decodeURIComponent(segment);
    } catch {
      throw new ProviderUrlError('invalid', 'Invalid models_path: Path encoding is malformed');
    }
    if (
      decoded === '.' || decoded === '..' ||
      /[\\/?#\u0000-\u001f\u007f]/.test(decoded) ||
      /%(?:25)*2e/i.test(segment) || /%(?:25)*(?:2f|5c)/i.test(segment)
    ) {
      throw new ProviderUrlError('invalid', 'Invalid models_path: Dot traversal and encoded separators are not supported');
    }
  }

  const resolutionBase = new URL(baseUrl.toString());
  resolutionBase.pathname = `${resolutionBase.pathname.replace(/\/+$/, '')}/`;
  const endpoint = modelsPath.startsWith('/')
    ? new URL(modelsPath, baseUrl.origin)
    : new URL(modelsPath, resolutionBase);
  if (endpoint.origin !== baseUrl.origin || endpoint.username || endpoint.password || endpoint.search || endpoint.hash) {
    throw new ProviderUrlError('invalid', 'Invalid models_path: Models endpoint must remain on the provider origin');
  }
  return { endpoint, modelsPath };
}

function parseProviderApiKey(rawApiKey: unknown): string | null {
  if (rawApiKey === undefined) return null;
  if (typeof rawApiKey !== 'string') {
    throw new ProviderUrlError('invalid', 'Invalid api_key');
  }
  if (rawApiKey.length > PROVIDER_API_KEY_MAX_LENGTH || /[\u0000-\u001f\u007f]/.test(rawApiKey)) {
    throw new ProviderUrlError('invalid', 'Invalid api_key');
  }
  const apiKey = rawApiKey.trim();
  return apiKey || null;
}

function parseDiscoveredModelIds(data: unknown): string[] {
  const rows = (data as any)?.data;
  if (!Array.isArray(rows) || rows.length > PROVIDER_MODELS_MAX_COUNT) {
    throw new Error('Models endpoint did not return an OpenAI-compatible data array');
  }
  const models: string[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const id = typeof row?.id === 'string' ? row.id.trim() : '';
    if (!id || id.length > PROVIDER_MODEL_ID_MAX_LENGTH || /[,\u0000-\u001f\u007f]/.test(id)) {
      throw new Error('Models endpoint returned an invalid model id');
    }
    if (!seen.has(id)) {
      seen.add(id);
      models.push(id);
    }
  }
  return models;
}

function parseProviderModelIds(rawModels: unknown): string[] {
  if (typeof rawModels !== 'string') throw new Error('Models must be a comma-separated string');
  const values = rawModels.split(',');
  if (values.length > PROVIDER_MODELS_MAX_COUNT) throw new Error(`Models cannot contain more than ${PROVIDER_MODELS_MAX_COUNT} entries`);
  const models: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const modelId = value.trim();
    if (!modelId) continue;
    if (modelId.length > PROVIDER_MODEL_ID_MAX_LENGTH || /[,\u0000-\u001f\u007f]/.test(modelId)) {
      throw new Error('Models contains an invalid model id');
    }
    if (!seen.has(modelId)) {
      seen.add(modelId);
      models.push(modelId);
    }
  }
  if (models.length === 0) throw new Error('At least one model is required');
  return models;
}

function providerOfferingId(providerId: string, modelId: string): string {
  const digest = crypto.createHash('sha256').update(`${providerId}\0${modelId}`).digest('hex').slice(0, 32);
  return `model-offering-${digest}`;
}

function getProviderOfferings(provider: any, includeDisabled = false): ProviderOffering[] {
  const offerings = Array.isArray(provider.offerings) ? provider.offerings : [];
  const filtered = offerings.filter((offering: any) =>
    offering && typeof offering.model_id === 'string' && (includeDisabled || offering.enabled !== false)
  );
  const configuredOrder = typeof provider.models === 'string'
    ? provider.models.split(',').map((model: string) => model.trim()).filter(Boolean)
    : [];
  return filtered.sort((left: any, right: any) => {
    const leftIndex = configuredOrder.indexOf(left.model_id);
    const rightIndex = configuredOrder.indexOf(right.model_id);
    const normalizedLeft = leftIndex === -1 ? Number.MAX_SAFE_INTEGER : leftIndex;
    const normalizedRight = rightIndex === -1 ? Number.MAX_SAFE_INTEGER : rightIndex;
    return normalizedLeft - normalizedRight || left.model_id.localeCompare(right.model_id) || left.id.localeCompare(right.id);
  });
}

function getProviderModelNames(provider: any): string[] {
  const offerings = getProviderOfferings(provider);
  if (offerings.length > 0) return offerings.map(offering => offering.model_id);
  if (typeof provider.models !== 'string') return [];
  try { return parseProviderModelIds(provider.models); } catch { return []; }
}

function findProviderOffering(provider: any, modelId: string, includeDisabled = false): ProviderOffering | undefined {
  return getProviderOfferings(provider, includeDisabled).find(offering => offering.model_id === modelId);
}

function syncProviderOfferings(
  db: any,
  provider: any,
  modelIds: string[],
  options: { source?: 'manual' | 'discovered'; rate_limits?: string; queue_max_size?: number } = {}
): ProviderOffering[] {
  const now = Math.floor(Date.now() / 1000);
  const desired = new Set(modelIds);
  const deduplicated = new Map<string, ProviderOffering>();
  const existingOfferings = Array.isArray(provider.offerings) ? provider.offerings : [];

  for (const rawOffering of existingOfferings) {
    if (!rawOffering || typeof rawOffering.model_id !== 'string' || deduplicated.has(rawOffering.model_id)) continue;
    const legacyPricing = db.model_pricing.find((pricing: any) => pricing.model_id === rawOffering.model_id);
    deduplicated.set(rawOffering.model_id, {
      id: typeof rawOffering.id === 'string' && rawOffering.id ? rawOffering.id : providerOfferingId(provider.id, rawOffering.model_id),
      model_id: rawOffering.model_id,
      visibility: provider.immutable ? 'public' : (rawOffering.visibility === 'public' ? 'public' : 'private'),
      source: rawOffering.source === 'discovered' ? 'discovered' : 'manual',
      enabled: rawOffering.enabled !== false,
      created_at: Number.isInteger(rawOffering.created_at) ? rawOffering.created_at : now,
      last_seen_at: Number.isInteger(rawOffering.last_seen_at) ? rawOffering.last_seen_at : null,
      input_cost_per_1m_tokens: Number.isFinite(rawOffering.input_cost_per_1m_tokens) ? rawOffering.input_cost_per_1m_tokens : (legacyPricing?.input_cost_per_1m_tokens ?? 0),
      output_cost_per_1m_tokens: Number.isFinite(rawOffering.output_cost_per_1m_tokens) ? rawOffering.output_cost_per_1m_tokens : (legacyPricing?.output_cost_per_1m_tokens ?? 0),
      rate_limits: typeof rawOffering.rate_limits === 'string' && rawOffering.rate_limits ? rawOffering.rate_limits : (legacyPricing?.rate_limits || APP_CONFIG.default_provider_model_rate_limits),
      queue_max_size: Number.isInteger(rawOffering.queue_max_size) && rawOffering.queue_max_size > 0 ? rawOffering.queue_max_size : (legacyPricing?.queue_max_size ?? APP_CONFIG.default_provider_model_queue_max_size),
    });
  }

  for (const modelId of modelIds) {
    const legacyPricing = db.model_pricing.find((pricing: any) => pricing.model_id === modelId);
    let offering = deduplicated.get(modelId);
    if (!offering) {
      offering = {
        id: providerOfferingId(provider.id, modelId),
        model_id: modelId,
        visibility: provider.immutable ? 'public' : 'private',
        source: options.source || 'manual',
        enabled: true,
        created_at: now,
        last_seen_at: options.source === 'discovered' ? now : null,
        input_cost_per_1m_tokens: legacyPricing?.input_cost_per_1m_tokens ?? 0,
        output_cost_per_1m_tokens: legacyPricing?.output_cost_per_1m_tokens ?? 0,
        rate_limits: legacyPricing?.rate_limits || APP_CONFIG.default_provider_model_rate_limits,
        queue_max_size: legacyPricing?.queue_max_size ?? APP_CONFIG.default_provider_model_queue_max_size,
      };
      deduplicated.set(modelId, offering);
    }
    offering.enabled = true;
    if (options.source === 'discovered') offering.last_seen_at = now;
    if (provider.immutable) offering.visibility = 'public';
    if (options.rate_limits !== undefined) offering.rate_limits = options.rate_limits;
    if (options.queue_max_size !== undefined) offering.queue_max_size = options.queue_max_size;
  }

  for (const offering of deduplicated.values()) {
    if (!desired.has(offering.model_id)) offering.enabled = false;
  }
  provider.offerings = [...deduplicated.values()];
  provider.models = modelIds.join(',');
  return getProviderOfferings(provider);
}

async function resolveProviderHostname(hostname: string, timeoutMs: number): Promise<ResolvedAddress[]> {
  let timeout: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      dns.promises.lookup(hostname, { all: true, verbatim: true }),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new ProviderUrlError('dns', 'Invalid base_url: Hostname resolution timed out')), timeoutMs);
      })
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

async function validateProviderUrl(rawUrl: string, access: ProviderUrlAccess, dnsTimeoutMs = PROVIDER_DNS_TIMEOUT_MS): Promise<ValidatedProviderUrl> {
  const parsed = parseProviderUrl(rawUrl);
  const hostname = normalizeHostname(parsed.hostname);
  const isOperatorUrl = access === 'operator';
  let requiresPrivateAccess = hostname.endsWith('.local') || hostname.endsWith('.internal') || hostname.endsWith('.home.arpa');
  let addresses: ResolvedAddress[];

  // Reject well-known internal hostnames
  if (!isOperatorUrl && (hostname === 'localhost' || hostname.endsWith('.localhost'))) {
    throw new ProviderUrlError('forbidden', 'Invalid base_url: Loopback, unspecified, link-local, and metadata addresses are forbidden');
  }

  // Reject bare IP addresses that are private
  const family = net.isIP(hostname);
  if (family) {
    addresses = [{ address: hostname, family }];
  } else {
    try {
      addresses = await resolveProviderHostname(hostname, dnsTimeoutMs);
    } catch (error) {
      if (error instanceof ProviderUrlError) throw error;
      throw new ProviderUrlError('dns', 'Invalid base_url: Hostname could not be resolved');
    }
    if (addresses.length === 0) {
      throw new ProviderUrlError('dns', 'Invalid base_url: Hostname could not be resolved');
    }
  }

  for (const { address } of addresses) {
    const classification = classifyIp(address);
    if (!isOperatorUrl && classification === 'forbidden') {
      throw new ProviderUrlError('forbidden', 'Invalid base_url: Loopback, unspecified, link-local, and metadata addresses are forbidden');
    }
    if (classification === 'private') requiresPrivateAccess = true;
  }

  if (access === 'public' && requiresPrivateAccess) {
    throw new ProviderUrlError('private', 'Invalid base_url: Private/LAN/cluster addresses require Global Admin access');
  }

  return { parsed, addresses, requiresPrivateAccess };
}

function providerRequestConfig(target: ValidatedProviderUrl) {
  const expectedHostname = normalizeHostname(target.parsed.hostname);
  const lookup = ((hostname: string, options: any, callback: any) => {
    if (normalizeHostname(hostname) !== expectedHostname) {
      const error: NodeJS.ErrnoException = new Error('Redirected hostname was not validated');
      error.code = 'EACCES';
      return callback(error);
    }
    const family = typeof options === 'number' ? options : options?.family;
    const addresses = family ? target.addresses.filter(address => address.family === family) : target.addresses;
    if (addresses.length === 0) {
      const error: NodeJS.ErrnoException = new Error('No validated address for the requested family');
      error.code = 'EAI_ADDRFAMILY';
      return callback(error);
    }
    if (options?.all) return callback(null, addresses);
    return callback(null, addresses[0].address, addresses[0].family);
  }) as net.LookupFunction;

  return {
    httpAgent: new http.Agent({ lookup }),
    httpsAgent: new https.Agent({ lookup }),
    maxRedirects: 0,
    proxy: false as const,
  };
}

function sendProviderUrlError(res: Response, error: unknown, dnsAsBadGateway = false) {
  if (!(error instanceof ProviderUrlError)) throw error;
  const status = error.kind === 'private' ? 403 : (dnsAsBadGateway && error.kind === 'dns' ? 502 : 400);
  return res.status(status).json({ detail: error.message });
}


// --- DATABASE TYPE ---
const DATABASE_TYPE = (process.env.DATABASE_TYPE || 'pglite') as 'yaml' | 'pglite' | 'postgres';

// --- DATABASE OPERATIONS ---
const dbAdapter: DatabaseAdapter = createDatabase(DATABASE_TYPE);

async function loadDb(): Promise<DbData> {
  return dbAdapter.load();
}

async function saveDb(data: DbData): Promise<void> {
  return dbAdapter.save(data);
}

// Ensure default roles and groups exist
async function ensureDefaults(db: any) {
  // Migrate old group ID
  const oldDefault = db.groups.find((g: any) => g.id === "group-id-default");
  if (oldDefault) {
    oldDefault.id = "default";
    oldDefault.name = "default";
  }

  const defaultRoles = [
    {
      id: "role-id-default",
      name: "Default Base",
      permissions: [
        { verbs: ["use"], resources: ["models"], resource_names_regex: [".*"] },
        { verbs: ["use"], resources: ["providers"], resource_names_regex: [".*"] }
      ]
    },
    {
      id: "role-id-default-group-admin",
      name: "Default Group Admin",
      permissions: [
        { verbs: ["*"], resources: ["*"], resource_names_regex: [".*"] }
      ]
    },
    {
      id: "role-id-global-admin",
      name: "Global Admin",
      permissions: [
        { verbs: ["*"], resources: ["*"], resource_names_regex: [".*"] }
      ]
    }
  ];

  defaultRoles.forEach(role => {
    if (!db.roles.some((r: any) => r.id === role.id)) {
      db.roles.push(role);
    }
  });

  if (!db.groups.some((g: any) => g.id === "default")) {
    db.groups.push({
      id: "default",
      name: "default",
      api_keys: [],
      members: [{ ids: ["*"], role_ids: ["role-id-default"] }]
    });
  }

  // Ensure Global Admin group exists
  if (!db.groups.some((g: any) => g.id === "global_admin")) {
    db.groups.push({
      id: "global_admin",
      name: "Global Admin",
      api_keys: [],
      members: []
    });
  }

  // Ensure default model exists
  if (!db.models.some((m: any) => m.name === APP_CONFIG.default_provider_model)) {
    db.models.push({
      id: "model-id-default",
      name: APP_CONFIG.default_provider_model,
      base_url: APP_CONFIG.default_provider_url,
      owner_id: null,
      visibility: "public"
    });
  }

  // Ensure default model pricing exists
  if (!db.model_pricing.some((mp: any) => mp.model_id === APP_CONFIG.default_provider_model)) {
    db.model_pricing.push({
      model_id: APP_CONFIG.default_provider_model,
      input_cost_per_1m_tokens: APP_CONFIG.default_provider_model_in_price_1m,
      output_cost_per_1m_tokens: APP_CONFIG.default_provider_model_out_price_1m,
      rate_limits: APP_CONFIG.default_provider_model_rate_limits,
      queue_max_size: APP_CONFIG.default_provider_model_queue_max_size
    });
  }

  for (const provider of db.providers) {
    if (typeof provider.name === 'string' && provider.name.trim()) provider.name = provider.name.trim();
    if (!provider.models_path) provider.models_path = 'models';
  }

  // Ensure default provider exists
  if (!db.providers.some((p: any) => p.immutable === true)) {
    // C4: if SECRET_KEY is explicitly set, encrypt the key at rest.
    // We skip encryption when SECRET_KEY is auto-generated (random per restart)
    // to avoid losing the ability to decrypt after a server restart.
    const rawApiKey = APP_CONFIG.default_provider_api_key;
    const secretKeyIsSet = !!process.env.SECRET_KEY;
    const storedApiKey = (rawApiKey && secretKeyIsSet)
      ? 'enc:' + encryptProviderKey(rawApiKey, 'immutable')
      : rawApiKey;

    db.providers.push({
      id: "provider-id-default",
      name: APP_CONFIG.default_provider_name,
      base_url: APP_CONFIG.default_provider_url,
      models: APP_CONFIG.default_provider_model,
      api_key: storedApiKey,
      owner_id: null,
      visibility: "public",
      immutable: true,
      allow_private: true,
      models_path: 'models'
    });
    await saveDb(db);
  } else {
    // C4: migrate an existing plaintext immutable key to encrypted form
    // if SECRET_KEY is now set and the key is not yet encrypted.
    const immutableProvider = db.providers.find((p: any) => p.immutable === true);
    if (immutableProvider && immutableProvider.api_key && !immutableProvider.api_key.startsWith('enc:') && process.env.SECRET_KEY) {
      immutableProvider.api_key = 'enc:' + encryptProviderKey(immutableProvider.api_key, 'immutable');
      await saveDb(db);
    }
  }

  for (const provider of db.providers) {
    let modelIds: string[];
    if (Array.isArray(provider.offerings) && provider.offerings.length > 0) {
      modelIds = getProviderOfferings(provider).map(offering => offering.model_id);
    } else {
      try {
        modelIds = parseProviderModelIds(provider.models || '');
      } catch {
        modelIds = [];
      }
    }
    if (modelIds.length === 0 && provider.immutable) modelIds = [APP_CONFIG.default_provider_model];
    syncProviderOfferings(db, provider, modelIds);
  }
}

async function ensureAdminForEmail(db: any, email: string) {
  if (!BOOTSTRAP_ADMIN_EMAILS.includes(email.toLowerCase())) return;
  const user = db.users.find((u: any) => u.name.toLowerCase() === email.toLowerCase());
  if (!user) return;
  const adminGroup = db.groups.find((g: any) => g.id === "global_admin");
  if (!adminGroup) return;
  const existingMember = adminGroup.members.find((m: any) => m.ids.includes(user.id));
  if (!existingMember) {
    adminGroup.members.push({ ids: [user.id], role_ids: ["role-id-global-admin"] });
    await saveDb(db);
  }
  // Also add to default group
  const defaultGroup = db.groups.find((g: any) => g.id === "default");
  if (defaultGroup) {
    const inDefault = defaultGroup.members.some((m: any) => m.ids.includes(user.id));
    if (!inDefault) {
      defaultGroup.members.push({ ids: [user.id], role_ids: ["role-id-default"] });
      await saveDb(db);
    }
  }
}

// --- RATE LIMITER ---
class RateLimiter {
  private windows: Map<string, number[]> = new Map();

  private windowMsToLabel(ms: number): string {
    if (ms <= 1000) return 's';
    if (ms <= 60000) return 'm';
    if (ms <= 3600000) return 'h';
    return 'd';
  }

  check(userId: string, modelId: string, limits: { limit: number; windowMs: number }[]): { allowed: boolean; remaining: number; limit: number; unit: string; windows: { remaining: number; limit: number; unit: string }[] } {
    const now = Date.now();
    let maxWindowMs = 0;
    let maxLimit = 0;
    let maxRemaining = Infinity;
    const allWindows: { remaining: number; limit: number; unit: string }[] = [];

    // First pass: check all windows without recording
    for (const { limit, windowMs } of limits) {
      if (limit <= 0) continue;
      const key = `${userId}:${modelId}:${windowMs}`;
      const windowStart = now - windowMs;

      let timestamps = this.windows.get(key);
      if (!timestamps) {
        timestamps = [];
        this.windows.set(key, timestamps);
      }

      // Remove expired entries
      while (timestamps.length > 0 && timestamps[0] < windowStart) {
        timestamps.shift();
      }

      const preRemaining = limit - timestamps.length;

      if (timestamps.length >= limit) {
        return { allowed: false, remaining: 0, limit, unit: this.windowMsToLabel(windowMs), windows: [{ remaining: 0, limit, unit: this.windowMsToLabel(windowMs) }] };
      }

      allWindows.push({ remaining: preRemaining, limit, unit: this.windowMsToLabel(windowMs) });

      // Track the broadest window for display (e.g. minute over second)
      if (windowMs > maxWindowMs) {
        maxWindowMs = windowMs;
        maxLimit = limit;
        maxRemaining = preRemaining;
      }
    }

    // Second pass: record the request in all windows
    for (const { windowMs } of limits) {
      const key = `${userId}:${modelId}:${windowMs}`;
      const timestamps = this.windows.get(key);
      if (timestamps) timestamps.push(now);
    }

    return {
      allowed: true,
      remaining: maxRemaining - 1,
      limit: maxLimit,
      unit: this.windowMsToLabel(maxWindowMs),
      windows: allWindows.map(w => ({ ...w, remaining: w.remaining - 1 }))
    };
  }
}

const rateLimiter = new RateLimiter();

class RequestQueue {
  private queues: Map<string, { processing: number; pending: Array<{ resolve: (v: { ok: boolean; reason?: string }) => void; timestamp: number }> }> = new Map();

  async enqueue(key: string, maxSize: number, timeoutMs: number = 120_000): Promise<{ ok: boolean; reason?: string }> {
    let entry = this.queues.get(key);
    if (!entry) {
      entry = { processing: 0, pending: [] };
      this.queues.set(key, entry);
    }

    if (entry.processing + entry.pending.length >= maxSize) {
      return { ok: false, reason: 'full' };
    }

    if (entry.processing === 0) {
      entry.processing = 1;
      return { ok: true };
    }

    return new Promise<{ ok: boolean; reason?: string }>((resolve) => {
      const pendingItem = { resolve, timestamp: Date.now() };
      entry!.pending.push(pendingItem);

      setTimeout(() => {
        const idx = entry!.pending.indexOf(pendingItem);
        if (idx !== -1) {
          entry!.pending.splice(idx, 1);
          resolve({ ok: false, reason: 'timeout' });
          console.log(JSON.stringify({
            timestamp: new Date().toISOString(),
            event: 'queue_timeout',
            queue_key: key,
            queue_max_size: maxSize,
            timeout_ms: timeoutMs
          }));
        }
      }, timeoutMs);
    });
  }

  dequeue(key: string): void {
    const entry = this.queues.get(key);
    if (!entry) return;

    if (entry.pending.length > 0) {
      const next = entry.pending.shift()!;
      next.resolve({ ok: true });
    } else {
      entry.processing = 0;
    }
  }

  getQueueSize(key: string): number {
    const entry = this.queues.get(key);
    return entry ? entry.processing + entry.pending.length : 0;
  }

  gc(maxAgeMs: number): void {
    const now = Date.now();
    for (const [key, entry] of this.queues.entries()) {
      if (entry.pending.length > 0) {
        const stale: typeof entry.pending = [];
        const active: typeof entry.pending = [];
        for (const p of entry.pending) {
          if (now - p.timestamp > maxAgeMs) {
            stale.push(p);
          } else {
            active.push(p);
          }
        }
        for (const p of stale) {
          p.resolve({ ok: false, reason: 'timeout' });
          console.log(JSON.stringify({
            timestamp: new Date().toISOString(),
            event: 'queue_item_expired',
            queue_key: key,
            queue: { size: entry.processing + entry.pending.length },
            age_ms: now - p.timestamp,
            max_age_ms: maxAgeMs
          }));
        }
        entry.pending = active;
      }
      if (entry.processing === 0 && entry.pending.length === 0) {
        this.queues.delete(key);
        console.log(JSON.stringify({
          timestamp: new Date().toISOString(),
          event: 'queue_deleted_empty',
          queue_key: key,
          queue: { size: 0 }
        }));
      }
    }
  }
}

const requestQueue = new RequestQueue();

function getModelSettings(db: any, provider: any, modelId: string): any {
  return findProviderOffering(provider, modelId) || db.model_pricing.find((mp: any) => mp.model_id === modelId);
}

function getModelQueueMaxSize(db: any, provider: any, modelId: string): number {
  const pricing = getModelSettings(db, provider, modelId);
  return pricing?.queue_max_size ?? APP_CONFIG.default_provider_model_queue_max_size;
}

function isValidRateLimits(str: string): boolean {
  const parts = str.split(',');
  for (const part of parts) {
    const trimmed = part.trim();
    if (!/^\d+:request:(second|minute|hour|day)$/.test(trimmed)) return false;
  }
  return true;
}

function parseRateLimits(str: string): { limit: number; windowMs: number }[] {
  return str.split(',').map(entry => {
    const parts = entry.trim().split(':');
    const limit = parseInt(parts[0], 10) || 10;
    const unit = parts[2] || 'minute';
    const windowMs = unit === 'second' ? 1000 : unit === 'hour' ? 3600000 : unit === 'day' ? 86400000 : 60000;
    return { limit, windowMs };
  });
}

function getModelRateLimits(db: any, provider: any, modelId: string): { limit: number; windowMs: number }[] {
  const pricing = getModelSettings(db, provider, modelId);
  const rateLimitStr = pricing?.rate_limits || APP_CONFIG.default_provider_model_rate_limits;
  return parseRateLimits(rateLimitStr);
}

function getRateLimitLabel(db: any, provider: any, modelId: string): string {
  const pricing = getModelSettings(db, provider, modelId);
  const raw = pricing?.rate_limits || APP_CONFIG.default_provider_model_rate_limits;
  return raw.split(',').map((e: string) => {
    const parts = e.trim().split(':');
    return `${parts[0]} per ${parts[2] || 'minute'}`;
  }).join(' and ');
}

function encryptProviderKey(plaintext: string, userId: string): string {
  if (!plaintext) return '';
  const key = crypto.scryptSync(SECRET_KEY, userId, 32);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  let encrypted = cipher.update(plaintext, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag().toString('hex');
  return `${iv.toString('hex')}:${authTag}:${encrypted}`;
}

function decryptProviderKey(encrypted: string, userId: string): string {
  if (!encrypted) return '';
  const key = crypto.scryptSync(SECRET_KEY, userId, 32);
  const parts = encrypted.split(':');
  const iv = Buffer.from(parts[0], 'hex');
  const authTag = Buffer.from(parts[1], 'hex');
  const encryptedText = parts[2];
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);
  let decrypted = decipher.update(encryptedText, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

function resolveProviderApiKey(provider: any): string {
  if (!provider.api_key) return '';
  // C4: immutable provider keys may now be stored encrypted (prefixed 'enc:')
  // if SECRET_KEY was explicitly set in the environment.
  if (provider.immutable) {
    if (provider.api_key.startsWith('enc:')) {
      return decryptProviderKey(provider.api_key.slice(4), 'immutable');
    }
    return provider.api_key; // legacy plaintext
  }
  return decryptProviderKey(provider.api_key, provider.owner_id);
}

function buildProviderChatBody(body: Record<string, any>, model: string, messages: any[], stream: boolean) {
  const { provider: _provider, provider_id: _providerId, ...passthrough } = body;
  return { ...passthrough, model, messages, stream };
}

// --- MIDDLEWARE ---
app.use((req, res, next) => {
  if (BASE_PATH && (req.url === BASE_PATH || req.url.startsWith(`${BASE_PATH}?`))) {
    return res.redirect(308, `${BASE_PATH}/${req.url.slice(BASE_PATH.length)}`);
  }
  if (BASE_PATH && req.url.startsWith(`${BASE_PATH}/`)) req.url = req.url.slice(BASE_PATH.length);
  next();
});

// Security headers (H4)
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"], // required for Vite HMR in dev
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:', 'https:'],
      connectSrc: ["'self'"],
      fontSrc: ["'self'", 'https:'],
      upgradeInsecureRequests: null,
    }
  },
  crossOriginEmbedderPolicy: false, // allow OAuth provider favicon loading
}));
app.use(express.json({ limit: '10mb' }));

// --- JSON LOGGING MIDDLEWARE ---
app.use((req: Request, res: Response, next: NextFunction) => {
  const startTime = Date.now();
  const originalSend = res.send;
  
  // Capture response data for logging
  res.send = function(body) {
    const duration = Date.now() - startTime;
    const logEntry: any = {
      timestamp: new Date().toISOString(),
      source_ip: req.ip || req.socket.remoteAddress,
      target_url: req.originalUrl,
      target_path: req.path,
      method: req.method,
      status_code: res.statusCode,
      user_agent: req.get('User-Agent') || '-',
      api_key: req.headers['x-api-key-id'] || '-',
      refer: req.get('Referer') || '-',
      duration_ms: duration,
    };
    if (res.locals.log) Object.assign(logEntry, res.locals.log);
    console.log(JSON.stringify(logEntry));
    return originalSend.call(this, body);
  };
  
  next();
});

// --- JWT HELPERS ---
function signJwt(user: any): string {
  return jwt.sign({ sub: user.id, name: user.name }, JWT_SECRET, { expiresIn: JWT_EXPIRY });
}

function verifyJwtToken(token: string): { sub: string; name: string } | null {
  try {
    return jwt.verify(token, JWT_SECRET) as { sub: string; name: string };
  } catch {
    return null;
  }
}

// In-memory OAuth state store (replaces session-based storage for CSRF)
const oauthStates = new Map<string, { provider: string; timestamp: number }>();

// In-memory one-time auth code store for OAuth token exchange (C1)
const oauthCodes = new Map<string, { token: string; timestamp: number }>();

// --- AUTH RATE LIMITER (C5) ---
// Tracks failed login attempts per IP to prevent brute-force attacks.
const AUTH_RATE_MAX = parseInt(process.env.AUTH_RATE_LIMIT_MAX || '10', 10);
const AUTH_RATE_WINDOW_MS = parseInt(process.env.AUTH_RATE_LIMIT_WINDOW_MS || String(15 * 60 * 1000), 10);

const authAttempts = new Map<string, { count: number; windowStart: number }>();

function checkAuthRateLimit(ip: string): boolean {
  const now = Date.now();
  let entry = authAttempts.get(ip);
  if (!entry || now - entry.windowStart > AUTH_RATE_WINDOW_MS) {
    entry = { count: 0, windowStart: now };
    authAttempts.set(ip, entry);
  }
  entry.count++;
  return entry.count <= AUTH_RATE_MAX;
}

function resetAuthRateLimit(ip: string): void {
  authAttempts.delete(ip);
}

// Periodically clean up expired auth rate-limit windows
setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of authAttempts.entries()) {
    if (now - entry.windowStart > AUTH_RATE_WINDOW_MS) {
      authAttempts.delete(ip);
    }
  }
}, 60_000);

// --- RBAC CORE ---
async function getAuthContext(req: Request) {
  const authHeader = req.headers.authorization;
  const db = await loadDb();
  
  let user = null;
  let apiKey = null;
  let authState: 'none' | 'jwt' | 'api_key' | 'invalid' = authHeader === undefined ? 'none' : 'invalid';
  const now = Math.floor(Date.now() / 1000);

  // 1. JWT Bearer Auth (for UI)
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const rawToken = authHeader.substring(7);

    // Try JWT first (shorter, no prefix)
    if (rawToken.length < 30 || !rawToken.startsWith('sk-')) {
      const payload = verifyJwtToken(rawToken);
      if (payload) {
        user = db.users.find((u: any) => u.id === payload.sub);
        if (user) {
          const keyId = req.headers['x-api-key-id'];
          if (keyId) {
            const keyFound = db.api_keys.find((entry: any) =>
              entry.id === keyId &&
              (entry.expires_at == null || entry.expires_at > now) &&
              (entry.owner_id === user.id || (entry.group_id && isGroupMember(user, db, entry.group_id)))
            );
            if (keyFound) {
              apiKey = keyFound;
              apiKey.last_used_at = now;
              await saveDb(db);
            }
          }
          authState = 'jwt';
          return { user, db, apiKey, authState };
        }
      }
    }

    // 2. API Key Bearer Auth (for API)
    if (rawToken.startsWith('sk-')) {
      const prefix = rawToken.slice(0, 11);
      const keyFound = db.api_keys.find((entry: any) => 
        entry.key_prefix === prefix &&
        (entry.expires_at == null || entry.expires_at > now) &&
        bcrypt.compareSync(rawToken, entry.key_hash)
      );
      if (keyFound) {
        user = db.users.find((u: any) => u.id === keyFound.owner_id);
        if (user) {
          apiKey = keyFound;
          apiKey.last_used_at = now;
          authState = 'api_key';
          await saveDb(db);
        }
      }
    }
  }
  
  return { user, db, apiKey, authState };
}

function hasPermission(user: any, db: any, verb: string, resource: string, resourceName: string): boolean {
  // Find all roles for this user
  const userRoleIds = new Set<string>();
  
  // Direct group memberships
  db.groups.forEach((group: any) => {
    group.members.forEach((member: any) => {
      if (member.ids.includes(user.id) || member.ids.includes("*")) {
        member.role_ids.forEach((rid: string) => userRoleIds.add(rid));
      }
    });
  });

  // Check roles
  for (const roleId of userRoleIds) {
    const role = db.roles.find((r: any) => r.id === roleId);
    if (!role) continue;

    for (const perm of role.permissions) {
      const verbMatch = perm.verbs.includes("*") || perm.verbs.includes(verb);
      const resourceMatch = perm.resources.includes("*") || perm.resources.includes(resource);
      const nameMatch = perm.resource_names_regex.some((regex: string) => new RegExp(regex).test(resourceName));

      if (verbMatch && resourceMatch && nameMatch) return true;
    }
  }

  return false;
}

function hasApiKeyPermission(user: any, apiKey: any, db: any, verb: string, resource: string, resourceName: string): boolean {
  if (!apiKey?.group_id) return hasPermission(user, db, verb, resource, resourceName);
  return hasPermission(user, {
    ...db,
    groups: db.groups.filter((group: any) => group.id === 'default' || group.id === apiKey.group_id)
  }, verb, resource, resourceName);
}

function canAccessProviderForApiKey(user: any, apiKey: any, db: any, provider: any): boolean {
  if (apiKey?.group_id) return provider.group_id === apiKey.group_id;
  return provider.owner_id === user.id || (provider.group_id && isGroupMember(user, db, provider.group_id));
}

function canUseOfferingForApiKey(user: any, apiKey: any, db: any, provider: any, offering: ProviderOffering): boolean {
  if (!offering || offering.enabled === false) return false;
  if (offering.visibility !== 'public' && !canAccessProviderForApiKey(user, apiKey, db, provider)) return false;
  return hasApiKeyPermission(user, apiKey, db, 'use', 'providers', provider.name) &&
    hasApiKeyPermission(user, apiKey, db, 'use', 'models', offering.model_id);
}

function getUsableProviderOfferings(user: any, apiKey: any, db: any, provider: any): ProviderOffering[] {
  return getProviderOfferings(provider).filter(offering => canUseOfferingForApiKey(user, apiKey, db, provider, offering));
}

function compareProviders(left: any, right: any): number {
  if (!!left.immutable !== !!right.immutable) return left.immutable ? -1 : 1;
  const leftKey = `${left.name}\u0000${left.id}`;
  const rightKey = `${right.name}\u0000${right.id}`;
  return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
}

// --- AUTH LOGIC ---
app.post('/api/auth/login', async (req, res) => {
  const ip = req.ip || req.socket.remoteAddress || 'unknown';
  // C5: brute-force rate limiting per client IP
  if (!checkAuthRateLimit(ip)) {
    return res.status(429).json({ detail: "Too many login attempts. Please try again later." });
  }

  const username = req.body.username?.toLowerCase();
  const password = req.body.password;
  const db = await loadDb();

  const user = db.users.find((u: any) => u.name.toLowerCase() === username);

  // OAuth-only users cannot use password login — message is intentionally
  // distinct from the generic failure to guide the user to the SSO button.
  if (user && !user.password_hash) {
    return res.status(401).json({ detail: "This account uses Single Sign-On. Please use the 'Continue with Identity Provider' button to sign in." });
  }

  // H3: use a single generic message for both "user not found" and "wrong password"
  // to prevent username enumeration.
  const INVALID_CREDS = "Invalid credentials.";

  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ detail: INVALID_CREDS });
  }

  // Successful login — reset the rate limit counter for this IP
  resetAuthRateLimit(ip);

  // Generate key if none exists
  let newKey = null;
  const hasKey = db.api_keys.some((k: any) => k.owner_id === user.id);
  if (!hasKey) {
    const rawKey = `sk-${crypto.randomBytes(16).toString('hex')}`;
    const keyEntry = {
      id: `key-id-${crypto.randomUUID()}`,
      name: "default",
      owner_id: user.id,
      key_prefix: rawKey.slice(0, 11),
      key_hash: bcrypt.hashSync(rawKey, 10),
      created_at: Math.floor(Date.now() / 1000),
      expires_at: Math.floor(Date.now() / 1000) + (365 * 24 * 60 * 60),
      last_used_at: null
    };
    db.api_keys.push(keyEntry);
    await saveDb(db);
    newKey = rawKey;
  }

  await ensureAdminForEmail(db, user.name);

  const token = signJwt(user);
  res.json({ token, user: { id: user.id, name: user.name }, api_key: newKey });
});

app.post('/api/auth/signup', async (req, res) => {
  const ip = req.ip || req.socket.remoteAddress || 'unknown';
  // C5: apply the same rate limiter to signup to prevent account-creation spam
  if (!checkAuthRateLimit(ip)) {
    return res.status(429).json({ detail: "Too many requests. Please try again later." });
  }

  if (!SIGNUPS_ENABLED) {
    return res.status(403).json({ detail: "Signups are disabled." });
  }

  const username = req.body.username?.toLowerCase();
  const password = req.body.password;
  if (!username || !password || password.length < 8) {
    return res.status(400).json({ detail: "Invalid data" });
  }
  const db = await loadDb();
  if (db.users.some((u: any) => u.name.toLowerCase() === username)) {
    return res.status(409).json({ detail: "User exists" });
  }
  
  const userId = `user-id-${crypto.randomUUID()}`;
  db.users.push({
    id: userId,
    name: username,
    password_hash: bcrypt.hashSync(password, 10)
  });

  // Generate initial key
  const rawKey = `sk-${crypto.randomBytes(16).toString('hex')}`;
  db.api_keys.push({
    id: `key-id-${crypto.randomUUID()}`,
    name: "default",
    owner_id: userId,
    key_prefix: rawKey.slice(0, 11),
    key_hash: bcrypt.hashSync(rawKey, 10),
    created_at: Math.floor(Date.now() / 1000),
    expires_at: Math.floor(Date.now() / 1000) + (365 * 24 * 60 * 60),
    last_used_at: null
  });

  await saveDb(db);
  const newUser = db.users.find((u: any) => u.id === userId);
  await ensureAdminForEmail(db, newUser.name);
  const token = signJwt(newUser);
  res.json({ token, user: { id: newUser.id, name: newUser.name }, api_key: rawKey });
});

app.post('/api/auth/logout', (_req, res) => {
  res.json({ status: "success" });
});

app.get('/api/auth/session', (req, res) => {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const payload = verifyJwtToken(authHeader.substring(7));
    if (payload) {
      return res.json({ logged_in: true, username: payload.name, user: { id: payload.sub, name: payload.name } });
    }
  }
  res.json({ logged_in: false });
});

app.delete('/api/auth/account', async (req, res) => {
  const { user, db } = await getAuthContext(req);
  if (!user) return res.status(401).json({ detail: "Auth required" });

  const userId = user.id;

  // Collect user's key IDs before removing keys
  const userKeyIds = db.api_keys.filter((k: any) => k.owner_id === userId).map((k: any) => k.id);

  // Delete all user messages
  db.messages = db.messages.filter((m: any) => m.user_id !== userId);

  // Delete user's providers (keep immutable ones)
  db.providers = db.providers.filter((p: any) => p.owner_id !== userId || p.immutable);

  // Delete usage events tied to this user's keys
  db.usage_events = db.usage_events.filter((e: any) => !userKeyIds.includes(e.api_key_id));

  // Delete user's API keys
  db.api_keys = db.api_keys.filter((k: any) => k.owner_id !== userId);

  // Delete the user
  db.users = db.users.filter((u: any) => u.id !== userId);

  await saveDb(db);

  res.json({ status: "success" });
});

// --- OAUTH ENDPOINTS ---
app.get('/api/auth/oauth/config', (req, res) => {
  res.json({
    oauth_enabled: OAUTH_ENABLED,
    providers: OAUTH_PROVIDERS.map(p => ({ id: p.id, name: p.name })),
  });
});

app.get('/api/auth/oauth/authorize', async (req, res) => {
  const providerId = req.query.provider as string;
  if (!providerId) {
    return res.status(400).json({ detail: "Missing provider parameter" });
  }

  const provider = OAUTH_PROVIDERS.find(p => p.id === providerId);
  if (!provider) {
    return res.status(400).json({ detail: `Unknown OAuth provider: ${providerId}` });
  }

  try {
    const authorizeUrl = await resolveOAuthEndpoint(provider, 'authorization_endpoint');
    const state = crypto.randomUUID();
    oauthStates.set(state, { provider: providerId, timestamp: Date.now() });

    const params = new URLSearchParams({
      client_id: provider.client_id,
      redirect_uri: `${getBaseUrl(req)}/api/auth/oauth/callback`,
      response_type: 'code',
      scope: provider.scope,
      state,
    });

    res.redirect(`${authorizeUrl}?${params.toString()}`);
  } catch (err: any) {
    console.error("OAuth authorize error:", err.message);
    res.status(502).json({ detail: "Failed to contact identity provider" });
  }
});

app.get('/api/auth/oauth/callback', async (req, res) => {
  const frontendUrl = getBaseUrl(req);

  if (req.query.error) {
    return res.redirect(frontendUrl);
  }

  const { code, state } = req.query;

  const storedState = oauthStates.get(state as string);
  if (!storedState || Date.now() - storedState.timestamp > 600000) {
    return res.status(400).send("Invalid or expired state parameter");
  }

  const providerId = storedState.provider;
  oauthStates.delete(state as string);

  const provider = OAUTH_PROVIDERS.find(p => p.id === providerId);
  if (!provider) {
    return res.status(400).send("Unknown OAuth provider");
  }

  if (!code) {
    return res.status(400).send("No authorization code provided");
  }

  try {
    const tokenUrl = await resolveOAuthEndpoint(provider, 'token_endpoint');
    const redirectUri = `${getBaseUrl(req)}/api/auth/oauth/callback`;

    const tokenParams = new URLSearchParams({
      code: code as string,
      client_id: provider.client_id,
      client_secret: provider.client_secret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    });

    const tokenResponse = await axios.post(tokenUrl, tokenParams.toString(), {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      timeout: 15000,
    });

    const accessToken = tokenResponse.data.access_token;
    if (!accessToken) {
      throw new Error("No access token in response");
    }

    let email: string | null = null;

    if (provider.id === 'github') {
      const userResp = await axios.get(await resolveOAuthEndpoint(provider, 'userinfo_endpoint'), {
        headers: { 'Authorization': `Bearer ${accessToken}`, 'Accept': 'application/vnd.github.v3+json' },
        timeout: 10000,
      });
      email = userResp.data.login;
      try {
        const emailsResp = await axios.get('https://api.github.com/user/emails', {
          headers: { 'Authorization': `Bearer ${accessToken}`, 'Accept': 'application/vnd.github.v3+json' },
          timeout: 10000,
        });
        const primary = emailsResp.data.find((e: any) => e.primary);
        if (primary?.email) email = primary.email;
      } catch (e) {}
    } else {
      const userinfoUrl = await resolveOAuthEndpoint(provider, 'userinfo_endpoint');
      const userInfoResponse = await axios.get(userinfoUrl, {
        headers: { 'Authorization': `Bearer ${accessToken}` },
        timeout: 10000,
      });
      const userInfo = userInfoResponse.data;
      email = userInfo.email || userInfo.preferred_username || userInfo.sub || null;
    }

    if (!email) {
      return res.status(400).send("Could not determine user identity from provider");
    }

    const db = await loadDb();
    let user = db.users.find((u: any) => u.name === email);

    if (!user) {
      const userId = `user-id-${crypto.randomUUID()}`;
      db.users.push({
        id: userId,
        name: email,
        password_hash: '',
        oauth_provider: providerId,
      });

      const rawKey = `sk-${crypto.randomBytes(16).toString('hex')}`;
      db.api_keys.push({
        id: `key-id-${crypto.randomUUID()}`,
        name: "default",
        owner_id: userId,
        key_prefix: rawKey.slice(0, 11),
        key_hash: bcrypt.hashSync(rawKey, 10),
        created_at: Math.floor(Date.now() / 1000),
        expires_at: Math.floor(Date.now() / 1000) + (365 * 24 * 60 * 60),
        last_used_at: null
      });

      await saveDb(db);
    }

    const token = signJwt(user);

    // C1: pass a short-lived one-time code instead of the JWT in the URL.
    // The frontend exchanges the code via POST /api/auth/oauth/exchange,
    // which responds with the JWT in a JSON body (never in a URL / log).
    const code = crypto.randomBytes(24).toString('hex');
    oauthCodes.set(code, { token, timestamp: Date.now() });
    // Clean up codes older than 5 minutes
    for (const [k, v] of oauthCodes.entries()) {
      if (Date.now() - v.timestamp > 300_000) oauthCodes.delete(k);
    }

    res.redirect(`${frontendUrl}/?oauth_code=${code}`);
  } catch (err: any) {
    console.error("OAuth callback error:", err.message);
    res.status(502).send("OAuth authentication failed");
  }
});

// C1: one-time code exchange — the JWT is returned in a JSON body, never in a URL.
app.post('/api/auth/oauth/exchange', (req, res) => {
  const { code } = req.body;
  if (!code || typeof code !== 'string') {
    return res.status(400).json({ detail: 'Missing code' });
  }
  const entry = oauthCodes.get(code);
  if (!entry) {
    return res.status(400).json({ detail: 'Invalid or expired code' });
  }
  if (Date.now() - entry.timestamp > 300_000) {
    oauthCodes.delete(code);
    return res.status(400).json({ detail: 'Invalid or expired code' });
  }
  oauthCodes.delete(code);
  res.json({ token: entry.token });
});

// --- KEYS LOGIC ---
app.get('/api/keys', async (req, res) => {
  const { user, db } = await getAuthContext(req);
  if (!user) return res.status(401).json({ detail: "Auth required" });
  
  const groupId = req.query.group_id as string;
  const keys = groupId
    ? db.api_keys.filter((k: any) => k.group_id === groupId)
    : db.api_keys.filter((k: any) => k.owner_id === user.id && !k.group_id);
  res.json(keys.map((k: any) => ({ 
    id: k.id, 
    name: k.name, 
    key_prefix: k.key_prefix, 
    created_at: k.created_at,
    expires_at: k.expires_at,
    last_used_at: k.last_used_at,
    key: k.key_prefix + "********" 
  })));
});

app.post('/api/keys', async (req, res) => {
  const { user, db } = await getAuthContext(req);
  if (!user) return res.status(401).json({ detail: "Auth required" });
  
  const { name, group_id } = req.body;
  const keyName = name || 'default';
  
  if (group_id) {
    if (!isGroupMember(user, db, group_id)) {
      return res.status(403).json({ detail: "Not a member of this group" });
    }
    const groupKeyCount = db.api_keys.filter((k: any) => k.group_id === group_id).length;
    if (groupKeyCount >= 5) {
      return res.status(400).json({ detail: "Maximum of 5 API keys allowed per group" });
    }
    const existingKey = db.api_keys.find((k: any) => k.group_id === group_id && k.name === keyName);
    if (existingKey) {
      return res.status(409).json({ detail: `An API key with name "${keyName}" already exists in this group` });
    }
  } else {
    const userKeyCount = db.api_keys.filter((k: any) => k.owner_id === user.id && !k.group_id).length;
    if (userKeyCount >= 5) {
      return res.status(400).json({ detail: "Maximum of 5 API keys allowed" });
    }
    const existingKey = db.api_keys.find((k: any) => k.owner_id === user.id && !k.group_id && k.name === keyName);
    if (existingKey) {
      return res.status(409).json({ detail: `An API key with name "${keyName}" already exists` });
    }
  }
  const rawKey = `sk-${crypto.randomBytes(16).toString('hex')}`;
  const entry: any = {
    id: `key-id-${crypto.randomUUID()}`,
    name: keyName,
    owner_id: user.id,
    group_id: group_id || null,
    key_prefix: rawKey.slice(0, 11),
    key_hash: bcrypt.hashSync(rawKey, 10),
    created_at: Math.floor(Date.now() / 1000),
    expires_at: Math.floor(Date.now() / 1000) + (365 * 24 * 60 * 60),
    last_used_at: null
  };
  
  db.api_keys.push(entry);
  await saveDb(db);
  res.json({ ...entry, key: rawKey, key_hash: "********" });
});

app.delete('/api/keys/:id', async (req, res) => {
  const { user, db } = await getAuthContext(req);
  if (!user) return res.status(401).json({ detail: "Auth required" });
  
  const keyId = req.params.id;
  const keyIndex = db.api_keys.findIndex((k: any) => {
    if (k.id !== keyId) return false;
    if (k.owner_id === user.id) return true;
    if (k.group_id && isGroupMember(user, db, k.group_id)) return true;
    return false;
  });
  if (keyIndex === -1) return res.status(404).json({ detail: "Key not found" });
  
  db.api_keys.splice(keyIndex, 1);
  await saveDb(db);
  res.json({ status: "success" });
});

function queryString(value: unknown, name: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') throw new Error(`${name} must be supplied once`);
  return value;
}

function parsePageLimit(value: unknown, fallback = 50): number {
  if (value === undefined) return fallback;
  if (typeof value !== 'string' || !/^\d+$/.test(value)) throw new Error('limit must be an integer between 1 and 100');
  const limit = Number(value);
  if (limit < 1 || limit > 100) throw new Error('limit must be an integer between 1 and 100');
  return limit;
}

function encodeCursor(parts: string[]): string {
  return Buffer.from(JSON.stringify(parts), 'utf8').toString('base64url');
}

function decodeCursor(value: unknown, size: number): string[] | null {
  if (value === undefined) return null;
  if (typeof value !== 'string' || !value || value.length > 2048) throw new Error('Invalid pagination cursor');
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
    if (!Array.isArray(parsed) || parsed.length !== size || parsed.some(part => typeof part !== 'string')) {
      throw new Error('Invalid pagination cursor');
    }
    return parsed;
  } catch {
    throw new Error('Invalid pagination cursor');
  }
}

function serializeProvider(user: any, db: any, provider: any) {
  const offerings = getProviderOfferings(provider).filter(offering =>
    offering.visibility === 'public' || canManageProvider(user, db, provider)
  );
  const firstOffering = offerings[0];
  return {
    id: provider.id,
    name: provider.name,
    base_url: provider.base_url,
    models: offerings.map(offering => offering.model_id).join(','),
    models_path: provider.models_path || 'models',
    visibility: provider.visibility,
    immutable: provider.immutable,
    model_count: offerings.length,
    rate_limits: firstOffering?.rate_limits || APP_CONFIG.default_provider_model_rate_limits,
    queue_max_size: firstOffering?.queue_max_size ?? APP_CONFIG.default_provider_model_queue_max_size
  };
}

app.get('/api/providers', async (req, res) => {
  const { user, db } = await getAuthContext(req);
  if (!user) return res.status(401).json({ detail: "Auth required" });

  let groupId: string | undefined;
  try {
    groupId = queryString(req.query.group_id, 'group_id');
  } catch (error: any) {
    return res.status(400).json({ detail: error.message });
  }
  if (groupId && !isGroupMember(user, db, groupId) && !isGlobalAdmin(user, db)) {
    return res.status(403).json({ detail: 'Not a member of this group' });
  }
  const providers = db.providers.filter((p: any) =>
    groupId
      ? p.group_id === groupId
      : (p.visibility === 'public' || (p.owner_id === user.id && !p.group_id))
  ).sort((left: any, right: any) => left.name < right.name ? -1 : left.name > right.name ? 1 : left.id < right.id ? -1 : left.id > right.id ? 1 : 0);
  const rows = providers.map((provider: any) => serializeProvider(user, db, provider));
  const paginationRequested = req.query.limit !== undefined || req.query.after !== undefined;
  if (!paginationRequested) return res.json(rows);

  try {
    const limit = parsePageLimit(req.query.limit);
    const cursor = decodeCursor(req.query.after, 2);
    const remaining = cursor
      ? rows.filter((row: any) => row.name > cursor[0] || (row.name === cursor[0] && row.id > cursor[1]))
      : rows;
    const page = remaining.slice(0, limit);
    const hasMore = remaining.length > limit;
    return res.json({
      object: 'list',
      data: page,
      has_more: hasMore,
      next_cursor: hasMore && page.length > 0 ? encodeCursor([page[page.length - 1].name, page[page.length - 1].id]) : null,
    });
  } catch (error: any) {
    return res.status(400).json({ detail: error.message });
  }
});

function canManageProvider(user: any, db: any, provider: any): boolean {
  return isGlobalAdmin(user, db) || provider.owner_id === user.id || !!(provider.group_id && isGroupMember(user, db, provider.group_id));
}

function serializeModelOffering(user: any, db: any, provider: any, offering: ProviderOffering) {
  return {
    id: offering.id,
    model_id: offering.model_id,
    provider_id: provider.id,
    provider_name: provider.name,
    source: offering.source,
    visibility: offering.visibility,
    enabled: offering.enabled,
    created_at: offering.created_at,
    last_seen_at: offering.last_seen_at,
    rate_limits: offering.rate_limits,
    queue_max_size: offering.queue_max_size,
    can_update_visibility: !provider.immutable && canManageProvider(user, db, provider),
  };
}

app.get('/api/models', async (req, res) => {
  const { user, db, apiKey, authState } = await getAuthContext(req);
  if (!user || authState !== 'jwt') return res.status(401).json({ detail: 'UI authentication required' });

  try {
    const groupId = queryString(req.query.group_id, 'group_id');
    const providerId = queryString(req.query.provider_id, 'provider_id');
    const visibility = queryString(req.query.visibility, 'visibility');
    const source = queryString(req.query.source, 'source');
    const enabled = queryString(req.query.enabled, 'enabled');
    const usable = queryString(req.query.usable, 'usable');
    const search = (queryString(req.query.q, 'q') || '').trim().toLowerCase();
    const limit = parsePageLimit(req.query.limit);
    const cursor = decodeCursor(req.query.after, 3);
    if (groupId && !isGroupMember(user, db, groupId) && !isGlobalAdmin(user, db)) {
      return res.status(403).json({ detail: 'Not a member of this group' });
    }
    if (visibility !== undefined && visibility !== 'public' && visibility !== 'private') {
      return res.status(400).json({ detail: 'visibility must be public or private' });
    }
    if (source !== undefined && source !== 'manual' && source !== 'discovered') {
      return res.status(400).json({ detail: 'source must be manual or discovered' });
    }
    if (enabled !== undefined && enabled !== 'true' && enabled !== 'false') {
      return res.status(400).json({ detail: 'enabled must be true or false' });
    }
    if (usable !== undefined && usable !== 'true') {
      return res.status(400).json({ detail: 'usable must be true' });
    }
    const usableOnly = usable === 'true';

    const rows: any[] = [];
    for (const provider of db.providers) {
      if (groupId && !usableOnly && provider.group_id !== groupId) continue;
      for (const offering of getProviderOfferings(provider, true)) {
        const visibleInScope = usableOnly
          ? !!apiKey && canUseOfferingForApiKey(user, apiKey, db, provider, offering)
          : groupId
            ? provider.group_id === groupId
            : isGlobalAdmin(user, db) || (provider.owner_id === user.id && !provider.group_id) || offering.visibility === 'public';
        if (!visibleInScope) continue;
        if (providerId && provider.id !== providerId) continue;
        if (visibility && offering.visibility !== visibility) continue;
        if (source && offering.source !== source) continue;
        if (enabled !== undefined && offering.enabled !== (enabled === 'true')) continue;
        if (search && !offering.model_id.toLowerCase().includes(search) && !provider.name.toLowerCase().includes(search)) continue;
        rows.push(serializeModelOffering(user, db, provider, offering));
      }
    }
    rows.sort((left, right) => {
      const leftKey = `${left.provider_name}\u0000${left.model_id}\u0000${left.id}`;
      const rightKey = `${right.provider_name}\u0000${right.model_id}\u0000${right.id}`;
      return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
    });
    const remaining = cursor
      ? rows.filter(row => {
          const key = [row.provider_name, row.model_id, row.id];
          return key[0] > cursor[0] ||
            (key[0] === cursor[0] && key[1] > cursor[1]) ||
            (key[0] === cursor[0] && key[1] === cursor[1] && key[2] > cursor[2]);
        })
      : rows;
    const page = remaining.slice(0, limit);
    const hasMore = remaining.length > limit;
    return res.json({
      object: 'list',
      data: page,
      has_more: hasMore,
      next_cursor: hasMore && page.length > 0
        ? encodeCursor([page[page.length - 1].provider_name, page[page.length - 1].model_id, page[page.length - 1].id])
        : null,
    });
  } catch (error: any) {
    return res.status(400).json({ detail: error.message });
  }
});

app.patch('/api/models/:id', async (req, res) => {
  const { user, db, authState } = await getAuthContext(req);
  if (!user || authState !== 'jwt') return res.status(401).json({ detail: 'UI authentication required' });
  if (req.body?.visibility !== 'public' && req.body?.visibility !== 'private') {
    return res.status(400).json({ detail: 'visibility must be public or private' });
  }

  let selectedProvider: any;
  let selectedOffering: ProviderOffering | undefined;
  for (const provider of db.providers) {
    const offering = getProviderOfferings(provider, true).find(candidate => candidate.id === req.params.id);
    if (offering) {
      selectedProvider = provider;
      selectedOffering = offering;
      break;
    }
  }
  if (!selectedProvider || !selectedOffering) return res.status(404).json({ detail: 'Model offering not found' });
  if (selectedProvider.immutable) return res.status(403).json({ detail: 'Default provider models must remain public' });
  if (!canManageProvider(user, db, selectedProvider)) return res.status(403).json({ detail: 'Cannot modify this model offering' });

  selectedOffering.visibility = req.body.visibility;
  await saveDb(db);
  return res.json(serializeModelOffering(user, db, selectedProvider, selectedOffering));
});

app.post('/api/providers/test', async (req, res) => {
  const { user, db } = await getAuthContext(req);
  if (!user) return res.status(401).json({ detail: "Auth required" });

  const { base_url, models_path, api_key } = req.body;
  if (!base_url) return res.status(400).json({ detail: "base_url is required" });

  // ponytail: this is per-process; move the limiter to shared storage for multi-instance enforcement.
  const rateLimit = rateLimiter.check(user.id, 'provider-connection-test', [{ limit: 10, windowMs: 60_000 }]);
  if (!rateLimit.allowed) return res.status(429).json({ detail: "Too many connection tests. Please try again later." });

  let endpoint: string | undefined;
  let requestSignal: AbortSignal | undefined;
  try {
    const deadline = Date.now() + PROVIDER_TEST_TIMEOUT_MS;
    const resolved = resolveProviderModelsEndpoint(base_url, models_path);
    endpoint = resolved.endpoint.toString();
    const providerApiKey = parseProviderApiKey(api_key);
    const target = await validateProviderUrl(endpoint, isGlobalAdmin(user, db) ? 'private' : 'public', PROVIDER_TEST_TIMEOUT_MS);
    const timeout = deadline - Date.now();
    if (timeout <= 0) throw new ProviderUrlError('dns', 'Connection test timed out');
    requestSignal = AbortSignal.timeout(timeout);
    const response = await axios.get(endpoint, {
      ...providerRequestConfig(target),
      timeout,
      signal: requestSignal,
      maxContentLength: PROVIDER_MODELS_RESPONSE_MAX_BYTES,
      responseType: 'json',
      headers: {
        'Accept': 'application/json',
        ...(providerApiKey ? { 'Authorization': `Bearer ${providerApiKey}` } : {}),
      },
      validateStatus: () => true,
    });
    if (response.status < 200 || response.status >= 300) {
      return res.status(502).json({
        detail: `Models endpoint returned HTTP ${response.status}`,
        status: response.status,
        endpoint,
      });
    }
    let models: string[];
    try {
      models = parseDiscoveredModelIds(response.data);
    } catch (error: any) {
      return res.status(502).json({ detail: error.message, status: response.status, endpoint });
    }
    return res.json({
      ok: true,
      status: response.status,
      models,
      endpoint,
      detail: `Discovered ${models.length} model${models.length === 1 ? '' : 's'}`,
    });
  } catch (error: any) {
    if (error instanceof ProviderUrlError) return sendProviderUrlError(res, error, true);
    if (requestSignal?.aborted) {
      return res.status(504).json({ detail: 'Models endpoint request timed out', ...(endpoint ? { endpoint } : {}) });
    }
    const upstreamStatus = typeof error.response?.status === 'number' ? error.response.status : undefined;
    const upstreamCode = typeof error.code === 'string' && /^[A-Z\d_]{1,64}$/.test(error.code)
      ? error.code
      : 'UPSTREAM_ERROR';
    return res.status(502).json({
      detail: `Models endpoint request failed (${upstreamCode})`,
      ...(upstreamStatus !== undefined ? { status: upstreamStatus } : {}),
      ...(endpoint ? { endpoint } : {}),
    });
  }
});

app.post('/api/providers', async (req, res) => {
  const { user, db } = await getAuthContext(req);
  if (!user) return res.status(401).json({ detail: "Auth required" });
  
  const { name, base_url, models, models_path, models_source, api_key, rate_limits, queue_max_size, group_id } = req.body;
  const normalizedName = typeof name === 'string' ? name.trim() : '';
  if (!normalizedName || !base_url) {
    return res.status(400).json({ detail: "Name and base_url are required" });
  }
  if (models_source !== undefined && models_source !== 'manual' && models_source !== 'discovered') {
    return res.status(400).json({ detail: "models_source must be manual or discovered" });
  }
  let modelNames: string[];
  try {
    modelNames = parseProviderModelIds(models === undefined || models === '' ? 'default' : models);
  } catch (error: any) {
    return res.status(400).json({ detail: error.message });
  }
  // ponytail: this is per-process; move the limiter to shared storage for multi-instance enforcement.
  const urlRateLimit = rateLimiter.check(user.id, 'provider-url-change', [{ limit: 10, windowMs: 60_000 }]);
  if (!urlRateLimit.allowed) return res.status(429).json({ detail: "Too many provider URL changes. Please try again later." });
  let validatedUrl: ValidatedProviderUrl;
  let normalizedModelsPath: string;
  try {
    normalizedModelsPath = resolveProviderModelsEndpoint(base_url, models_path).modelsPath;
    validatedUrl = await validateProviderUrl(base_url, isGlobalAdmin(user, db) ? 'private' : 'public');
  } catch (error) {
    return sendProviderUrlError(res, error);
  }
  if (rate_limits && !isValidRateLimits(rate_limits)) {
    return res.status(400).json({ detail: "Invalid rate limits format. Use e.g. 10:request:minute,1:request:second" });
  }
  if (queue_max_size !== undefined && (!Number.isInteger(queue_max_size) || queue_max_size < 1)) {
    return res.status(400).json({ detail: "Queue max size must be a positive integer" });
  }
  
  if (group_id) {
    if (!isGroupMember(user, db, group_id)) {
      return res.status(403).json({ detail: "Not a member of this group" });
    }
    const existing = db.providers.find((p: any) => p.name === normalizedName && p.group_id === group_id);
    if (existing) {
      return res.status(409).json({ detail: `A provider with name "${normalizedName}" already exists in this group` });
    }
  } else {
    const existing = db.providers.find((p: any) => 
      p.name === normalizedName && !p.group_id && (p.owner_id === user.id || p.visibility === 'public')
    );
    if (existing) {
      return res.status(409).json({ detail: `A provider with name "${normalizedName}" already exists` });
    }
  }
  
  const entry: any = {
    id: `provider-id-${crypto.randomUUID()}`,
    name: normalizedName,
    base_url,
    models: modelNames.join(','),
    models_path: normalizedModelsPath,
    api_key: api_key ? encryptProviderKey(api_key, user.id) : '',
    owner_id: user.id,
    group_id: group_id || null,
    visibility: 'private',
    immutable: false,
    allow_private: validatedUrl.requiresPrivateAccess,
    offerings: []
  };
  
  db.providers.push(entry);
  syncProviderOfferings(db, entry, modelNames, {
    source: models_source === 'discovered' ? 'discovered' : 'manual',
    ...(rate_limits !== undefined ? { rate_limits } : {}),
    ...(queue_max_size !== undefined ? { queue_max_size } : {}),
  });

  await saveDb(db);
  res.json(entry);
});

app.put('/api/providers/:id', async (req, res) => {
  const { user, db } = await getAuthContext(req);
  if (!user) return res.status(401).json({ detail: "Auth required" });
  
  const providerId = req.params.id;
  const providerIndex = db.providers.findIndex((p: any) => p.id === providerId);
  if (providerIndex === -1) return res.status(404).json({ detail: "Provider not found" });
  
  const provider = db.providers[providerIndex];
  
  // Cannot edit immutable providers
  if (provider.immutable) {
    return res.status(403).json({ detail: "Cannot modify immutable provider" });
  }
  
  // Can only edit own or group providers
  const canEdit = provider.owner_id === user.id || (provider.group_id && isGroupMember(user, db, provider.group_id));
  if (!canEdit) {
    return res.status(403).json({ detail: "Cannot modify this provider" });
  }
  
  const { name, base_url, models, models_path, models_source, api_key, rate_limits, queue_max_size } = req.body;

  if (models_source !== undefined && models_source !== 'manual' && models_source !== 'discovered') {
    return res.status(400).json({ detail: "models_source must be manual or discovered" });
  }
  let normalizedName: string | undefined;
  if (name !== undefined) {
    normalizedName = typeof name === 'string' ? name.trim() : '';
    if (!normalizedName) return res.status(400).json({ detail: 'Name cannot be empty' });
    const duplicate = db.providers.find((candidate: any) =>
      candidate.id !== provider.id && candidate.name === normalizedName && candidate.group_id === provider.group_id &&
      (provider.group_id || candidate.owner_id === user.id || candidate.visibility === 'public')
    );
    if (duplicate) return res.status(409).json({ detail: `A provider with name "${normalizedName}" already exists` });
  }

  let modelNames = getProviderModelNames(provider);
  if (models !== undefined) {
    try {
      modelNames = parseProviderModelIds(models);
    } catch (error: any) {
      return res.status(400).json({ detail: error.message });
    }
  }

  let validatedUrl: ValidatedProviderUrl | null = null;
  const shouldValidateUrl = base_url && base_url !== provider.base_url;
  if (shouldValidateUrl) {
    if (provider.allow_private && !isGlobalAdmin(user, db)) {
      return res.status(403).json({ detail: "Only Global Admin can change a private-network provider URL" });
    }
    const urlRateLimit = rateLimiter.check(user.id, 'provider-url-change', [{ limit: 10, windowMs: 60_000 }]);
    if (!urlRateLimit.allowed) return res.status(429).json({ detail: "Too many provider URL changes. Please try again later." });
    try {
      validatedUrl = await validateProviderUrl(base_url, isGlobalAdmin(user, db) ? 'private' : 'public');
    } catch (error) {
      return sendProviderUrlError(res, error);
    }
  }

  let normalizedModelsPath: string | null = null;
  if (shouldValidateUrl || models_path !== undefined) {
    try {
      normalizedModelsPath = resolveProviderModelsEndpoint(
        shouldValidateUrl ? base_url : provider.base_url,
        models_path !== undefined ? models_path : provider.models_path
      ).modelsPath;
    } catch (error) {
      return sendProviderUrlError(res, error);
    }
  }

  if (rate_limits !== undefined && !isValidRateLimits(rate_limits)) {
    return res.status(400).json({ detail: "Invalid rate limits format. Use e.g. 10:request:minute,1:request:second" });
  }
  if (queue_max_size !== undefined && (!Number.isInteger(queue_max_size) || queue_max_size < 1)) {
    return res.status(400).json({ detail: "Queue max size must be a positive integer" });
  }
  
  if (normalizedName !== undefined) provider.name = normalizedName;
  if (shouldValidateUrl) {
    provider.base_url = base_url;
    provider.allow_private = validatedUrl!.requiresPrivateAccess;
  }
  if (normalizedModelsPath !== null) provider.models_path = normalizedModelsPath;
  if (api_key !== undefined) {
    provider.api_key = api_key ? encryptProviderKey(api_key, user.id) : provider.api_key;
  }

  syncProviderOfferings(db, provider, modelNames, {
    source: models_source === 'discovered' ? 'discovered' : 'manual',
    ...(rate_limits !== undefined ? { rate_limits } : {}),
    ...(queue_max_size !== undefined ? { queue_max_size } : {}),
  });

  await saveDb(db);
  res.json(provider);
});

app.delete('/api/providers/:id', async (req, res) => {
  const { user, db } = await getAuthContext(req);
  if (!user) return res.status(401).json({ detail: "Auth required" });
  
  const providerId = req.params.id;
  const providerIndex = db.providers.findIndex((p: any) => p.id === providerId);
  if (providerIndex === -1) return res.status(404).json({ detail: "Provider not found" });
  
  const provider = db.providers[providerIndex];
  
  // Cannot delete immutable providers
  if (provider.immutable) {
    return res.status(403).json({ detail: "Cannot delete immutable provider" });
  }
  
  // Can only delete own or group providers
  const canDelete = provider.owner_id === user.id || (provider.group_id && isGroupMember(user, db, provider.group_id));
  if (!canDelete) {
    return res.status(403).json({ detail: "Cannot delete this provider" });
  }
  
  db.providers.splice(providerIndex, 1);
  await saveDb(db);
  res.json({ status: "success" });
});

// --- GROUPS LOGIC ---
app.get('/api/groups', async (req, res) => {
  const { user, db } = await getAuthContext(req);
  if (!user) return res.status(401).json({ detail: "Auth required" });

  const isAdmin = db.groups.some((g: any) =>
    g.id === "global_admin" &&
    g.members.some((m: any) => m.ids.includes(user.id))
  );

  const userGroups = db.groups
    .filter((group: any) =>
      group.members.some((member: any) =>
        member.ids.includes(user.id) || member.ids.includes("*")
      )
    )
    .map((group: any) => ({
      id: group.id,
      name: group.name,
      member_count: group.members.length,
    }));

  res.json({ groups: userGroups, is_admin: isAdmin });
});

// --- GROUP DETAIL & ADMIN ---
function isGlobalAdmin(user: any, db: any): boolean {
  return db.groups.some((g: any) =>
    g.id === "global_admin" &&
    g.members.some((m: any) => m.ids.includes(user.id))
  );
}

function isGroupMember(user: any, db: any, groupId: string): boolean {
  const group = db.groups.find((g: any) => g.id === groupId);
  if (!group) return false;
  return group.members.some((m: any) => m.ids.includes(user.id) || m.ids.includes("*"));
}

app.get('/api/groups/:slug', async (req, res) => {
  const { user, db } = await getAuthContext(req);
  if (!user) return res.status(401).json({ detail: "Auth required" });
  if (!isGlobalAdmin(user, db)) return res.status(403).json({ detail: "Admin access required" });

  const group = db.groups.find((g: any) => g.id === req.params.slug);
  if (!group) return res.status(404).json({ detail: "Group not found" });

  const members = group.members.flatMap((m: any) => {
    if (m.ids.includes("*")) {
      return db.users.map((u: any) => ({ id: u.id, name: u.name }));
    }
    return m.ids
      .map((id: string) => {
        const u = db.users.find((u: any) => u.id === id);
        return u ? { id: u.id, name: u.name } : null;
      })
      .filter(Boolean);
  });

  res.json({
    id: group.id,
    name: group.name,
    members,
  });
});

app.get('/api/groups/:slug/members', async (req, res) => {
  const { user, db } = await getAuthContext(req);
  if (!user) return res.status(401).json({ detail: "Auth required" });
  if (!isGlobalAdmin(user, db)) return res.status(403).json({ detail: "Admin access required" });

  const group = db.groups.find((g: any) => g.id === req.params.slug);
  if (!group) return res.status(404).json({ detail: "Group not found" });

  const q = (req.query.q as string || '').toLowerCase();
  const hasWildcard = group.members.some((m: any) => m.ids.includes("*"));
  const memberIds = hasWildcard
    ? new Set(db.users.map((u: any) => u.id))
    : new Set(group.members.flatMap((m: any) => m.ids));

  const results = db.users
    .filter((u: any) => memberIds.has(u.id) && (!q || u.name.toLowerCase().includes(q)))
    .map((u: any) => ({ id: u.id, name: u.name }));

  res.json(results);
});

// Admin: search all users by email
app.get('/api/admin/users', async (req, res) => {
  const { user, db } = await getAuthContext(req);
  if (!user) return res.status(401).json({ detail: "Auth required" });
  if (!isGlobalAdmin(user, db)) return res.status(403).json({ detail: "Admin access required" });

  const q = (req.query.q as string || '').toLowerCase();
  const results = db.users
    .filter((u: any) => !q || u.name.toLowerCase().includes(q))
    .map((u: any) => ({ id: u.id, name: u.name }));

  res.json(results);
});

// Admin: add user to group
app.post('/api/groups/:slug/members', async (req, res) => {
  const { user, db } = await getAuthContext(req);
  if (!user) return res.status(401).json({ detail: "Auth required" });
  if (!isGlobalAdmin(user, db)) return res.status(403).json({ detail: "Admin access required" });

  const group = db.groups.find((g: any) => g.id === req.params.slug);
  if (!group) return res.status(404).json({ detail: "Group not found" });

  const { user_id } = req.body;
  if (!user_id) return res.status(400).json({ detail: "user_id required" });

  const targetUser = db.users.find((u: any) => u.id === user_id);
  if (!targetUser) return res.status(404).json({ detail: "User not found" });

  // Check if already a member
  const alreadyMember = group.members.some((m: any) => m.ids.includes(user_id));
  if (!alreadyMember) {
    group.members.push({ ids: [user_id], role_ids: ["role-id-default"] });
    await saveDb(db);
  }

  res.json({ status: "success" });
});

// Admin: remove user from group
app.delete('/api/groups/:slug/members/:userId', async (req, res) => {
  const { user, db } = await getAuthContext(req);
  if (!user) return res.status(401).json({ detail: "Auth required" });
  if (!isGlobalAdmin(user, db)) return res.status(403).json({ detail: "Admin access required" });

  const group = db.groups.find((g: any) => g.id === req.params.slug);
  if (!group) return res.status(404).json({ detail: "Group not found" });

  const userId = req.params.userId;
  for (const member of group.members) {
    member.ids = member.ids.filter((id: string) => id !== userId);
  }
  group.members = group.members.filter((m: any) => m.ids.length > 0);
  await saveDb(db);

  res.json({ status: "success" });
});

// Admin: get user's resources
app.get('/api/admin/users/:userId', async (req, res) => {
  const { user, db } = await getAuthContext(req);
  if (!user) return res.status(401).json({ detail: "Auth required" });
  if (!isGlobalAdmin(user, db)) return res.status(403).json({ detail: "Admin access required" });

  const targetUser = db.users.find((u: any) => u.id === req.params.userId);
  if (!targetUser) return res.status(404).json({ detail: "User not found" });

  const keys = db.api_keys
    .filter((k: any) => k.owner_id === targetUser.id)
    .map((k: any) => ({ id: k.id, name: k.name, prefix: k.key_prefix, created_at: k.created_at }));

  const providers = db.providers
    .filter((p: any) => p.owner_id === targetUser.id)
    .map((p: any) => ({ id: p.id, name: p.name, base_url: p.base_url, models: getProviderModelNames(p).join(','), models_path: p.models_path || 'models' }));

  const userGroups = db.groups
    .filter((g: any) => g.members.some((m: any) => m.ids.includes(targetUser.id)))
    .map((g: any) => ({ id: g.id, name: g.name }));

  res.json({
    user: { id: targetUser.id, name: targetUser.name },
    keys,
    providers,
    groups: userGroups,
  });
});

// Admin: delete user's API key
app.delete('/api/admin/users/:userId/keys/:keyId', async (req, res) => {
  const { user, db } = await getAuthContext(req);
  if (!user) return res.status(401).json({ detail: "Auth required" });
  if (!isGlobalAdmin(user, db)) return res.status(403).json({ detail: "Admin access required" });

  const idx = db.api_keys.findIndex((k: any) => k.id === req.params.keyId && k.owner_id === req.params.userId);
  if (idx === -1) return res.status(404).json({ detail: "Key not found" });
  db.api_keys.splice(idx, 1);
  await saveDb(db);
  res.json({ status: "success" });
});

// Admin: delete user's provider
app.delete('/api/admin/users/:userId/providers/:providerId', async (req, res) => {
  const { user, db } = await getAuthContext(req);
  if (!user) return res.status(401).json({ detail: "Auth required" });
  if (!isGlobalAdmin(user, db)) return res.status(403).json({ detail: "Admin access required" });

  const idx = db.providers.findIndex((p: any) => p.id === req.params.providerId && p.owner_id === req.params.userId);
  if (idx === -1) return res.status(404).json({ detail: "Provider not found" });
  db.providers.splice(idx, 1);
  await saveDb(db);
  res.json({ status: "success" });
});

// Admin: delete user
app.delete('/api/admin/users/:userId', async (req, res) => {
  const { user, db } = await getAuthContext(req);
  if (!user) return res.status(401).json({ detail: "Auth required" });
  if (!isGlobalAdmin(user, db)) return res.status(403).json({ detail: "Admin access required" });

  const targetUserId = req.params.userId;
  if (targetUserId === user.id) return res.status(400).json({ detail: "Cannot delete yourself via admin endpoint" });

  const targetUser = db.users.find((u: any) => u.id === targetUserId);
  if (!targetUser) return res.status(404).json({ detail: "User not found" });

  const userKeyIds = db.api_keys.filter((k: any) => k.owner_id === targetUserId).map((k: any) => k.id);
  db.messages = db.messages.filter((m: any) => m.user_id !== targetUserId);
  db.providers = db.providers.filter((p: any) => p.owner_id !== targetUserId || p.immutable);
  db.usage_events = db.usage_events.filter((e: any) => !userKeyIds.includes(e.api_key_id));
  db.api_keys = db.api_keys.filter((k: any) => k.owner_id !== targetUserId);
  db.users = db.users.filter((u: any) => u.id !== targetUserId);
  await saveDb(db);
  res.json({ status: "success" });
});

// Admin: remove user from a specific group
app.delete('/api/admin/users/:userId/groups/:groupSlug', async (req, res) => {
  const { user, db } = await getAuthContext(req);
  if (!user) return res.status(401).json({ detail: "Auth required" });
  if (!isGlobalAdmin(user, db)) return res.status(403).json({ detail: "Admin access required" });

  const group = db.groups.find((g: any) => g.id === req.params.groupSlug);
  if (!group) return res.status(404).json({ detail: "Group not found" });

  const userId = req.params.userId;
  for (const member of group.members) {
    member.ids = member.ids.filter((id: string) => id !== userId);
  }
  group.members = group.members.filter((m: any) => m.ids.length > 0);
  await saveDb(db);

  res.json({ status: "success" });
});

// Admin: get user's usage events
app.get('/api/admin/users/:userId/usage', async (req, res) => {
  const { user, db } = await getAuthContext(req);
  if (!user) return res.status(401).json({ detail: "Auth required" });
  if (!isGlobalAdmin(user, db)) return res.status(403).json({ detail: "Admin access required" });

  const targetUser = db.users.find((u: any) => u.id === req.params.userId);
  if (!targetUser) return res.status(404).json({ detail: "User not found" });

  const userKeyIds = db.api_keys.filter((k: any) => k.owner_id === targetUser.id).map((k: any) => k.id);
  const events = db.usage_events.filter((e: any) => userKeyIds.includes(e.api_key_id));

  const result = events.map((e: any) => {
    const apiKey = db.api_keys.find((k: any) => k.id === e.api_key_id);
    const provider = db.providers.find((p: any) => p.id === e.provider_id);
    const pricing = provider ? getModelSettings(db, provider, e.model_id) : db.model_pricing.find((mp: any) => mp.model_id === e.model_id);
    const inputCostPerM = e.input_price_per_1m_tokens ?? pricing?.input_cost_per_1m_tokens ?? 0;
    const outputCostPerM = e.output_price_per_1m_tokens ?? pricing?.output_cost_per_1m_tokens ?? 0;
    const inputCost = (e.input_tokens / 1_000_000) * inputCostPerM;
    const outputCost = (e.output_tokens / 1_000_000) * outputCostPerM;

    return {
      id: e.id,
      timestamp: e.timestamp,
      api_key_name: apiKey?.name || 'unknown',
      api_key_prefix: apiKey?.key_prefix || 'unknown',
      provider_name: provider?.name || 'unknown',
      model_id: e.model_id,
      input_tokens: e.input_tokens,
      output_tokens: e.output_tokens,
      input_cost_per_1m_tokens: inputCostPerM,
      output_cost_per_1m_tokens: outputCostPerM,
      input_cost: Math.round(inputCost * 1_000_000_000) / 1_000_000_000,
      output_cost: Math.round(outputCost * 1_000_000_000) / 1_000_000_000,
      total_cost: Math.round((inputCost + outputCost) * 1_000_000_000) / 1_000_000_000,
      source: e.source || 'UI',
    };
  });

  result.sort((a: any, b: any) => b.timestamp - a.timestamp);
  res.json(result);
});

// --- MESSAGES LOGIC ---
app.get('/api/messages', async (req, res) => {
  const { user, db } = await getAuthContext(req);
  if (!user) return res.status(401).json({ detail: "Auth required" });
  
  if (CHAT_PERSISTENCE === 'client') {
    return res.json([]);
  }
  const userMessages = db.messages.filter((m: any) => m.user_id === user.id);
  res.json(userMessages);
});

app.delete('/api/messages', async (req, res) => {
  const { user, db } = await getAuthContext(req);
  if (!user) return res.status(401).json({ detail: "Auth required" });
  
  if (CHAT_PERSISTENCE === 'client') {
    return res.json({ status: "success" });
  }
  db.messages = db.messages.filter((m: any) => m.user_id !== user.id);
  await saveDb(db);
  res.json({ status: "success" });
});

// --- CHAT LOGIC ---
app.get('/api/config', async (req, res) => {
  const db = await loadDb();
  const { default_provider_api_key, default_provider_url, ...safeConfig } = APP_CONFIG;
  res.json({ 
    ...safeConfig, 
    app_name: APP_CONFIG.app_name,
    chat_persistence: CHAT_PERSISTENCE,
    signups_enabled: SIGNUPS_ENABLED,
    providers: db.providers.filter((p: any) => p.visibility === 'public').map((p: any) => ({
      id: p.id,
      name: p.name,
      models: getProviderModelNames(p).join(','),
      visibility: p.visibility,
      immutable: p.immutable,
      model_count: getProviderOfferings(p).length,
    }))
  });
});

app.post('/api/config', (req, res) => {
  res.json({ status: "success" });
});

function sendOpenAiError(res: Response, status: number, message: string, type: string, code: string) {
  return res.status(status).json({ error: { message, type, param: null, code } });
}

function parseProviderQuery(req: Request): { providerName?: string; providerId?: string } {
  const providerNameValue = queryString(req.query.provider, 'provider');
  const providerIdValue = queryString(req.query.provider_id, 'provider_id');
  const providerName = providerNameValue?.trim();
  const providerId = providerIdValue?.trim();
  if (providerNameValue !== undefined && !providerName) throw new Error('provider must be a non-empty string');
  if (providerIdValue !== undefined && !providerId) throw new Error('provider_id must be a non-empty string');
  return { ...(providerName ? { providerName } : {}), ...(providerId ? { providerId } : {}) };
}

function modelCatalogEntries(db: any, user: any, apiKey: any, authState: string, selector: { providerName?: string; providerId?: string }) {
  const authenticated = authState === 'jwt' || authState === 'api_key';
  const offeringsFor = (provider: any): ProviderOffering[] => authenticated
    ? getUsableProviderOfferings(user, apiKey, db, provider)
    : getProviderOfferings(provider).filter(offering => offering.visibility === 'public');
  let providers: any[];

  if (selector.providerId) {
    const selected = db.providers.find((provider: any) => provider.id === selector.providerId);
    providers = selected && offeringsFor(selected).length > 0 ? [selected] : [];
  } else if (selector.providerName) {
    providers = db.providers.filter((provider: any) => provider.name === selector.providerName && offeringsFor(provider).length > 0);
  } else if (authenticated) {
    providers = db.providers.filter((provider: any) => offeringsFor(provider).length > 0);
  } else {
    providers = db.providers.filter((provider: any) => provider.immutable === true && offeringsFor(provider).length > 0);
  }

  if (selector.providerName && selector.providerId) {
    providers = providers.filter(provider => provider.name === selector.providerName);
  }
  if ((selector.providerName || selector.providerId) && providers.length === 0) {
    return { error: { status: 404, message: 'Provider not found', code: 'invalid_provider' }, entries: [] as any[] };
  }
  if (selector.providerName && !selector.providerId && providers.length > 1) {
    return { error: { status: 400, message: 'Provider name is ambiguous; use provider_id', code: 'ambiguous_provider' }, entries: [] as any[] };
  }

  const entries: { provider: any; offering: ProviderOffering }[] = [];
  for (const provider of providers.sort(compareProviders)) {
    for (const offering of offeringsFor(provider)) entries.push({ provider, offering });
  }
  if (!selector.providerName && !selector.providerId) {
    const deduplicated = new Map<string, { provider: any; offering: ProviderOffering }>();
    for (const entry of entries) {
      if (!deduplicated.has(entry.offering.model_id)) deduplicated.set(entry.offering.model_id, entry);
    }
    return { entries: [...deduplicated.values()].sort((left, right) => left.offering.model_id.localeCompare(right.offering.model_id)) };
  }
  return { entries: entries.sort((left, right) => left.offering.model_id.localeCompare(right.offering.model_id)) };
}

function openAiModel(entry: { provider: any; offering: ProviderOffering }) {
  return {
    id: entry.offering.model_id,
    object: 'model',
    created: entry.offering.created_at,
    owned_by: entry.provider.name,
  };
}

app.get('/v1/models', async (req: Request, res: Response) => {
  const { user, db, apiKey, authState } = await getAuthContext(req);
  if (authState === 'invalid') {
    return sendOpenAiError(res, 401, 'Invalid authentication credentials', 'authentication_error', 'invalid_api_key');
  }
  let selector: { providerName?: string; providerId?: string };
  try {
    selector = parseProviderQuery(req);
  } catch (error: any) {
    return sendOpenAiError(res, 400, error.message, 'invalid_request_error', 'invalid_provider');
  }
  const result = modelCatalogEntries(db, user, apiKey, authState, selector);
  if (result.error) {
    return sendOpenAiError(res, result.error.status, result.error.message, 'invalid_request_error', result.error.code);
  }
  return res.json({ object: 'list', data: result.entries.map(openAiModel) });
});

app.get('/v1/models/:model', async (req: Request, res: Response) => {
  const { user, db, apiKey, authState } = await getAuthContext(req);
  if (authState === 'invalid') {
    return sendOpenAiError(res, 401, 'Invalid authentication credentials', 'authentication_error', 'invalid_api_key');
  }
  let selector: { providerName?: string; providerId?: string };
  try {
    selector = parseProviderQuery(req);
  } catch (error: any) {
    return sendOpenAiError(res, 400, error.message, 'invalid_request_error', 'invalid_provider');
  }
  const result = modelCatalogEntries(db, user, apiKey, authState, selector);
  if (result.error) {
    return sendOpenAiError(res, result.error.status, result.error.message, 'invalid_request_error', result.error.code);
  }
  const entry = result.entries.find(candidate => candidate.offering.model_id === req.params.model);
  if (!entry) return sendOpenAiError(res, 404, `The model '${req.params.model}' does not exist or you do not have access to it`, 'invalid_request_error', 'model_not_found');
  return res.json(openAiModel(entry));
});

app.post('/api/chat/stream', async (req, res) => {
  const { user, db, apiKey } = await getAuthContext(req);
  if (!user) return res.status(401).json({ detail: "Auth required" });
  if (!apiKey) return res.status(400).json({ detail: "An API key is required to use the chat" });

  const { messages, provider_id, model: requestedModelValue } = req.body;
  if (requestedModelValue !== undefined && typeof requestedModelValue !== 'string') {
    return res.status(400).json({ detail: "Model must be a string" });
  }
  const requestedModel = typeof requestedModelValue === 'string' ? requestedModelValue.trim() : null;
  if (requestedModelValue !== undefined && !requestedModel) {
    return res.status(400).json({ detail: "Model cannot be empty" });
  }
  if (provider_id !== undefined && (typeof provider_id !== 'string' || !provider_id.trim())) {
    return res.status(400).json({ detail: 'provider_id must be a non-empty string' });
  }

  // Find the provider to use
  let provider: any;
  if (provider_id) {
    provider = db.providers.find((candidate: any) => candidate.id === provider_id.trim());
    if (!provider || getUsableProviderOfferings(user, apiKey, db, provider).length === 0) {
      return res.status(400).json({ detail: "Provider not found" });
    }
  } else {
    const availableProviders = db.providers.filter((candidate: any) => {
      const usable = getUsableProviderOfferings(user, apiKey, db, candidate);
      return requestedModel ? usable.some(offering => offering.model_id === requestedModel) : usable.length > 0;
    });
    provider = availableProviders.sort(compareProviders)[0];
  }
  if (!provider) return res.status(400).json({ detail: requestedModel ? `No provider configured for model ${requestedModel}` : "No provider configured" });

  const usableOfferings = getUsableProviderOfferings(user, apiKey, db, provider);
  const modelId = requestedModel || usableOfferings[0]?.model_id;
  const configuredOffering = modelId ? usableOfferings.find(offering => offering.model_id === modelId) : undefined;
  if (!modelId || !configuredOffering) {
    return res.status(400).json({ detail: `Model ${modelId || '(none)'} is not configured for provider ${provider.name}` });
  }
  if (!canUseOfferingForApiKey(user, apiKey, db, provider, configuredOffering)) {
    return res.status(403).json({ detail: "Forbidden: No permission to use this provider model" });
  }

  const requestId = crypto.randomUUID();
  res.locals.log = {
    request_id: requestId,
    provider_id: provider.id,
    requested_model: requestedModel,
    model: modelId,
    source: 'UI'
  };

  // Rate limit check per user per model
  const modelLimits = getModelRateLimits(db, provider, modelId);
  const rateLimitResult = rateLimiter.check(user.id, `${provider.id}:${modelId}`, modelLimits);
  if (!rateLimitResult.allowed) {
    return res.status(429).json({ detail: `Rate limit exceeded for ${user.name} using model ${modelId} from provider ${provider.name}` });
  }

  const { messages: providerMessages } = req.body;
  const startTime = Date.now();
  let inputTokens = 0;
  let outputTokens = 0;
  let firstTokenTime = 0; // ms offset from request start to first token arrival

  // Queue check per user per model
  const queueKey = `${provider.id}:${modelId}`;
  const queueMaxSize = getModelQueueMaxSize(db, provider, modelId);
  const beforeQueueSize = requestQueue.getQueueSize(queueKey);
  const modelSettings = getModelSettings(db, provider, modelId);
  const inputPricePerM = modelSettings?.input_cost_per_1m_tokens ?? 0;
  const outputPricePerM = modelSettings?.output_cost_per_1m_tokens ?? 0;

  console.log(JSON.stringify({
    timestamp: new Date().toISOString(),
    source_ip: req.ip || req.socket.remoteAddress,
    target_url: '/api/chat/stream',
    target_path: '/api/chat/stream',
    method: 'POST',
    status_code: 202,
    user_agent: req.get('User-Agent') || '-',
    api_key: req.headers['x-api-key-id'] || '-',
    refer: req.get('Referer') || '-',
    request_id: requestId,
    provider_id: provider.id,
    requested_model: requestedModel,
    model: modelId,
    source: 'UI',
    input_price_per_1m: inputPricePerM,
    output_price_per_1m: outputPricePerM,
    rate_limit_windows: rateLimitResult.windows,
    queue: { size: beforeQueueSize, limit: queueMaxSize }
  }));

  const queued = await requestQueue.enqueue(queueKey, queueMaxSize);
  if (!queued.ok) {
    if (queued.reason === 'timeout') {
      return res.status(504).json({ detail: `Request timed out waiting in queue for ${user.name} using model ${modelId} from provider ${provider.name}`, type: "queue_timeout" });
    }
    console.log(JSON.stringify({
      timestamp: new Date().toISOString(),
      event: 'queue_full',
      queue_key: queueKey,
      queue: { size: requestQueue.getQueueSize(queueKey), limit: queueMaxSize },
      provider_id: provider.id,
      provider_name: provider.name,
      model_id: modelId,
      requested_model: requestedModel,
      model: modelId,
      owner_id: provider.owner_id || null,
      api_key_prefix: apiKey?.key_prefix || 'N/A'
    }));
    return res.status(429).json({ detail: `Too many concurrent requests for ${user.name} using model ${modelId} from provider ${provider.name}`, type: "queue_full" });
  }

  // Rough token estimation: ~4 chars per token
  messages.forEach((m: any) => {
    inputTokens += Math.ceil((m.content?.length || 0) / 4);
  });

  if (inputTokens > MAX_INPUT_TOKENS) {
    requestQueue.dequeue(queueKey);
    return res.status(400).json({ detail: `Input exceeds ${MAX_INPUT_TOKENS.toLocaleString()} token limit (${inputTokens.toLocaleString()} tokens estimated)` });
  }
  
  // Store user message
  const userMsg = messages[messages.length - 1];
  if (CHAT_PERSISTENCE === 'server') {
    db.messages.push({
      id: crypto.randomUUID(),
      user_id: user.id,
      role: 'user',
      content: userMsg.content,
      timestamp: Date.now()
    });
    await saveDb(db);
  }

  let assistantContent = "";
  let thinkingContent = "";
  
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  const logStream = () => {
    const duration = Date.now() - startTime;
    outputTokens = Math.ceil((assistantContent + thinkingContent).length / 4);
    const tps = duration > 0 ? (outputTokens / (duration / 1000)).toFixed(2) : '0';
    const inputCost = (inputTokens / 1_000_000) * inputPricePerM;
    const outputCost = (outputTokens / 1_000_000) * outputPricePerM;
    console.log(JSON.stringify({
      timestamp: new Date().toISOString(),
      source_ip: req.ip || req.socket.remoteAddress,
      target_url: '/api/chat/stream',
      target_path: '/api/chat/stream',
      method: 'POST',
      status_code: 200,
      user_agent: req.get('User-Agent') || '-',
      api_key: req.headers['x-api-key-id'] || '-',
      refer: req.get('Referer') || '-',
      duration_ms: duration,
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      tokens_per_second: parseFloat(tps),
      ttft_ms: firstTokenTime,
      response_time_ms: duration,
      request_id: requestId,
      provider_id: provider.id,
      requested_model: requestedModel,
      model: modelId,
      source: 'UI',
      input_price_per_1m: inputPricePerM,
      output_price_per_1m: outputPricePerM,
      input_cost: Math.round(inputCost * 1_000_000_000) / 1_000_000_000,
      output_cost: Math.round(outputCost * 1_000_000_000) / 1_000_000_000,
      total_cost: Math.round((inputCost + outputCost) * 1_000_000_000) / 1_000_000_000,
      rate_limit_windows: rateLimitResult.windows,
      queue: { size: requestQueue.getQueueSize(queueKey), limit: queueMaxSize }
    }));
  };

  let streamFinished = false;
  let sseBuffer = "";
  const sseDecoder = new StringDecoder('utf8');

  const finishStream = async () => {
    if (streamFinished) return;
    streamFinished = true;

    try {
      // Store assistant message when stream finishes
      if (CHAT_PERSISTENCE === 'server') {
        db.messages.push({
          id: crypto.randomUUID(),
          user_id: user.id,
          role: 'assistant',
          content: assistantContent,
          thinking_content: thinkingContent,
          timestamp: Date.now()
        });
      }
      outputTokens = Math.ceil((assistantContent + thinkingContent).length / 4);
      // Record usage event
      db.usage_events.push({
        id: `usage-event-id-${crypto.randomUUID()}`,
        api_key_id: apiKey.id,
        model_id: modelId,
        provider_id: provider.id,
        user_id: user.id,
        group_id: apiKey.group_id || null,
        timestamp: Math.floor(Date.now() / 1000),
        input_tokens: inputTokens,
        output_tokens: outputTokens,
        source: 'UI',
        input_price_per_1m_tokens: inputPricePerM,
        output_price_per_1m_tokens: outputPricePerM,
      });
      await saveDb(db);
      const duration = Date.now() - startTime;
      const tps = duration > 0 ? (outputTokens / (duration / 1000)).toFixed(2) : '0';
      const responseTime = duration;
      if (!res.writableEnded) {
        res.write(`data: ${JSON.stringify({ type: 'done', requestId, inputTokens, outputTokens, tokensPerSecond: parseFloat(tps), ttft: firstTokenTime, responseTime, rateLimitRemaining: rateLimitResult.remaining, rateLimitLimit: rateLimitResult.limit, rateLimitUnit: rateLimitResult.unit, rateLimitWindows: rateLimitResult.windows })}\n\n`);
      }
    } finally {
      requestQueue.dequeue(queueKey);
      logStream();
      if (!res.writableEnded) res.end();
    }
  };

  const failStream = (err: any) => {
    if (streamFinished) return;
    streamFinished = true;
    requestQueue.dequeue(queueKey);
    const duration = Date.now() - startTime;
    console.log(JSON.stringify({
      timestamp: new Date().toISOString(),
      source_ip: req.ip || req.socket.remoteAddress,
      target_url: '/api/chat/stream',
      target_path: '/api/chat/stream',
      method: 'POST',
      status_code: 500,
      user_agent: req.get('User-Agent') || '-',
      api_key: req.headers['x-api-key-id'] || '-',
      refer: req.get('Referer') || '-',
      duration_ms: duration,
      request_id: requestId,
      provider_id: provider.id,
      requested_model: requestedModel,
      model: modelId,
      source: 'UI',
      error: err.message
    }));
    if (!res.writableEnded) {
      res.write(`data: ${JSON.stringify({ type: 'response', content: `Error: ${err.message}` })}\n\n`);
      res.end();
    }
  };

  const processSseLine = (line: string) => {
    if (streamFinished || !line.trim() || !line.startsWith('data:')) return;
    const rawData = line.slice(5).trim();

    if (rawData === '[DONE]') {
      void finishStream();
      return;
    }

    try {
      const json = JSON.parse(rawData);
      const delta = json.choices?.[0]?.delta || {};

      // Track TTFT on the very first upstream token (content or thinking)
      if (firstTokenTime === 0 && (delta.content || delta.reasoning_content || delta.thinking || delta.reasoning)) {
        firstTokenTime = Date.now() - startTime;
      }

      if (delta.content) {
        assistantContent += delta.content;
        res.write(`data: ${JSON.stringify({ type: 'response', content: delta.content })}\n\n`);
      }
      // Handle reasoning/thinking content from models like Claude, o1, etc.
      if (delta.reasoning_content || delta.thinking || delta.reasoning) {
        const tc = delta.reasoning_content || delta.thinking || delta.reasoning;
        thinkingContent += tc;
        res.write(`data: ${JSON.stringify({ type: 'thinking', content: tc })}\n\n`);
      }
    } catch (e) {}
  };

  try {
    const providerTarget = await validateProviderUrl(
      provider.base_url,
      provider.immutable ? 'operator' : (provider.allow_private ? 'private' : 'public')
    );
    const response = await axios.post(`${provider.base_url}/chat/completions`, buildProviderChatBody(
      req.body,
      modelId,
      messages,
      true
    ), {
      ...providerRequestConfig(providerTarget),
      headers: { 'Authorization': `Bearer ${resolveProviderApiKey(provider)}` },
      responseType: 'stream'
    });

    response.data.on('data', (chunk: Buffer) => {
      sseBuffer += sseDecoder.write(chunk);
      const lines = sseBuffer.split(/\r?\n/);
      sseBuffer = lines.pop() || "";
      for (const line of lines) processSseLine(line);
    });

    response.data.on('error', failStream);

    response.data.on('end', () => {
      sseBuffer += sseDecoder.end();
      if (sseBuffer.trim()) {
        processSseLine(sseBuffer);
        sseBuffer = "";
      }
      void finishStream();
    });
  } catch (err: any) {
    failStream(err);
  }
});

// OpenAI-compatible non-streaming chat completions endpoint
app.post('/v1/chat/completions', async (req: Request, res: Response) => {
  const { user, db, apiKey } = await getAuthContext(req);
  if (!user) return res.status(401).json({ error: { message: "Auth required", type: "authentication_error", code: "invalid_api_key" }});
  if (!apiKey) return res.status(400).json({ error: { message: "An API key is required", type: "invalid_request_error", code: "missing_api_key" }});

  const {
    messages,
    model: requestedModelValue,
    stream,
    provider: requestedProviderNameValue,
    provider_id: requestedProviderIdValue,
  } = req.body;

  if (requestedModelValue !== undefined && typeof requestedModelValue !== 'string') {
    return res.status(400).json({ error: { message: "Model must be a string", type: "invalid_request_error", code: "invalid_model" }});
  }
  const requestedModel = typeof requestedModelValue === 'string' ? requestedModelValue.trim() : null;
  if (requestedModelValue !== undefined && !requestedModel) {
    return res.status(400).json({ error: { message: "Model cannot be empty", type: "invalid_request_error", code: "invalid_model" }});
  }

  const hasProviderId = requestedProviderIdValue !== undefined;
  const hasProviderName = requestedProviderNameValue !== undefined;
  if (hasProviderId && (typeof requestedProviderIdValue !== 'string' || !requestedProviderIdValue.trim())) {
    return res.status(400).json({ error: { message: "provider_id must be a non-empty string", type: "invalid_request_error", code: "invalid_provider" }});
  }
  if (hasProviderName && (typeof requestedProviderNameValue !== 'string' || !requestedProviderNameValue.trim())) {
    return res.status(400).json({ error: { message: "provider must be a non-empty string", type: "invalid_request_error", code: "invalid_provider" }});
  }
  const requestedProviderId = hasProviderId ? requestedProviderIdValue.trim() : null;
  const requestedProviderName = hasProviderName ? requestedProviderNameValue.trim() : null;

  // Provider selectors are optional OpenAI extensions. Without one, prefer the
  // deployment default for the requested model, then another usable provider.
  let provider: any;
  if (requestedProviderId) {
    provider = db.providers.find((candidate: any) => candidate.id === requestedProviderId);
    if (!provider || getUsableProviderOfferings(user, apiKey, db, provider).length === 0) {
      return res.status(400).json({ error: { message: "Provider not found", type: "invalid_request_error", code: "invalid_provider" }});
    }
  }
  if (requestedProviderName) {
    if (provider && provider.name !== requestedProviderName) {
      return res.status(400).json({ error: { message: "provider and provider_id select different providers", type: "invalid_request_error", code: "invalid_provider" }});
    }
    if (!provider) {
      const namedProviders = db.providers.filter((candidate: any) =>
        candidate.name === requestedProviderName && getUsableProviderOfferings(user, apiKey, db, candidate).length > 0
      );
      if (namedProviders.length === 0) {
        return res.status(400).json({ error: { message: "Provider not found", type: "invalid_request_error", code: "invalid_provider" }});
      }
      if (namedProviders.length === 1) provider = namedProviders[0];
      else {
        return res.status(400).json({ error: { message: "Provider name is ambiguous; use provider_id", type: "invalid_request_error", code: "ambiguous_provider" }});
      }
    }
  }

  if (!provider) {
    const availableProviders = db.providers.filter((candidate: any) => {
      const offerings = getUsableProviderOfferings(user, apiKey, db, candidate);
      return offerings.length > 0 && (!requestedModel || offerings.some(offering => offering.model_id === requestedModel));
    });
    provider = availableProviders.sort(compareProviders)[0];
  }

  if (!provider) {
    const message = requestedModel
      ? `No provider configured for model ${requestedModel}`
      : "No provider configured";
    return res.status(400).json({ error: { message, type: "invalid_request_error", code: requestedModel ? "model_not_found" : "provider_not_found" }});
  }

  const usableOfferings = getUsableProviderOfferings(user, apiKey, db, provider);
  const modelId = requestedModel || usableOfferings[0]?.model_id;
  const configuredOffering = modelId ? usableOfferings.find(offering => offering.model_id === modelId) : undefined;
  if (!modelId || !configuredOffering) {
    return res.status(400).json({ error: { message: `Model ${modelId || '(none)'} is not configured for provider ${provider.name}`, type: "invalid_request_error", code: "model_not_found" }});
  }
  if (!canUseOfferingForApiKey(user, apiKey, db, provider, configuredOffering)) {
    return res.status(403).json({ error: { message: "Forbidden: No permission to use this provider model", type: "permission_error", code: "insufficient_permissions" }});
  }

  const startTime = Date.now();
  const requestId = `chatcmpl-${crypto.randomUUID()}`;
  res.locals.log = {
    request_id: requestId,
    provider_id: provider.id,
    requested_model: requestedModel,
    model: modelId,
    source: 'API'
  };

  // Rate limit check per user per model
  const modelLimits = getModelRateLimits(db, provider, modelId);
  const rateLimitResult = rateLimiter.check(user.id, `${provider.id}:${modelId}`, modelLimits);
  if (!rateLimitResult.allowed) {
    return res.status(429).json({ error: { message: `Rate limit exceeded for ${user.name} using model ${modelId} from provider ${provider.name}`, type: "rate_limit_exceeded" }});
  }

  // Queue check per user per model
  const queueKey = `${provider.id}:${modelId}`;
  const queueMaxSize = getModelQueueMaxSize(db, provider, modelId);
  const beforeQueueSize = requestQueue.getQueueSize(queueKey);
  const modelSettings = getModelSettings(db, provider, modelId);
  const inputPricePerM = modelSettings?.input_cost_per_1m_tokens ?? 0;
  const outputPricePerM = modelSettings?.output_cost_per_1m_tokens ?? 0;

  console.log(JSON.stringify({
    timestamp: new Date().toISOString(),
    source_ip: req.ip || req.socket.remoteAddress,
    target_url: '/v1/chat/completions',
    target_path: '/v1/chat/completions',
    method: 'POST',
    status_code: 200,
    user_agent: req.get('User-Agent') || '-',
    api_key: req.headers['x-api-key-id'] || '-',
    refer: req.get('Referer') || '-',
    request_id: requestId,
    provider_id: provider.id,
    requested_model: requestedModel,
    model: modelId,
    source: 'API',
    input_price_per_1m: inputPricePerM,
    output_price_per_1m: outputPricePerM,
    rate_limit_windows: rateLimitResult.windows,
    queue: { size: beforeQueueSize, limit: queueMaxSize }
  }));

  const queued = await requestQueue.enqueue(queueKey, queueMaxSize);
  if (!queued.ok) {
    if (queued.reason === 'timeout') {
      return res.status(504).json({ error: { message: `Request timed out waiting in queue for ${user.name} using model ${modelId} from provider ${provider.name}`, type: "queue_timeout" }});
    }
    console.log(JSON.stringify({
      timestamp: new Date().toISOString(),
      event: 'queue_full',
      queue_key: queueKey,
      queue: { size: requestQueue.getQueueSize(queueKey), limit: queueMaxSize },
      provider_id: provider.id,
      provider_name: provider.name,
      model_id: modelId,
      owner_id: provider.owner_id || null,
      api_key_prefix: apiKey?.key_prefix || 'N/A'
    }));
    return res.status(429).json({ error: { message: `Too many concurrent requests for ${user.name} using model ${modelId} from provider ${provider.name}`, type: "queue_full" }});
  }

  if (stream === true) {
    requestQueue.dequeue(queueKey);
    return res.status(400).json({ error: { message: "Streaming is not supported on this endpoint. Use /api/chat/stream for streaming.", type: "invalid_request_error" }});
  }

  const inputTokens = estimateTokens(messages);
  if (inputTokens > MAX_INPUT_TOKENS) {
    requestQueue.dequeue(queueKey);
    return res.status(400).json({ error: { message: `Input exceeds ${MAX_INPUT_TOKENS.toLocaleString()} token limit (${inputTokens.toLocaleString()} tokens estimated)`, type: "invalid_request_error" }});
  }

  try {
    const providerTarget = await validateProviderUrl(
      provider.base_url,
      provider.immutable ? 'operator' : (provider.allow_private ? 'private' : 'public')
    );
    const response = await axios.post(`${provider.base_url}/chat/completions`, buildProviderChatBody(
      req.body,
      modelId,
      messages,
      false
    ), {
      ...providerRequestConfig(providerTarget),
      headers: { 'Authorization': `Bearer ${resolveProviderApiKey(provider)}` }
    });

    const assistantMessage = response.data.choices[0].message;
    const duration = Date.now() - startTime;
    const outputTokens = Math.ceil((assistantMessage.content?.length || 0) / 4);
    const inputCost = (inputTokens / 1_000_000) * inputPricePerM;
    const outputCost = (outputTokens / 1_000_000) * outputPricePerM;

    requestQueue.dequeue(queueKey);

    res.locals.log = {
      ...res.locals.log,
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      tokens_per_second: duration > 0 ? parseFloat((outputTokens / (duration / 1000)).toFixed(2)) : 0,
      input_price_per_1m: inputPricePerM,
      output_price_per_1m: outputPricePerM,
      input_cost: Math.round(inputCost * 1_000_000_000) / 1_000_000_000,
      output_cost: Math.round(outputCost * 1_000_000_000) / 1_000_000_000,
      total_cost: Math.round((inputCost + outputCost) * 1_000_000_000) / 1_000_000_000,
      rate_limit_windows: rateLimitResult.windows,
      queue: { size: requestQueue.getQueueSize(queueKey), limit: queueMaxSize }
    };
    
    // Record usage event
    db.usage_events.push({
      id: `usage-event-id-${crypto.randomUUID()}`,
      api_key_id: apiKey.id,
      model_id: modelId,
      provider_id: provider.id,
      user_id: user.id,
      group_id: apiKey.group_id || null,
      timestamp: Math.floor(Date.now() / 1000),
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      source: 'API',
      input_price_per_1m_tokens: inputPricePerM,
      output_price_per_1m_tokens: outputPricePerM,
    });
    await saveDb(db);

    res.json({
      id: requestId,
      object: "chat.completion",
      created: Math.floor(Date.now() / 1000),
      model: modelId,
      choices: [{
        index: 0,
        message: {
          role: "assistant",
          content: assistantMessage.content
        },
        finish_reason: "stop"
      }],
      usage: {
        prompt_tokens: inputTokens,
        completion_tokens: outputTokens,
        total_tokens: inputTokens + outputTokens
      },
      rate_limit_windows: rateLimitResult.windows,
      queue: { size: requestQueue.getQueueSize(queueKey), limit: queueMaxSize }
    });
  } catch (err: any) {
    requestQueue.dequeue(queueKey);
    res.locals.log = { ...res.locals.log, error: err.message };
    const providerUnavailable = err instanceof ProviderUrlError;
    res.status(providerUnavailable ? 502 : 500).json({
      error: {
        message: err.message,
        type: providerUnavailable ? "provider_error" : "internal_error",
        code: providerUnavailable ? "provider_unavailable" : "internal_error"
      }
    });
  }
});

// --- USAGE LOGIC ---
app.get('/api/usage', async (req, res) => {
  const { user, db } = await getAuthContext(req);
  if (!user) return res.status(401).json({ detail: "Auth required" });

  const groupId = req.query.group_id as string;

  // Get API key IDs scoped to user or group
  let userKeyIds: string[];
  if (groupId) {
    userKeyIds = db.api_keys.filter((k: any) => k.group_id === groupId).map((k: any) => k.id);
  } else {
    userKeyIds = db.api_keys.filter((k: any) => k.owner_id === user.id && !k.group_id).map((k: any) => k.id);
  }

  // Get usage events for these keys
  const events = db.usage_events.filter((e: any) => userKeyIds.includes(e.api_key_id));

  // Join with pricing and resolve names
  const result = events.map((e: any) => {
    const apiKey = db.api_keys.find((k: any) => k.id === e.api_key_id);
    const provider = db.providers.find((p: any) => p.id === e.provider_id);
    const pricing = provider ? getModelSettings(db, provider, e.model_id) : db.model_pricing.find((mp: any) => mp.model_id === e.model_id);

    const inputCostPerM = e.input_price_per_1m_tokens ?? pricing?.input_cost_per_1m_tokens ?? 0;
    const outputCostPerM = e.output_price_per_1m_tokens ?? pricing?.output_cost_per_1m_tokens ?? 0;

    const inputCost = (e.input_tokens / 1_000_000) * inputCostPerM;
    const outputCost = (e.output_tokens / 1_000_000) * outputCostPerM;

    return {
      id: e.id,
      timestamp: e.timestamp,
      api_key_name: apiKey?.name || 'unknown',
      api_key_prefix: apiKey?.key_prefix || 'unknown',
      provider_name: provider?.name || 'unknown',
      model_id: e.model_id,
      input_tokens: e.input_tokens,
      output_tokens: e.output_tokens,
      input_cost_per_1m_tokens: inputCostPerM,
      output_cost_per_1m_tokens: outputCostPerM,
      input_cost: Math.round(inputCost * 1_000_000_000) / 1_000_000_000,
      output_cost: Math.round(outputCost * 1_000_000_000) / 1_000_000_000,
      total_cost: Math.round((inputCost + outputCost) * 1_000_000_000) / 1_000_000_000,
      source: e.source || 'UI',
    };
  });

  // Sort newest first
  result.sort((a: any, b: any) => b.timestamp - a.timestamp);

  res.json(result);
});

// --- VITE MIDDLEWARE ---
let server: ReturnType<typeof app.listen> | null = null;

async function startServer() {
  const db = await loadDb();
  await ensureDefaults(db);
  await saveDb(db);

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      const indexPath = path.join(distPath, 'index.html');
      let html = fs.readFileSync(indexPath, 'utf-8');
      html = html.replace(/%APP_NAME%/g, APP_CONFIG.app_name);
      html = html.replace('href="./"', `href="${BASE_PATH || ''}/"`);
      res.type('html').send(html);
    });
  }

  server = app.listen(Number(PORT), '0.0.0.0', () => {
    console.log(`Server running at http://localhost:${PORT}`);
  });

  // GC stale queue items every 60 seconds (max age 10 minutes)
  setInterval(() => {
    requestQueue.gc(10 * 60 * 1000);
  }, 60_000);
}

function shutdown(signal: string) {
  console.log(`\n${signal} received, shutting down gracefully...`);
  if (server) {
    server.close(() => {
      console.log('Server closed.');
      process.exit(0);
    });
    // Force exit after 5 seconds
    setTimeout(() => {
      console.error('Forced shutdown after timeout.');
      process.exit(1);
    }, 5000);
  } else {
    process.exit(0);
  }
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

// Export app for testing; only auto-start when not in test mode
export { app, ensureDefaults };
if (process.env.NODE_ENV !== 'test') {
  startServer();
} else {
  // Initialize DB defaults for tests without starting the HTTP server
  (async () => {
    const db = await loadDb();
    await ensureDefaults(db);
    await saveDb(db);
  })();
}
