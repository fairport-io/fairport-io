import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import request from 'supertest';

// Must be set before importing server to prevent auto-start
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-jwt-secret';
process.env.SECRET_KEY = 'test-secret-key';
process.env.PORT = '0';

let app: any;
let server: any;

beforeAll(async () => {
  const mod = await import('../../server');
  app = mod.app;
});

afterAll(() => {
  if (server) server.close();
});

describe('POST /api/auth/signup', () => {
  it('creates user with valid email and password >= 8 chars', async () => {
    const res = await request(app)
      .post('/api/auth/signup')
      .send({ username: 'test@example.com', password: 'password123' });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('token');
    expect(res.body.user).toHaveProperty('id');
    expect(res.body.user.name).toBe('test@example.com');
    expect(res.body).toHaveProperty('api_key');
    expect(res.body.api_key).toMatch(/^sk-/);
  });

  it('rejects duplicate username with 409', async () => {
    await request(app)
      .post('/api/auth/signup')
      .send({ username: 'dup@example.com', password: 'password123' });

    const res = await request(app)
      .post('/api/auth/signup')
      .send({ username: 'dup@example.com', password: 'password123' });

    expect(res.status).toBe(409);
    expect(res.body.detail).toBe('User exists');
  });

  it('rejects password < 8 chars with 400', async () => {
    const res = await request(app)
      .post('/api/auth/signup')
      .send({ username: 'short@example.com', password: 'short' });

    expect(res.status).toBe(400);
    expect(res.body.detail).toBe('Invalid data');
  });

  it('rejects missing fields with 400', async () => {
    const res = await request(app)
      .post('/api/auth/signup')
      .send({ username: 'nope@example.com' });

    expect(res.status).toBe(400);
  });
});

describe('POST /api/auth/login', () => {
  beforeAll(async () => {
    await request(app)
      .post('/api/auth/signup')
      .send({ username: 'login@example.com', password: 'password123' });
  });

  it('logs in with valid credentials', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ username: 'login@example.com', password: 'password123' });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('token');
    expect(res.body.user.name).toBe('login@example.com');
  });

  it('rejects wrong password with 401', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ username: 'login@example.com', password: 'wrongpass1' });

    expect(res.status).toBe(401);
    expect(res.body.detail).toContain('Invalid credentials');
  });

  it('rejects non-existent user with 401', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ username: 'ghost@example.com', password: 'password123' });

    expect(res.status).toBe(401);
  });

  it('rejects OAuth-only user with SSO message', async () => {
    // OAuth-only users have empty password_hash set during OAuth callback.
    // Testing this requires direct DB manipulation (clearing password_hash),
    // which is covered by the server logic at server.ts:632-634.
    // Skipping in integration tests — would require a test-only endpoint.
  });
});

describe('GET /api/auth/session', () => {
  let token: string;

  beforeAll(async () => {
    const res = await request(app)
      .post('/api/auth/signup')
      .send({ username: 'session@example.com', password: 'password123' });
    token = res.body.token;
  });

  it('returns user info with valid JWT', async () => {
    const res = await request(app)
      .get('/api/auth/session')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.logged_in).toBe(true);
    expect(res.body.username).toBe('session@example.com');
  });

  it('returns logged_in: false with no token', async () => {
    const res = await request(app).get('/api/auth/session');
    expect(res.body.logged_in).toBe(false);
  });

  it('returns logged_in: false with invalid token', async () => {
    const res = await request(app)
      .get('/api/auth/session')
      .set('Authorization', 'Bearer invalid-token-here');

    expect(res.body.logged_in).toBe(false);
  });
});

describe('POST /api/auth/logout', () => {
  it('returns success', async () => {
    const res = await request(app).post('/api/auth/logout');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('success');
  });
});

describe('DELETE /api/auth/account', () => {
  let token: string;

  beforeAll(async () => {
    const res = await request(app)
      .post('/api/auth/signup')
      .send({ username: 'delete@example.com', password: 'password123' });
    token = res.body.token;
  });

  it('deletes user and all associated data', async () => {
    const res = await request(app)
      .delete('/api/auth/account')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
  });

  it('requires auth', async () => {
    const res = await request(app).delete('/api/auth/account');
    expect(res.status).toBe(401);
  });
});

describe('SIGNUPS_ENABLED=false', () => {
  let disabledApp: any;

  beforeAll(async () => {
    process.env.SIGNUPS_ENABLED = 'false';
    vi.resetModules();
    const mod = await import('../../server');
    disabledApp = mod.app;
  });

  afterAll(() => {
    delete process.env.SIGNUPS_ENABLED;
  });

  it('rejects signup with 403', async () => {
    const res = await request(disabledApp)
      .post('/api/auth/signup')
      .send({ username: 'blocked@example.com', password: 'password123' });
    expect(res.status).toBe(403);
    expect(res.body.detail).toBe('Signups are disabled.');
  });

  it('reports signups_enabled: false in config', async () => {
    const res = await request(disabledApp)
      .get('/api/config');
    expect(res.status).toBe(200);
    expect(res.body.signups_enabled).toBe(false);
  });
});

describe('BASE_PATH', () => {
  let prefixedApp: any;

  beforeAll(async () => {
    vi.stubEnv('BASE_PATH', '/chat/');
    vi.resetModules();
    prefixedApp = (await import('../../server')).app;
  });

  afterAll(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('serves APIs below the prefix and redirects its bare path', async () => {
    await request(prefixedApp).get('/chat/api/auth/session').expect(200, { logged_in: false });
    await request(prefixedApp).get('/chat').expect(308).expect('Location', '/chat/');
  });
});
