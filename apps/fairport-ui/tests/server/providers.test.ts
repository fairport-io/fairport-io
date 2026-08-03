import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import request from 'supertest';
import dns from 'dns';
import axios from 'axios';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-jwt-secret';
process.env.SECRET_KEY = 'test-secret-key';
process.env.PORT = '0';
process.env.BOOTSTRAP_ADMIN_EMAILS = 'provider-admin@example.com';

let app: any;
let token: string;
let adminToken: string;
let testRateToken: string;
let providerId: string;
let adminPrivateGroupProviderId: string;
let lookupSpy: any;

beforeAll(async () => {
  lookupSpy = vi.spyOn(dns.promises, 'lookup').mockImplementation((async (hostname: string) => {
    if (hostname === 'service.default') return [{ address: '10.96.0.20', family: 4 }];
    if (hostname === 'mixed.test') return [{ address: '93.184.216.34', family: 4 }, { address: '10.96.0.20', family: 4 }];
    if (hostname === 'example.com' || hostname === 'public.test') return [{ address: '93.184.216.34', family: 4 }];
    throw Object.assign(new Error('not found'), { code: 'ENOTFOUND' });
  }) as any);

  const mod = await import('../../server');
  app = mod.app;

  const res = await request(app)
    .post('/api/auth/signup')
    .send({ username: `providers-${Date.now()}@example.com`, password: 'password123' });
  token = res.body.token;

  await request(app)
    .post('/api/auth/signup')
    .send({ username: 'provider-admin@example.com', password: 'password123' });
  const adminLogin = await request(app)
    .post('/api/auth/login')
    .send({ username: 'provider-admin@example.com', password: 'password123' });
  adminToken = adminLogin.body.token;

  const rateRes = await request(app)
    .post('/api/auth/signup')
    .send({ username: `provider-test-rate-${Date.now()}@example.com`, password: 'password123' });
  testRateToken = rateRes.body.token;
});

const auth = () => ({ Authorization: `Bearer ${token}` });
const adminAuth = () => ({ Authorization: `Bearer ${adminToken}` });

afterAll(() => {
  lookupSpy.mockRestore();
  delete process.env.BOOTSTRAP_ADMIN_EMAILS;
});

describe('POST /api/providers', () => {
  it('creates a provider with required fields', async () => {
    const res = await request(app)
      .post('/api/providers')
      .set(auth())
      .send({
        name: 'my-provider',
        base_url: 'http://example.com/v1',
        models: 'llama3,mistral',
        api_key: 'sk-test-key',
      });

    expect(res.status).toBe(200);
    expect(res.body.name).toBe('my-provider');
    expect(res.body.immutable).toBe(false);
    expect(res.body.api_key).not.toBe('sk-test-key');
  });

  it('rejects missing name/base_url with 400', async () => {
    const res = await request(app)
      .post('/api/providers')
      .set(auth())
      .send({ name: 'no-url' });

    expect(res.status).toBe(400);
  });

  it('rejects invalid rate_limits with 400', async () => {
    const res = await request(app)
      .post('/api/providers')
      .set(auth())
      .send({
        name: 'bad-limits',
        base_url: 'http://example.com/v1',
        rate_limits: 'invalid-format',
      });

    expect(res.status).toBe(400);
  });

  it('rejects invalid queue_max_size with 400', async () => {
    const res = await request(app)
      .post('/api/providers')
      .set(auth())
      .send({
        name: 'bad-queue',
        base_url: 'http://example.com/v1',
        queue_max_size: -1,
      });

    expect(res.status).toBe(400);
  });

  it('rejects duplicate provider name with 409', async () => {
    await request(app)
      .post('/api/providers')
      .set(auth())
      .send({ name: 'dup-provider', base_url: 'http://example.com/v1' });

    const res = await request(app)
      .post('/api/providers')
      .set(auth())
      .send({ name: 'dup-provider', base_url: 'http://example.com/v1' });

    expect(res.status).toBe(409);
  });

  it('rejects private literals and DNS-resolved cluster names for non-admins', async () => {
    const literal = await request(app)
      .post('/api/providers')
      .set(auth())
      .send({ name: 'private-literal', base_url: 'http://10.96.0.20/v1' });
    const clusterName = await request(app)
      .post('/api/providers')
      .set(auth())
      .send({ name: 'private-dns', base_url: 'http://service.default/v1' });
    const mixedDns = await request(app)
      .post('/api/providers')
      .set(auth())
      .send({ name: 'mixed-dns', base_url: 'http://mixed.test/v1' });

    expect(literal.status).toBe(403);
    expect(clusterName.status).toBe(403);
    expect(mixedDns.status).toBe(403);
  });

  it('allows Global Admins to approve private provider URLs', async () => {
    const res = await request(app)
      .post('/api/providers')
      .set(adminAuth())
      .send({ name: 'admin-private', base_url: 'http://service.default/v1' });

    expect(res.status).toBe(200);
    expect(res.body.allow_private).toBe(true);
  });

  it('rejects loopback and link-local URLs even for Global Admins', async () => {
    const loopback = await request(app)
      .post('/api/providers')
      .set(adminAuth())
      .send({ name: 'admin-loopback', base_url: 'http://127.0.0.1/v1' });
    const metadata = await request(app)
      .post('/api/providers')
      .set(adminAuth())
      .send({ name: 'admin-metadata', base_url: 'http://169.254.169.254/v1' });
    const mappedLoopback = await request(app)
      .post('/api/providers')
      .set(adminAuth())
      .send({ name: 'admin-mapped-loopback', base_url: 'http://[::ffff:127.0.0.1]/v1' });

    expect(loopback.status).toBe(400);
    expect(metadata.status).toBe(400);
    expect(mappedLoopback.status).toBe(400);
  });
});

