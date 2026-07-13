import { describe, it, expect, beforeAll, vi } from 'vitest';
import request from 'supertest';
import { PassThrough } from 'stream';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-jwt-secret';
process.env.SECRET_KEY = 'test-secret-key';
process.env.PORT = '0';

const { axiosPost } = vi.hoisted(() => ({
  axiosPost: vi.fn(),
}));

vi.mock('axios', () => ({
  default: {
    get: vi.fn(),
    post: axiosPost,
  },
}));

let app: any;
let token: string;
let keyId: string;

beforeAll(async () => {
  const mod = await import('../../server');
  app = mod.app;

  const signup = await request(app)
    .post('/api/auth/signup')
    .send({ username: `chat-stream-${Date.now()}@example.com`, password: 'password123' });
  token = signup.body.token;

  const keys = await request(app)
    .get('/api/keys')
    .set({ Authorization: `Bearer ${token}` });
  keyId = keys.body[0].id;
});

const auth = () => ({ Authorization: `Bearer ${token}` });

describe('POST /api/chat/stream', () => {
  it('streams provider content even when SSE lines are split across chunks', async () => {
    axiosPost.mockImplementationOnce(() => {
      const stream = new PassThrough();
      setTimeout(() => {
        stream.write('data: {"choices":[{"delta":{"content":"Hel');
        stream.write('lo"}}]}\n\n');
        stream.write('data: [DO');
        stream.write('NE]\n\n');
        stream.end();
      }, 0);
      return Promise.resolve({ data: stream });
    });

    const res = await request(app)
      .post('/api/chat/stream')
      .set({ ...auth(), 'x-api-key-id': keyId })
      .send({ messages: [{ role: 'user', content: 'hi' }], provider_id: 'provider-id-default' });

    expect(res.status).toBe(200);
    expect(res.text).toContain('data: {"type":"response","content":"Hello"}');
    expect(res.text).toContain('"type":"done"');
    expect(axiosPost).toHaveBeenCalledWith(
      expect.stringMatching(/\/chat\/completions$/),
      expect.objectContaining({
        messages: [{ role: 'user', content: 'hi' }],
        stream: true,
      }),
      expect.objectContaining({ responseType: 'stream' })
    );
  });
});
