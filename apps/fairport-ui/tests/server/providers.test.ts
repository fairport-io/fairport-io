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
let modelsTestToken: string;
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

  const modelsRes = await request(app)
    .post('/api/auth/signup')
    .send({ username: `provider-test-models-${Date.now()}@example.com`, password: 'password123' });
  modelsTestToken = modelsRes.body.token;
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
        models_path: 'custom/models',
        api_key: 'sk-test-key',
      });

    expect(res.status).toBe(200);
    expect(res.body.name).toBe('my-provider');
    expect(res.body.models_path).toBe('custom/models');
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

  it('discovers models using an unsaved API key without weakening the request controls', async () => {
    const getSpy = vi.spyOn(axios, 'get').mockResolvedValueOnce({
      status: 200,
      data: { data: [{ id: ' model-a ' }, { id: 'model-b' }, { id: 'model-a' }] },
    } as any);
    const res = await request(app)
      .post('/api/providers/test')
      .set(auth())
      .send({ base_url: 'http://public.test/v1', api_key: ' sk-model-test ' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      ok: true,
      status: 200,
      models: ['model-a', 'model-b'],
      endpoint: 'http://public.test/v1/models',
      detail: 'Discovered 2 models',
    });
    expect(JSON.stringify(res.body)).not.toContain('sk-model-test');
    expect(getSpy.mock.calls[0][0]).toBe('http://public.test/v1/models');
    const config: any = getSpy.mock.calls[0][1];
    expect(config).toMatchObject({
      maxRedirects: 0,
      proxy: false,
      maxContentLength: 1024 * 1024,
      responseType: 'json',
      headers: { Accept: 'application/json', Authorization: 'Bearer sk-model-test' },
    });
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
    getSpy.mockRestore();
  });

  it('reports connection failures without echoing the API key', async () => {
    const getSpy = vi.spyOn(axios, 'get').mockRejectedValueOnce(Object.assign(new Error('refused'), { code: 'ECONNREFUSED' }));
    const res = await request(app)
      .post('/api/providers/test')
      .set(auth())
      .send({ base_url: 'http://public.test/v1', api_key: 'sk-do-not-echo' });

    expect(res.status).toBe(502);
    expect(res.body).toMatchObject({
      detail: 'Models endpoint request failed (ECONNREFUSED)',
      endpoint: 'http://public.test/v1/models',
    });
    expect(JSON.stringify(res.body)).not.toContain('sk-do-not-echo');
    getSpy.mockRestore();
  });

  it('uses a wall-clock abort signal for the total models request deadline', async () => {
    const controller = new AbortController();
    controller.abort();
    const timeoutSpy = vi.spyOn(AbortSignal, 'timeout').mockReturnValueOnce(controller.signal);
    const getSpy = vi.spyOn(axios, 'get').mockRejectedValueOnce(Object.assign(new Error('canceled'), { code: 'ERR_CANCELED' }));
    const res = await request(app)
      .post('/api/providers/test')
      .set(auth())
      .send({ base_url: 'http://public.test/v1' });

    expect(res.status).toBe(504);
    expect(res.body).toEqual({
      detail: 'Models endpoint request timed out',
      endpoint: 'http://public.test/v1/models',
    });
    expect(timeoutSpy.mock.calls[0][0]).toBeGreaterThan(0);
    expect(timeoutSpy.mock.calls[0][0]).toBeLessThanOrEqual(3000);
    expect(getSpy.mock.calls[0][1]).toMatchObject({ signal: controller.signal });
    getSpy.mockRestore();
    timeoutSpy.mockRestore();
  });

  it('applies the same private-address authorization as provider changes', async () => {
    const res = await request(app)
      .post('/api/providers/test')
      .set(auth())
      .send({ base_url: 'http://service.default/v1' });

    expect(res.status).toBe(403);
  });

  it('lets Global Admins discover models from a cluster-local provider', async () => {
    const getSpy = vi.spyOn(axios, 'get').mockResolvedValueOnce({
      status: 200,
      data: { data: [{ id: 'llama3-8b' }, { id: 'llama-guard3-8b' }] },
    } as any);
    const res = await request(app)
      .post('/api/providers/test')
      .set(adminAuth())
      .send({ base_url: 'http://service.default/openai/v1' });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      models: ['llama3-8b', 'llama-guard3-8b'],
      endpoint: 'http://service.default/openai/v1/models',
    });
    expect(getSpy.mock.calls[0][0]).toBe('http://service.default/openai/v1/models');
    getSpy.mockRestore();
  });

  it('supports relative and root-absolute models paths on the provider origin', async () => {
    const getSpy = vi.spyOn(axios, 'get').mockResolvedValue({ status: 200, data: { data: [{ id: 'model-a' }] } } as any);
    const relative = await request(app)
      .post('/api/providers/test')
      .set({ Authorization: `Bearer ${modelsTestToken}` })
      .send({ base_url: 'http://public.test/v1', models_path: 'custom/models' });
    const absolute = await request(app)
      .post('/api/providers/test')
      .set({ Authorization: `Bearer ${modelsTestToken}` })
      .send({ base_url: 'http://public.test/v1', models_path: '/openai/v1/models' });

    expect(relative.body.endpoint).toBe('http://public.test/v1/custom/models');
    expect(absolute.body.endpoint).toBe('http://public.test/openai/v1/models');
    expect(getSpy.mock.calls.map(call => call[0])).toEqual([
      'http://public.test/v1/custom/models',
      'http://public.test/openai/v1/models',
    ]);
    getSpy.mockRestore();
  });

  it('returns the upstream status and endpoint for non-2xx or malformed model responses', async () => {
    const getSpy = vi.spyOn(axios, 'get')
      .mockResolvedValueOnce({ status: 401, data: { secret: 'not echoed' } } as any)
      .mockResolvedValueOnce({ status: 200, data: { models: [] } } as any);
    const unauthorized = await request(app)
      .post('/api/providers/test')
      .set({ Authorization: `Bearer ${modelsTestToken}` })
      .send({ base_url: 'http://public.test/v1' });
    const malformed = await request(app)
      .post('/api/providers/test')
      .set({ Authorization: `Bearer ${modelsTestToken}` })
      .send({ base_url: 'http://public.test/v1' });

    expect(unauthorized.status).toBe(502);
    expect(unauthorized.body).toEqual({
      detail: 'Models endpoint returned HTTP 401',
      status: 401,
      endpoint: 'http://public.test/v1/models',
    });
    expect(malformed.status).toBe(502);
    expect(malformed.body).toMatchObject({ status: 200, endpoint: 'http://public.test/v1/models' });
    expect(malformed.body.detail).toContain('OpenAI-compatible');
    expect(JSON.stringify(unauthorized.body)).not.toContain('not echoed');
    getSpy.mockRestore();
  });

  it('rejects unsafe model IDs and excessive model counts', async () => {
    const getSpy = vi.spyOn(axios, 'get')
      .mockResolvedValueOnce({ status: 200, data: { data: [{ id: 'model-a,model-b' }] } } as any)
      .mockResolvedValueOnce({
        status: 200,
        data: { data: Array.from({ length: 1001 }, (_, i) => ({ id: `model-${i}` })) },
      } as any);
    const unsafeId = await request(app)
      .post('/api/providers/test')
      .set({ Authorization: `Bearer ${modelsTestToken}` })
      .send({ base_url: 'http://public.test/v1' });
    const excessive = await request(app)
      .post('/api/providers/test')
      .set({ Authorization: `Bearer ${modelsTestToken}` })
      .send({ base_url: 'http://public.test/v1' });

    expect(unsafeId.status).toBe(502);
    expect(unsafeId.body.detail).toContain('invalid model id');
    expect(excessive.status).toBe(502);
    expect(excessive.body.detail).toContain('OpenAI-compatible');
    getSpy.mockRestore();
  });

  it('rejects URL-like, traversing, queried, fragmented, or encoded-separator models paths', async () => {
    const getSpy = vi.spyOn(axios, 'get').mockResolvedValue({ status: 200, data: { data: [] } } as any);
    for (const modelsPath of [
      'https://evil.example/models',
      '//evil.example/models',
      '../models',
      'models?scope=all',
      'models#fragment',
      '%2e%2e/models',
      'custom%2fmodels',
    ]) {
      const res = await request(app)
        .post('/api/providers/test')
        .set(adminAuth())
        .send({ base_url: 'http://public.test/v1', models_path: modelsPath });
      expect(res.status).toBe(400);
    }
    for (const baseUrl of ['http://public.test/v1?tenant=a', 'http://public.test/v1#fragment']) {
      const res = await request(app)
        .post('/api/providers/test')
        .set(adminAuth())
        .send({ base_url: baseUrl, models_path: 'models' });
      expect(res.status).toBe(400);
    }
    expect(getSpy).not.toHaveBeenCalled();
    getSpy.mockRestore();
  });

  it('omits empty API keys but rejects control characters', async () => {
    const getSpy = vi.spyOn(axios, 'get').mockResolvedValue({ status: 200, data: { data: [] } } as any);
    for (const apiKey of ['', '   ']) {
      const res = await request(app)
        .post('/api/providers/test')
        .set(auth())
        .send({ base_url: 'http://public.test/v1', api_key: apiKey });
      expect(res.status).toBe(200);
    }
    expect(getSpy).toHaveBeenCalledTimes(2);
    for (const [, config] of getSpy.mock.calls) {
      expect((config as any).headers).not.toHaveProperty('Authorization');
    }

    const invalid = await request(app)
      .post('/api/providers/test')
      .set(auth())
      .send({ base_url: 'http://public.test/v1', api_key: 'sk-test\r\nX-Injected: yes' });
    expect(invalid.status).toBe(400);
    expect(getSpy).toHaveBeenCalledTimes(2);
    getSpy.mockRestore();
  });

  it('rate limits connection tests per user', async () => {
    const getSpy = vi.spyOn(axios, 'get').mockResolvedValue({ status: 200, data: { data: [{ id: 'model-a' }] } } as any);
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
    expect(getSpy).toHaveBeenCalledTimes(10);
    getSpy.mockRestore();
  });
});

