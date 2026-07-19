
import express, { Request, Response, NextFunction } from 'express';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import net from 'net';
import { StringDecoder } from 'string_decoder';
import jwt from 'jsonwebtoken';
import axios from 'axios';
import helmet from 'helmet';
import { fileURLToPath } from 'url';
import bcrypt from 'bcryptjs';
import { createDatabase } from './src/db/index';
import type { DatabaseAdapter, DbData } from './src/db/index';

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
const SIGNUP_ALLOWED_EMAILS = new Set((process.env.SIGNUP_ALLOWED_EMAILS || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean));
const SIGNUP_ALLOWED_DOMAINS = new Set((process.env.SIGNUP_ALLOWED_DOMAINS || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean));
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
  return APP_URL || `${req.protocol}://${req.get('host')}`;
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

function isSignupAllowed(email: string): boolean {
  if (SIGNUP_ALLOWED_EMAILS.size === 0 && SIGNUP_ALLOWED_DOMAINS.size === 0) return true;
  const normalized = email.trim().toLowerCase();
  const parts = normalized.split('@');
  return SIGNUP_ALLOWED_EMAILS.has(normalized)
    || (parts.length === 2 && Boolean(parts[0]) && SIGNUP_ALLOWED_DOMAINS.has(parts[1]));
}

function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9-]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');
}

// --- SSRF GUARD (C2/M4) ---
// Validates a provider base_url is not pointing at internal/private infrastructure.
// The naive string-match for '169.254.169.254' was bypassable via IPv6, URL auth,
// and other internal addresses. This function rejects all RFC-1918, loopback,
// link-local, and metadata service ranges.
const PRIVATE_IP_RANGES = [
  /^127\./,                        // loopback
  /^10\./,                         // RFC-1918
  /^172\.(1[6-9]|2\d|3[01])\./,   // RFC-1918
  /^192\.168\./,                   // RFC-1918
  /^169\.254\./,                   // link-local / AWS metadata
  /^::1$/,                         // IPv6 loopback
  /^fc00:/i,                       // IPv6 ULA
  /^fd[0-9a-f]{2}:/i,              // IPv6 ULA
  /^fe80:/i,                       // IPv6 link-local
  /^0\.0\.0\.0/,                   // unspecified
];

function isPrivateIp(ip: string): boolean {
  return PRIVATE_IP_RANGES.some(r => r.test(ip));
}

function isAllowedProviderUrl(rawUrl: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return false; // unparseable URL is rejected
  }

  const hostname = parsed.hostname;

  // Reject bare IP addresses that are private
  if (net.isIP(hostname)) {
    return !isPrivateIp(hostname);
  }

  // Reject well-known internal hostnames
  const lower = hostname.toLowerCase();
  if (lower === 'localhost' || lower.endsWith('.local') || lower.endsWith('.internal') || lower.endsWith('.localhost')) {
    return false;
  }

  // Reject URLs with userinfo — can be used to confuse URL parsers
  if (parsed.username || parsed.password) {
    return false;
  }

  return true;
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
      immutable: true
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

