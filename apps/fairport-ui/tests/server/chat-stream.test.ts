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
let apiKey: string;

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

  const apiSignup = await request(app)
    .post('/api/auth/signup')
    .send({ username: `chat-api-${Date.now()}@example.com`, password: 'password123' });
  apiKey = apiSignup.body.api_key;
});

const auth = () => ({ Authorization: `Bearer ${token}` });

describe('POST /api/chat/stream', () => {
  it('passes through chat parameters and streams split SSE chunks', async () => {
    const messages = [{ role: 'user', content: 'hi' }];
    const responseFormat = {
      type: 'json_schema',
      json_schema: {
        name: 'answer',
        schema: { type: 'object', properties: { answer: { type: 'string' } } },
      },
    };

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
      .send({
        messages,
        model: 'client-model',
        stream: false,
        provider: 'default',
        provider_id: 'provider-id-default',
        temperature: 0.25,
        response_format: responseFormat,
      });

    expect(res.status).toBe(200);
    expect(res.text).toContain('data: {"type":"response","content":"Hello"}');
    expect(res.text).toContain('"type":"done"');
    const forwardedBody = axiosPost.mock.calls[axiosPost.mock.calls.length - 1][1];
    expect(forwardedBody).toEqual({
      temperature: 0.25,
      response_format: responseFormat,
      model: 'default',
      messages,
      stream: true,
    });
  });
});

describe('POST /v1/chat/completions', () => {
  it('passes through chat parameters without forwarding Fairport-only fields', async () => {
    const messages = [{ role: 'user', content: 'hi' }];
    const tools = [{
      type: 'function',
      function: {
        name: 'get_weather',
        parameters: { type: 'object', properties: { city: { type: 'string' } } },
      },
    }];
    axiosPost.mockResolvedValueOnce({
      data: { choices: [{ message: { role: 'assistant', content: 'Hello' } }] },
    });

    const res = await request(app)
      .post('/v1/chat/completions')
      .set({ Authorization: `Bearer ${apiKey}` })
      .send({
        messages,
        model: 'requested-model',
        stream: 'client-value',
        provider: 'default',
        provider_id: 'provider-id-default',
        top_p: 0.9,
        tools,
      });

    expect(res.status).toBe(200);
    const forwardedBody = axiosPost.mock.calls[axiosPost.mock.calls.length - 1][1];
    expect(forwardedBody).toEqual({
      top_p: 0.9,
      tools,
      model: 'requested-model',
      messages,
      stream: false,
    });
  });
});
