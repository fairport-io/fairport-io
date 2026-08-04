import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
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
let multiModelProviderId: string;
let multiModelProviderName: string;

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

  multiModelProviderName = `multi-model-${Date.now()}`;
  const provider = await request(app)
    .post('/api/providers')
    .set({ Authorization: `Bearer ${token}` })
    .send({
      name: multiModelProviderName,
      base_url: 'http://93.184.216.34/v1',
      models: 'llama-guard3-8b,llama3-8b',
      rate_limits: '1:request:hour',
    });
  if (provider.status !== 200) throw new Error(`Failed to create multi-model provider: ${provider.text}`);
  multiModelProviderId = provider.body.id;

  const apiSignup = await request(app)
    .post('/api/auth/signup')
    .send({ username: `chat-api-${Date.now()}@example.com`, password: 'password123' });
  apiKey = apiSignup.body.api_key;
});

const auth = () => ({ Authorization: `Bearer ${token}` });

afterEach(() => {
  vi.restoreAllMocks();
});

describe('POST /api/chat/stream', () => {
  it('passes through chat parameters and streams split SSE chunks', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
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
        model: 'llama3-8b',
        stream: false,
        provider: 'default',
        provider_id: multiModelProviderId,
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
      model: 'llama3-8b',
      messages,
      stream: true,
    });

    const chatLogs = logSpy.mock.calls
      .map(([entry]) => {
        try { return JSON.parse(entry); } catch { return null; }
      })
      .filter(entry => entry?.target_path === '/api/chat/stream' && entry?.request_id);
    expect(chatLogs).toEqual(expect.arrayContaining([
      expect.objectContaining({ status_code: 202, requested_model: 'llama3-8b', model: 'llama3-8b' }),
      expect.objectContaining({ status_code: 200, requested_model: 'llama3-8b', model: 'llama3-8b' }),
    ]));

    const usage = await request(app)
      .get('/api/usage')
      .set(auth());
    expect(usage.body).toEqual(expect.arrayContaining([
      expect.objectContaining({ provider_name: multiModelProviderName, model_id: 'llama3-8b' }),
    ]));

    const callsBeforeRateLimit = axiosPost.mock.calls.length;
    const limited = await request(app)
      .post('/api/chat/stream')
      .set({ ...auth(), 'x-api-key-id': keyId })
      .send({ messages, model: 'llama3-8b', provider_id: multiModelProviderId });
    expect(limited.status).toBe(429);
    expect(axiosPost.mock.calls).toHaveLength(callsBeforeRateLimit);

    const rateLimitLog = logSpy.mock.calls
      .map(([entry]) => {
        try { return JSON.parse(entry); } catch { return null; }
      })
      .find(entry => entry?.target_path === '/api/chat/stream' && entry?.status_code === 429);
    expect(rateLimitLog).toEqual(expect.objectContaining({
      requested_model: 'llama3-8b',
      model: 'llama3-8b',
      provider_id: multiModelProviderId,
    }));
  });

  it('rejects a model that is not configured for the selected provider', async () => {
    const callsBeforeRequest = axiosPost.mock.calls.length;
    const res = await request(app)
      .post('/api/chat/stream')
      .set({ ...auth(), 'x-api-key-id': keyId })
      .send({
        messages: [{ role: 'user', content: 'hi' }],
        model: 'unconfigured-model',
        provider_id: multiModelProviderId,
      });

    expect(res.status).toBe(400);
    expect(res.body.detail).toContain('not configured');
    expect(axiosPost.mock.calls).toHaveLength(callsBeforeRequest);
  });

  it('rejects an unknown provider instead of falling back to the default provider', async () => {
    const callsBeforeRequest = axiosPost.mock.calls.length;
    const res = await request(app)
      .post('/api/chat/stream')
      .set({ ...auth(), 'x-api-key-id': keyId })
      .send({
        messages: [{ role: 'user', content: 'hi' }],
        model: 'default',
        provider_id: 'provider-id-missing',
      });

    expect(res.status).toBe(400);
    expect(res.body.detail).toBe('Provider not found');
    expect(axiosPost.mock.calls).toHaveLength(callsBeforeRequest);
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
