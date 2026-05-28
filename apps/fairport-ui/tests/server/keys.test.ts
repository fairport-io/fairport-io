import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-jwt-secret';
process.env.SECRET_KEY = 'test-secret-key';
process.env.PORT = '0';

let app: any;
let token: string;

beforeAll(async () => {
  const mod = await import('../../server');
  app = mod.app;

  const res = await request(app)
    .post('/api/auth/signup')
    .send({ username: `keys-${Date.now()}@example.com`, password: 'password123' });
  token = res.body.token;
});

const auth = () => ({ Authorization: `Bearer ${token}` });

describe('POST /api/keys', () => {
  it('creates a key and returns full key value', async () => {
    const res = await request(app)
      .post('/api/keys')
      .set(auth())
      .send({ name: 'test-key' });

    expect(res.status).toBe(200);
    expect(res.body.key).toMatch(/^sk-[a-f0-9]{32}$/);
    expect(res.body.name).toBe('test-key');
    expect(res.body.key_hash).toBe('********');
  });

  it('rejects duplicate key name per user with 409', async () => {
    await request(app)
      .post('/api/keys')
      .set(auth())
      .send({ name: 'duplicate-key' });

    const res = await request(app)
      .post('/api/keys')
      .set(auth())
      .send({ name: 'duplicate-key' });

    expect(res.status).toBe(409);
    expect(res.body.detail).toContain('duplicate-key');
  });

  it('enforces max 5 keys per user', async () => {
    // User already has 1 default key from signup + 2 from above = 3
    // Create 2 more to hit 5, then 6th should fail
    await request(app).post('/api/keys').set(auth()).send({ name: 'max-key-1' });
    await request(app).post('/api/keys').set(auth()).send({ name: 'max-key-2' });

    const res = await request(app)
      .post('/api/keys')
      .set(auth())
      .send({ name: 'max-key-final' });

    expect(res.status).toBe(400);
    expect(res.body.detail).toContain('Maximum of 5');
  });

  it('requires auth', async () => {
    const res = await request(app)
      .post('/api/keys')
      .send({ name: 'no-auth' });

    expect(res.status).toBe(401);
  });
});

describe('GET /api/keys', () => {
  it('returns user keys masked', async () => {
    const res = await request(app)
      .get('/api/keys')
      .set(auth());

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    for (const key of res.body) {
      expect(key.key).toMatch(/sk-.*\*\*\*\*\*\*\*\*/);
    }
  });
});

describe('DELETE /api/keys/:id', () => {
  let keyId: string;

  beforeAll(async () => {
    // Delete an existing key to make room for a new one (max 5)
    const keys = await request(app).get('/api/keys').set(auth());
    if (keys.body.length >= 5) {
      await request(app).delete(`/api/keys/${keys.body[0].id}`).set(auth());
    }
    const res = await request(app)
      .post('/api/keys')
      .set(auth())
      .send({ name: `delete-me-${Date.now()}` });
    keyId = res.body.id;
  });

  it('deletes owned key', async () => {
    expect(keyId).toBeDefined();
    const res = await request(app)
      .delete(`/api/keys/${keyId}`)
      .set(auth());

    expect(res.status).toBe(200);
  });

  it('returns 404 for non-existent key', async () => {
    const res = await request(app)
      .delete('/api/keys/nonexistent-id')
      .set(auth());

    expect(res.status).toBe(404);
  });
});
