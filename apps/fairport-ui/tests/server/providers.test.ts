import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-jwt-secret';
process.env.SECRET_KEY = 'test-secret-key';
process.env.PORT = '0';

let app: any;
let token: string;
let providerId: string;

beforeAll(async () => {
  const mod = await import('../../server');
  app = mod.app;

  const res = await request(app)
    .post('/api/auth/signup')
    .send({ username: `providers-${Date.now()}@example.com`, password: 'password123' });
  token = res.body.token;
});

const auth = () => ({ Authorization: `Bearer ${token}` });

describe('POST /api/providers', () => {
  it('creates a provider with required fields', async () => {
    const res = await request(app)
      .post('/api/providers')
      .set(auth())
      .send({
        name: 'my-provider',
        base_url: 'http://localhost:11434/v1',
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
        base_url: 'http://localhost:11434/v1',
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
        base_url: 'http://localhost:11434/v1',
        queue_max_size: -1,
      });

    expect(res.status).toBe(400);
  });

  it('rejects duplicate provider name with 409', async () => {
    await request(app)
      .post('/api/providers')
      .set(auth())
      .send({ name: 'dup-provider', base_url: 'http://localhost:11434/v1' });

    const res = await request(app)
      .post('/api/providers')
      .set(auth())
      .send({ name: 'dup-provider', base_url: 'http://localhost:11434/v1' });

    expect(res.status).toBe(409);
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
      .send({ name: 'update-me', base_url: 'http://localhost:11434/v1' });
    providerId = res.body.id;
  });

  it('updates owned provider', async () => {
    const res = await request(app)
      .put(`/api/providers/${providerId}`)
      .set(auth())
      .send({ name: 'updated-name' });

    expect(res.status).toBe(200);
    expect(res.body.name).toBe('updated-name');
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
      .send({ name: 'delete-me-provider', base_url: 'http://localhost:11434/v1' });
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