function getModelQueueMaxSize(db: any, modelId: string): number {
  const pricing = db.model_pricing.find((mp: any) => mp.model_id === modelId);
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

function getModelRateLimits(db: any, modelId: string): { limit: number; windowMs: number }[] {
  const pricing = db.model_pricing.find((mp: any) => mp.model_id === modelId);
  const rateLimitStr = pricing?.rate_limits || APP_CONFIG.default_provider_model_rate_limits;
  return parseRateLimits(rateLimitStr);
}

function getRateLimitLabel(db: any, modelId: string): string {
  const pricing = db.model_pricing.find((mp: any) => mp.model_id === modelId);
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
            const keyFound = db.api_keys.find((entry: any) => entry.id === keyId && (entry.owner_id === user.id || (entry.group_id && isGroupMember(user, db, entry.group_id))));
            if (keyFound) {
              apiKey = keyFound;
              apiKey.last_used_at = Math.floor(Date.now() / 1000);
              await saveDb(db);
            }
          }
          return { user, db, apiKey };
        }
      }
    }

    // 2. API Key Bearer Auth (for API)
    if (rawToken.startsWith('sk-')) {
      const prefix = rawToken.slice(0, 11);
      const keyFound = db.api_keys.find((entry: any) => 
        entry.key_prefix === prefix && bcrypt.compareSync(rawToken, entry.key_hash)
      );
      if (keyFound) {
        user = db.users.find((u: any) => u.id === keyFound.owner_id);
        if (user) {
          apiKey = keyFound;
          apiKey.last_used_at = Math.floor(Date.now() / 1000);
          await saveDb(db);
        }
      }
    }
  }
  
  return { user, db, apiKey };
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

  const username = typeof req.body.username === 'string' ? req.body.username.trim().toLowerCase() : '';
  const password = req.body.password;
  if (!username || typeof password !== 'string' || password.length < 8) {
    return res.status(400).json({ detail: "Invalid data" });
  }
  const db = await loadDb();
  if (db.users.some((u: any) => u.name.toLowerCase() === username)) {
    return res.status(409).json({ detail: "User exists" });
  }
  if (!isSignupAllowed(username)) {
    return res.status(403).json({ detail: "Signup is not allowed for this email address." });
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
  const frontendUrl = APP_URL || `${req.protocol}://${req.get('host')}`;

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

    email = email.trim().toLowerCase();
    const db = await loadDb();
    let user = db.users.find((u: any) => u.name.toLowerCase() === email);

    if (!user) {
      if (!SIGNUPS_ENABLED) {
        return res.status(403).send("Signups are disabled.");
      }
      if (!isSignupAllowed(email)) {
        return res.status(403).send("Signup is not allowed for this email address.");
      }

      const userId = `user-id-${crypto.randomUUID()}`;
      user = {
        id: userId,
        name: email,
        password_hash: '',
        oauth_provider: providerId,
      };
      db.users.push(user);

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

app.get('/api/providers', async (req, res) => {
  const { user, db } = await getAuthContext(req);
  if (!user) return res.status(401).json({ detail: "Auth required" });
  
  const groupId = req.query.group_id as string;
  const providers = db.providers.filter((p: any) =>
    groupId
      ? p.group_id === groupId
      : (p.visibility === 'public' || (p.owner_id === user.id && !p.group_id))
  );
  
  res.json(providers.map((p: any) => {
    const firstModel = p.models.split(',')[0].trim();
    const pricing = db.model_pricing.find((mp: any) => mp.model_id === firstModel);
    return {
      id: p.id,
      name: p.name,
      base_url: p.base_url,
      models: p.models,
      visibility: p.visibility,
      immutable: p.immutable,
      rate_limits: pricing?.rate_limits || APP_CONFIG.default_provider_model_rate_limits,
      queue_max_size: pricing?.queue_max_size ?? APP_CONFIG.default_provider_model_queue_max_size
    };
  }));
});

app.post('/api/providers', async (req, res) => {
  const { user, db } = await getAuthContext(req);
  if (!user) return res.status(401).json({ detail: "Auth required" });
  
  const { name, base_url, models, api_key, rate_limits, queue_max_size, group_id } = req.body;
  if (!name || !base_url) {
    return res.status(400).json({ detail: "Name and base_url are required" });
  }
  if (!isAllowedProviderUrl(base_url)) {
    return res.status(400).json({ detail: "Invalid base_url: Private/loopback/metadata addresses are forbidden" });
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
    const existing = db.providers.find((p: any) => p.name === name && p.group_id === group_id);
    if (existing) {
      return res.status(409).json({ detail: `A provider with name "${name}" already exists in this group` });
    }
  } else {
    const existing = db.providers.find((p: any) => 
      p.name === name && !p.group_id && (p.owner_id === user.id || p.visibility === 'public')
    );
    if (existing) {
      return res.status(409).json({ detail: `A provider with name "${name}" already exists` });
    }
  }
  
  const entry: any = {
    id: `provider-id-${crypto.randomUUID()}`,
    name,
    base_url,
    models: models || 'default',
    api_key: api_key ? encryptProviderKey(api_key, user.id) : '',
    owner_id: user.id,
    group_id: group_id || null,
    visibility: 'private',
    immutable: false
  };
  
  db.providers.push(entry);

  // Upsert model_pricing for each model
  const modelNames = (models || 'default').split(',').map((m: string) => m.trim());
  for (const modelName of modelNames) {
    const existing = db.model_pricing.find((mp: any) => mp.model_id === modelName);
    if (existing) {
      if (rate_limits) existing.rate_limits = rate_limits;
      if (queue_max_size !== undefined) existing.queue_max_size = queue_max_size;
    } else {
      db.model_pricing.push({
        model_id: modelName,
        input_cost_per_1m_tokens: 0,
        output_cost_per_1m_tokens: 0,
        rate_limits: rate_limits || APP_CONFIG.default_provider_model_rate_limits,
        queue_max_size: queue_max_size ?? APP_CONFIG.default_provider_model_queue_max_size
      });
    }
  }

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
  
  const { name, base_url, models, api_key, rate_limits, queue_max_size } = req.body;

  if (base_url && !isAllowedProviderUrl(base_url)) {
    return res.status(400).json({ detail: "Invalid base_url: Private/loopback/metadata addresses are forbidden" });
  }

  if (rate_limits !== undefined && !isValidRateLimits(rate_limits)) {
    return res.status(400).json({ detail: "Invalid rate limits format. Use e.g. 10:request:minute,1:request:second" });
  }
  if (queue_max_size !== undefined && (!Number.isInteger(queue_max_size) || queue_max_size < 1)) {
    return res.status(400).json({ detail: "Queue max size must be a positive integer" });
  }
  
  if (name) provider.name = name;
  if (base_url) provider.base_url = base_url;
  if (models) provider.models = models;
  if (api_key !== undefined) {
    provider.api_key = api_key ? encryptProviderKey(api_key, user.id) : provider.api_key;
  }

  // Upsert model_pricing for each model
  const modelNames = (models || provider.models).split(',').map((m: string) => m.trim());
  for (const modelName of modelNames) {
    const existing = db.model_pricing.find((mp: any) => mp.model_id === modelName);
    if (existing) {
      if (rate_limits !== undefined) existing.rate_limits = rate_limits;
      if (queue_max_size !== undefined) existing.queue_max_size = queue_max_size;
    } else {
      db.model_pricing.push({
        model_id: modelName,
        input_cost_per_1m_tokens: 0,
        output_cost_per_1m_tokens: 0,
        rate_limits: rate_limits || APP_CONFIG.default_provider_model_rate_limits,
        queue_max_size: queue_max_size ?? APP_CONFIG.default_provider_model_queue_max_size
      });
    }
  }

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
    .map((p: any) => ({ id: p.id, name: p.name, base_url: p.base_url, models: p.models }));

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
    const pricing = db.model_pricing.find((mp: any) => mp.model_id === e.model_id);
    const apiKey = db.api_keys.find((k: any) => k.id === e.api_key_id);
    const provider = db.providers.find((p: any) => p.id === e.provider_id);
    const inputCostPerM = pricing?.input_cost_per_1m_tokens ?? 0;
    const outputCostPerM = pricing?.output_cost_per_1m_tokens ?? 0;
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
  const { api_key, ...safeConfig } = APP_CONFIG;
  res.json({ 
    ...safeConfig, 
    app_name: APP_CONFIG.app_name,
    chat_persistence: CHAT_PERSISTENCE,
    signups_enabled: SIGNUPS_ENABLED,
    providers: db.providers.filter((p: any) => p.visibility === 'public').map((p: any) => {
      const { api_key, ...rest } = p;
      return rest;
    })
  });
});

app.post('/api/config', (req, res) => {
  res.json({ status: "success" });
});

app.post('/api/chat/stream', async (req, res) => {
  const { user, db, apiKey } = await getAuthContext(req);
  if (!user) return res.status(401).json({ detail: "Auth required" });
  if (!apiKey) return res.status(400).json({ detail: "An API key is required to use the chat" });

  const { messages, provider_id } = req.body;
  
  // Find the provider to use
  let provider = db.providers.find((p: any) => p.immutable === true);
  if (provider_id) {
    const requestedProvider = db.providers.find((p: any) => p.id === provider_id);
    if (requestedProvider) {
      if (requestedProvider.visibility === 'public' || requestedProvider.owner_id === user.id || (requestedProvider.group_id && isGroupMember(user, db, requestedProvider.group_id))) {
        provider = requestedProvider;
      } else {
        return res.status(403).json({ detail: "Forbidden: No access to this provider" });
      }
    }
  }
  
  if (!provider) {
    return res.status(400).json({ detail: "No provider configured" });
  }

  // Permission Check - verify access to provider
  if (!hasPermission(user, db, "use", "providers", provider.name)) {
    return res.status(403).json({ detail: "Forbidden: No permission to use this provider" });
  }

  // Rate limit check per user per model
  const modelId = provider.models.split(',')[0].trim();
  const modelLimits = getModelRateLimits(db, modelId);
  const rateLimitResult = rateLimiter.check(user.id, modelId, modelLimits);
  if (!rateLimitResult.allowed) {
    return res.status(429).json({ detail: `Rate limit exceeded for ${user.name} using model ${modelId} from provider ${provider.name}` });
  }

  const { messages: providerMessages } = req.body;
  const startTime = Date.now();
  const requestId = crypto.randomUUID();
  let inputTokens = 0;
  let outputTokens = 0;
  let firstTokenTime = 0; // ms offset from request start to first token arrival

  // Queue check per user per model
  const queueKey = `${provider.id}:${modelId}`;
  const queueMaxSize = getModelQueueMaxSize(db, modelId);
  const beforeQueueSize = requestQueue.getQueueSize(queueKey);

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
    source: 'UI',
    input_price_per_1m: APP_CONFIG.default_provider_model_in_price_1m,
    output_price_per_1m: APP_CONFIG.default_provider_model_out_price_1m,
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
    const inputCost = (inputTokens / 1_000_000) * APP_CONFIG.default_provider_model_in_price_1m;
    const outputCost = (outputTokens / 1_000_000) * APP_CONFIG.default_provider_model_out_price_1m;
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
      source: 'UI',
      input_price_per_1m: APP_CONFIG.default_provider_model_in_price_1m,
      output_price_per_1m: APP_CONFIG.default_provider_model_out_price_1m,
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
      const modelId = provider.models.split(',')[0].trim();
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
    const response = await axios.post(`${provider.base_url}/chat/completions`, buildProviderChatBody(
      req.body,
      provider.models.split(',')[0].trim(),
      messages,
      true
    ), {
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

  const { messages, model: reqModel, stream, provider_id } = req.body;
  
  // Find the provider to use
  let provider = db.providers.find((p: any) => p.immutable === true);
  if (provider_id) {
    const requestedProvider = db.providers.find((p: any) => p.id === provider_id);
    if (requestedProvider) {
      if (requestedProvider.visibility === 'public' || requestedProvider.owner_id === user.id || (requestedProvider.group_id && isGroupMember(user, db, requestedProvider.group_id))) {
        provider = requestedProvider;
      } else {
        return res.status(403).json({ error: { message: "Forbidden: No access to this provider", type: "permission_error", code: "insufficient_permissions" }});
      }
    }
  }
  
  if (!provider) {
    return res.status(400).json({ error: { message: "No provider configured", type: "invalid_request_error" }});
  }

  if (!hasPermission(user, db, "use", "providers", provider.name)) {
    return res.status(403).json({ error: { message: "Forbidden: No permission to use this provider", type: "permission_error", code: "insufficient_permissions" }});
  }

  // Rate limit check per user per model
  const chatModelId = reqModel || provider.models.split(',')[0].trim();
  const modelLimits = getModelRateLimits(db, chatModelId);
  const rateLimitResult = rateLimiter.check(user.id, chatModelId, modelLimits);
  if (!rateLimitResult.allowed) {
    return res.status(429).json({ error: { message: `Rate limit exceeded for ${user.name} using model ${chatModelId} from provider ${provider.name}`, type: "rate_limit_exceeded" }});
  }

  const startTime = Date.now();
  const requestId = `chatcmpl-${crypto.randomUUID()}`;
  res.locals.log = { request_id: requestId, provider_id: provider.id, source: 'API' };

  // Queue check per user per model
  const queueKey = `${provider.id}:${chatModelId}`;
  const queueMaxSize = getModelQueueMaxSize(db, chatModelId);
  const beforeQueueSize = requestQueue.getQueueSize(queueKey);

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
    source: 'API',
    input_price_per_1m: APP_CONFIG.default_provider_model_in_price_1m,
    output_price_per_1m: APP_CONFIG.default_provider_model_out_price_1m,
    rate_limit_windows: rateLimitResult.windows,
    queue: { size: beforeQueueSize, limit: queueMaxSize }
  }));

  const queued = await requestQueue.enqueue(queueKey, queueMaxSize);
  if (!queued.ok) {
    if (queued.reason === 'timeout') {
      return res.status(504).json({ error: { message: `Request timed out waiting in queue for ${user.name} using model ${chatModelId} from provider ${provider.name}`, type: "queue_timeout" }});
    }
    console.log(JSON.stringify({
      timestamp: new Date().toISOString(),
      event: 'queue_full',
      queue_key: queueKey,
      queue: { size: requestQueue.getQueueSize(queueKey), limit: queueMaxSize },
      provider_id: provider.id,
      provider_name: provider.name,
      model_id: chatModelId,
      owner_id: provider.owner_id || null,
      api_key_prefix: apiKey?.key_prefix || 'N/A'
    }));
    return res.status(429).json({ error: { message: `Too many concurrent requests for ${user.name} using model ${chatModelId} from provider ${provider.name}`, type: "queue_full" }});
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
    const response = await axios.post(`${provider.base_url}/chat/completions`, buildProviderChatBody(
      req.body,
      reqModel || provider.models.split(',')[0].trim(),
      messages,
      false
    ), {
      headers: { 'Authorization': `Bearer ${resolveProviderApiKey(provider)}` }
    });

    const assistantMessage = response.data.choices[0].message;
    const duration = Date.now() - startTime;
    const outputTokens = Math.ceil((assistantMessage.content?.length || 0) / 4);
    const inputCost = (inputTokens / 1_000_000) * APP_CONFIG.default_provider_model_in_price_1m;
    const outputCost = (outputTokens / 1_000_000) * APP_CONFIG.default_provider_model_out_price_1m;

    requestQueue.dequeue(queueKey);

    res.locals.log = {
      ...res.locals.log,
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      tokens_per_second: duration > 0 ? parseFloat((outputTokens / (duration / 1000)).toFixed(2)) : 0,
      input_price_per_1m: APP_CONFIG.default_provider_model_in_price_1m,
      output_price_per_1m: APP_CONFIG.default_provider_model_out_price_1m,
      input_cost: Math.round(inputCost * 1_000_000_000) / 1_000_000_000,
      output_cost: Math.round(outputCost * 1_000_000_000) / 1_000_000_000,
      total_cost: Math.round((inputCost + outputCost) * 1_000_000_000) / 1_000_000_000,
      rate_limit_windows: rateLimitResult.windows,
      queue: { size: requestQueue.getQueueSize(queueKey), limit: queueMaxSize }
    };
    
    // Record usage event
    const modelId = reqModel || provider.models.split(',')[0].trim();
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
    });
    await saveDb(db);

    res.json({
      id: requestId,
      object: "chat.completion",
      created: Math.floor(Date.now() / 1000),
      model: reqModel || APP_CONFIG.model,
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
    res.status(500).json({ error: { message: err.message, type: "internal_error", code: "internal_error" }});
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
    const pricing = db.model_pricing.find((mp: any) => mp.model_id === e.model_id);
    const apiKey = db.api_keys.find((k: any) => k.id === e.api_key_id);
    const provider = db.providers.find((p: any) => p.id === e.provider_id);

    const inputCostPerM = pricing?.input_cost_per_1m_tokens ?? 0;
    const outputCostPerM = pricing?.output_cost_per_1m_tokens ?? 0;

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
export { app };
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