describe('GET /api/providers', () => {
  it('keeps the legacy array response and includes model counts', async () => {
    const res = await request(app)
      .get('/api/providers')
      .set(auth());

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body).not.toHaveProperty('data');
    expect(res.body.some((p: any) => p.immutable)).toBe(true);
    expect(res.body.find((p: any) => p.name === 'my-provider')).toEqual(expect.objectContaining({
      models_path: 'custom/models',
      models: 'llama3,mistral',
      model_count: 2,
    }));
  });

  it('paginates only when an explicit cursor request is supplied', async () => {
    const first = await request(app)
      .get('/api/providers')
      .query({ limit: 1 })
      .set(auth());

    expect(first.status).toBe(200);
    expect(first.body).toEqual(expect.objectContaining({
      object: 'list',
      has_more: true,
      next_cursor: expect.any(String),
    }));
    expect(first.body.data).toHaveLength(1);

    const second = await request(app)
      .get('/api/providers')
      .query({ limit: 1, after: first.body.next_cursor })
      .set(auth());

    expect(second.status).toBe(200);
    expect(second.body.object).toBe('list');
    expect(second.body.data).toHaveLength(1);
    expect(second.body.data[0].id).not.toBe(first.body.data[0].id);
    expect(
      `${second.body.data[0].name}\0${second.body.data[0].id}` >
      `${first.body.data[0].name}\0${first.body.data[0].id}`
    ).toBe(true);
  });

  it('rejects group filters for nonmembers', async () => {
    const res = await request(app)
      .get('/api/providers')
      .query({ group_id: 'global_admin' })
      .set(auth());

    expect(res.status).toBe(403);
    expect(res.body.detail).toBe('Not a member of this group');
  });

  it('includes rate_limits and queue_max_size from the first offering', async () => {
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
      .send({ name: 'updated-name', models_path: '/openai/v1/models' });

    expect(res.status).toBe(200);
    expect(res.body.name).toBe('updated-name');
    expect(res.body.models_path).toBe('/openai/v1/models');
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