describe('POST /api/providers/test', () => {
  it('requires authentication', async () => {
    const res = await request(app)
      .post('/api/providers/test')
      .send({ base_url: 'http://public.test/v1' });

    expect(res.status).toBe(401);
  });

  it('reports a reachable HTTP endpoint without following redirects or using a proxy', async () => {
    const headSpy = vi.spyOn(axios, 'head').mockResolvedValueOnce({ status: 204 } as any);
    const res = await request(app)
      .post('/api/providers/test')
      .set(auth())
      .send({ base_url: 'http://public.test/v1' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, status: 204, detail: 'Endpoint reachable (HTTP 204)' });
    const config: any = headSpy.mock.calls[0][1];
    expect(config).toMatchObject({ maxRedirects: 0, proxy: false });
    expect(config.timeout).toBeGreaterThan(0);
    expect(config.timeout).toBeLessThanOrEqual(3000);

    const lookup = config.httpAgent.options.lookup;
    const pinned = await new Promise<{ address: string; family: number }>((resolve, reject) => {
      lookup('public.test', { family: 4 }, (error: Error | null, address: string, family: number) => {
        if (error) reject(error);
        else resolve({ address, family });
      });
    });
    expect(pinned).toEqual({ address: '93.184.216.34', family: 4 });

    const redirected = await new Promise<any>(resolve => {
      lookup('service.default', { family: 4 }, (error: Error | null) => resolve(error));
    });
    expect(redirected.code).toBe('EACCES');
    headSpy.mockRestore();
  });

  it('reports connection failures without saving a provider', async () => {
    const headSpy = vi.spyOn(axios, 'head').mockRejectedValueOnce(Object.assign(new Error('refused'), { code: 'ECONNREFUSED' }));
    const res = await request(app)
      .post('/api/providers/test')
      .set(auth())
      .send({ base_url: 'http://public.test/v1' });

    expect(res.status).toBe(502);
    expect(res.body.detail).toContain('ECONNREFUSED');
    headSpy.mockRestore();
  });

  it('applies the same private-address authorization as provider changes', async () => {
    const res = await request(app)
      .post('/api/providers/test')
      .set(auth())
      .send({ base_url: 'http://service.default/v1' });

    expect(res.status).toBe(403);
  });

  it('rate limits connection tests per user', async () => {
    const headSpy = vi.spyOn(axios, 'head').mockResolvedValue({ status: 204 } as any);
    for (let i = 0; i < 10; i++) {
      const res = await request(app)
        .post('/api/providers/test')
        .set({ Authorization: `Bearer ${testRateToken}` })
        .send({ base_url: 'http://public.test/v1' });
      expect(res.status).toBe(200);
    }

    const limited = await request(app)
      .post('/api/providers/test')
      .set({ Authorization: `Bearer ${testRateToken}` })
      .send({ base_url: 'http://public.test/v1' });

    expect(limited.status).toBe(429);
    expect(headSpy).toHaveBeenCalledTimes(10);
    headSpy.mockRestore();
  });
});

describe('GET /api/providers', () => {
  it('returns public and user-owned providers', async () => {
    const res = await request(app)
      .get('/api/providers')
      .set(auth());

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.some((p: any) => p.immutable)).toBe(true);
  });

  it('includes rate_limits and queue_max_size from model_pricing', async () => {
    const res = await request(app)
      .get('/api/providers')
      .set(auth());

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    const defaultProvider = res.body.find((p: any) => p.immutable);
    expect(defaultProvider).toBeDefined();
    expect(defaultProvider).toHaveProperty('rate_limits');
    expect(defaultProvider).toHaveProperty('queue_max_size');
  });
});

describe('PUT /api/providers/:id', () => {
  beforeAll(async () => {
    const res = await request(app)
      .post('/api/providers')
      .set(auth())
      .send({ name: 'update-me', base_url: 'http://example.com/v1' });
    providerId = res.body.id;

    const adminProvider = await request(app)
      .post('/api/providers')
      .set(adminAuth())
      .send({ name: 'admin-private-group', base_url: 'http://service.default/v1', group_id: 'default' });
    adminPrivateGroupProviderId = adminProvider.body.id;
  });

  it('updates owned provider', async () => {
    const res = await request(app)
      .put(`/api/providers/${providerId}`)
      .set(auth())
      .send({ name: 'updated-name' });

    expect(res.status).toBe(200);
    expect(res.body.name).toBe('updated-name');
  });

  it('lets a group member update other fields when an approved private URL is unchanged', async () => {
    const res = await request(app)
      .put(`/api/providers/${adminPrivateGroupProviderId}`)
      .set(auth())
      .send({ base_url: 'http://service.default/v1', models: 'updated-model' });

    expect(res.status).toBe(200);
    expect(res.body.models).toBe('updated-model');
    expect(res.body.allow_private).toBe(true);
  });

  it('rejects a group member changing an approved private provider URL', async () => {
    const res = await request(app)
      .put(`/api/providers/${adminPrivateGroupProviderId}`)
      .set(auth())
      .send({ base_url: 'http://example.com/v1' });

    expect(res.status).toBe(403);
  });

  it('rejects updating immutable provider with 403', async () => {
    const providers = await request(app)
      .get('/api/providers')
      .set(auth());

    expect(Array.isArray(providers.body)).toBe(true);
    const immutable = providers.body.find((p: any) => p.immutable);

    const res = await request(app)
      .put(`/api/providers/${immutable.id}`)
      .set(auth())
      .send({ name: 'hacked' });

    expect(res.status).toBe(403);
  });
});

describe('DELETE /api/providers/:id', () => {
  let deleteId: string;

  beforeAll(async () => {
    const res = await request(app)
      .post('/api/providers')
      .set(auth())
      .send({ name: 'delete-me-provider', base_url: 'http://example.com/v1' });
    deleteId = res.body.id;
  });

  it('deletes owned provider', async () => {
    const res = await request(app)
      .delete(`/api/providers/${deleteId}`)
      .set(auth());

    expect(res.status).toBe(200);
  });

  it('rejects deleting immutable provider with 403', async () => {
    const providers = await request(app)
      .get('/api/providers')
      .set(auth());

    expect(Array.isArray(providers.body)).toBe(true);
    const immutable = providers.body.find((p: any) => p.immutable);

    const res = await request(app)
      .delete(`/api/providers/${immutable.id}`)
      .set(auth());

    expect(res.status).toBe(403);
  });
});
