import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import request from 'supertest';
import { PassThrough } from 'stream';
import dns from 'dns';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-jwt-secret';
process.env.SECRET_KEY = 'test-secret-key';
process.env.PORT = '0';
const apiUsername = `chat-api-${Date.now()}@example.com`;
process.env.BOOTSTRAP_ADMIN_EMAILS = apiUsername;

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
let memberApiKey: string;
let apiKey: string;
let apiToken: string;
let apiProviderId: string;
let apiProviderName: string;
let apiProviderModel: string;
let apiProviderAlternateModel: string;
let groupApiKey: string;
let groupProviderId: string;
let groupProviderModel: string;
let multiModelProviderId: string;
let multiModelProviderName: string;

beforeAll(async () => {
  const mod = await import('../../server');
  app = mod.app;

  const signup = await request(app)
    .post('/api/auth/signup')
    .send({ username: `chat-stream-${Date.now()}@example.com`, password: 'password123' });
  token = signup.body.token;
  memberApiKey = signup.body.api_key;

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
    .send({ username: apiUsername, password: 'password123' });
  apiKey = apiSignup.body.api_key;
  apiToken = apiSignup.body.token;

  apiProviderName = `api-provider-${Date.now()}`;
  apiProviderModel = `api-model-${Date.now()}`;
  apiProviderAlternateModel = `${apiProviderModel}-alternate`;
  const apiProvider = await request(app)
    .post('/api/providers')
    .set({ Authorization: `Bearer ${apiToken}` })
    .send({
      name: apiProviderName,
      base_url: 'http://93.184.216.34/v1',
      models: `${apiProviderModel},${apiProviderAlternateModel}`,
      rate_limits: '100:request:minute',
    });
  if (apiProvider.status !== 200) throw new Error(`Failed to create API provider: ${apiProvider.text}`);
  apiProviderId = apiProvider.body.id;
  const publicOffering = apiProvider.body.offerings?.find((offering: any) => offering.model_id === apiProviderModel);
  if (!publicOffering?.id) throw new Error('Failed to find API provider model offering');
  const published = await request(app)
    .patch(`/api/models/${publicOffering.id}`)
    .set({ Authorization: `Bearer ${apiToken}` })
    .send({ visibility: 'public' });
  if (published.status !== 200) throw new Error(`Failed to publish API provider model: ${published.text}`);

  groupProviderModel = `group-api-model-${Date.now()}`;
  const groupProvider = await request(app)
    .post('/api/providers')
    .set({ Authorization: `Bearer ${apiToken}` })
    .send({
      name: `group-api-provider-${Date.now()}`,
      base_url: 'http://93.184.216.34/v1',
      models: groupProviderModel,
      rate_limits: '100:request:minute',
      group_id: 'global_admin',
    });
  if (groupProvider.status !== 200) throw new Error(`Failed to create group API provider: ${groupProvider.text}`);
  groupProviderId = groupProvider.body.id;

  const groupKey = await request(app)
    .post('/api/keys')
    .set({ Authorization: `Bearer ${apiToken}` })
    .send({ name: `group-api-key-${Date.now()}`, group_id: 'global_admin' });
  if (groupKey.status !== 200) throw new Error(`Failed to create group API key: ${groupKey.text}`);
  groupApiKey = groupKey.body.key;
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

  it('does not distinguish an inaccessible provider from an unknown provider', async () => {
    const callsBeforeRequest = axiosPost.mock.calls.length;
    const inaccessible = await request(app)
      .post('/api/chat/stream')
      .set({ ...auth(), 'x-api-key-id': keyId })
      .send({ messages: [{ role: 'user', content: 'hi' }], model: groupProviderModel, provider_id: groupProviderId });
    const unknown = await request(app)
      .post('/api/chat/stream')
      .set({ ...auth(), 'x-api-key-id': keyId })
      .send({ messages: [{ role: 'user', content: 'hi' }], model: groupProviderModel, provider_id: 'provider-id-unknown-private' });

    expect(inaccessible.status).toBe(400);
    expect(inaccessible.body).toEqual(unknown.body);
    expect(inaccessible.body.detail).toBe('Provider not found');
    expect(axiosPost.mock.calls).toHaveLength(callsBeforeRequest);
  });
});

describe('POST /v1/chat/completions', () => {
  it('selects a provider by name and does not forward Fairport-only fields', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
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
        model: apiProviderModel,
        stream: 'client-value',
        provider: apiProviderName,
        top_p: 0.9,
        tools,
      });

    expect(res.status).toBe(200);
    const [forwardedUrl, forwardedBody] = axiosPost.mock.calls[axiosPost.mock.calls.length - 1];
    expect(forwardedUrl).toBe('http://93.184.216.34/v1/chat/completions');
    expect(forwardedBody).toEqual({
      top_p: 0.9,
      tools,
      model: apiProviderModel,
      messages,
      stream: false,
    });
    expect(res.body.model).toBe(apiProviderModel);

    const requestLogs = logSpy.mock.calls
      .map(([entry]) => {
        try { return JSON.parse(entry); } catch { return null; }
      })
      .filter(entry => entry?.target_path === '/v1/chat/completions' && entry?.provider_id === apiProviderId);
    expect(requestLogs).toHaveLength(2);
    expect(requestLogs.every(entry =>
      entry.requested_model === apiProviderModel && entry.model === apiProviderModel
    )).toBe(true);
    expect(requestLogs.some(entry => typeof entry.duration_ms === 'number')).toBe(true);
    expect(requestLogs.some(entry => entry.duration_ms === undefined)).toBe(true);
  });

  it('uses the default provider when no selector is supplied and it supports the model', async () => {
    const messages = [{ role: 'user', content: 'use the default' }];
    axiosPost.mockResolvedValueOnce({
      data: { choices: [{ message: { role: 'assistant', content: 'Hello' } }] },
    });

    const res = await request(app)
      .post('/v1/chat/completions')
      .set({ Authorization: `Bearer ${apiKey}` })
      .send({ messages, model: 'default' });

    expect(res.status).toBe(200);
    const [forwardedUrl, forwardedBody] = axiosPost.mock.calls[axiosPost.mock.calls.length - 1];
    expect(forwardedUrl).toBe('http://localhost:1234/v1/chat/completions');
    expect(forwardedBody.model).toBe('default');
  });

  it('selects another accessible provider by model when no selector is supplied', async () => {
    const messages = [{ role: 'user', content: 'route by model' }];
    axiosPost.mockResolvedValueOnce({
      data: { choices: [{ message: { role: 'assistant', content: 'Hello' } }] },
    });

    const res = await request(app)
      .post('/v1/chat/completions')
      .set({ Authorization: `Bearer ${apiKey}` })
      .send({ messages, model: apiProviderAlternateModel });

    expect(res.status).toBe(200);
    const [forwardedUrl, forwardedBody] = axiosPost.mock.calls[axiosPost.mock.calls.length - 1];
    expect(forwardedUrl).toBe('http://93.184.216.34/v1/chat/completions');
    expect(forwardedBody.model).toBe(apiProviderAlternateModel);
  });

  it('lets another authenticated API key route through a public model offering', async () => {
    axiosPost.mockResolvedValueOnce({
      data: { choices: [{ message: { role: 'assistant', content: 'Hello' } }] },
    });

    const res = await request(app)
      .post('/v1/chat/completions')
      .set({ Authorization: `Bearer ${memberApiKey}` })
      .send({ messages: [{ role: 'user', content: 'use the public model' }], model: apiProviderModel });

    expect(res.status).toBe(200);
    const [forwardedUrl, forwardedBody] = axiosPost.mock.calls[axiosPost.mock.calls.length - 1];
    expect(forwardedUrl).toBe('http://93.184.216.34/v1/chat/completions');
    expect(forwardedBody.model).toBe(apiProviderModel);
  });

  it('keeps group API keys scoped to their group providers', async () => {
    axiosPost.mockResolvedValueOnce({
      data: { choices: [{ message: { role: 'assistant', content: 'Hello' } }] },
    });

    const allowed = await request(app)
      .post('/v1/chat/completions')
      .set({ Authorization: `Bearer ${groupApiKey}` })
      .send({ messages: [{ role: 'user', content: 'hi' }], model: groupProviderModel });

    expect(allowed.status).toBe(200);
    expect(axiosPost.mock.calls[axiosPost.mock.calls.length - 1][0]).toBe('http://93.184.216.34/v1/chat/completions');

    const callsBeforeDenied = axiosPost.mock.calls.length;
    const denied = await request(app)
      .post('/v1/chat/completions')
      .set({ Authorization: `Bearer ${groupApiKey}` })
      .send({
        messages: [{ role: 'user', content: 'hi' }],
        model: apiProviderAlternateModel,
        provider_id: apiProviderId,
      });

    expect(denied.status).toBe(400);
    expect(denied.body.error.code).toBe('model_not_found');
    expect(axiosPost.mock.calls).toHaveLength(callsBeforeDenied);
  });

  it('keeps automatic routing optional but rejects ambiguous provider names', async () => {
    const sharedName = `ambiguous-provider-${Date.now()}`;
    const sharedModel = `ambiguous-model-${Date.now()}`;
    for (const groupId of [null, 'global_admin']) {
      const provider = await request(app)
        .post('/api/providers')
        .set({ Authorization: `Bearer ${apiToken}` })
        .send({
          name: sharedName,
          base_url: 'http://93.184.216.34/v1',
          models: sharedModel,
          rate_limits: '100:request:minute',
          ...(groupId ? { group_id: groupId } : {}),
        });
      expect(provider.status).toBe(200);
    }

    axiosPost.mockResolvedValueOnce({
      data: { choices: [{ message: { role: 'assistant', content: 'Hello' } }] },
    });
    const automatic = await request(app)
      .post('/v1/chat/completions')
      .set({ Authorization: `Bearer ${apiKey}` })
      .send({ messages: [{ role: 'user', content: 'hi' }], model: sharedModel });
    expect(automatic.status).toBe(200);
    expect(automatic.body.model).toBe(sharedModel);

    const callsBeforeNamedRequest = axiosPost.mock.calls.length;
    const byName = await request(app)
      .post('/v1/chat/completions')
      .set({ Authorization: `Bearer ${apiKey}` })
      .send({ messages: [{ role: 'user', content: 'hi' }], model: sharedModel, provider: sharedName });
    expect(byName.status).toBe(400);
    expect(byName.body.error).toEqual(expect.objectContaining({
      message: 'Provider name is ambiguous; use provider_id',
      code: 'ambiguous_provider',
    }));
    expect(axiosPost.mock.calls).toHaveLength(callsBeforeNamedRequest);
  });

  it('returns an OpenAI-shaped provider error when the selected hostname cannot resolve', async () => {
    const dnsProviderName = `dns-provider-${Date.now()}`;
    const dnsProviderModel = `dns-model-${Date.now()}`;
    const lookup = vi.spyOn(dns.promises, 'lookup')
      .mockResolvedValueOnce([{ address: '93.184.216.34', family: 4 }] as any)
      .mockRejectedValueOnce(Object.assign(new Error('getaddrinfo ENOTFOUND'), { code: 'ENOTFOUND' }));
    const provider = await request(app)
      .post('/api/providers')
      .set({ Authorization: `Bearer ${apiToken}` })
      .send({
        name: dnsProviderName,
        base_url: 'http://provider-dns.test/v1',
        models: dnsProviderModel,
        rate_limits: '100:request:minute',
      });
    expect(provider.status).toBe(200);
    expect(lookup).toHaveBeenCalledTimes(1);

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const callsBeforeRequest = axiosPost.mock.calls.length;
    const res = await request(app)
      .post('/v1/chat/completions')
      .set({ Authorization: `Bearer ${apiKey}` })
      .send({
        messages: [{ role: 'user', content: 'hi' }],
        model: dnsProviderModel,
        provider: dnsProviderName,
      });

    expect(res.status).toBe(502);
    expect(res.body.error).toEqual({
      message: 'Invalid base_url: Hostname could not be resolved',
      type: 'provider_error',
      code: 'provider_unavailable',
    });
    expect(axiosPost.mock.calls).toHaveLength(callsBeforeRequest);
    const terminalLog = logSpy.mock.calls
      .map(([entry]) => {
        try { return JSON.parse(entry); } catch { return null; }
      })
      .find(entry => entry?.target_path === '/v1/chat/completions' && entry?.status_code === 502);
    expect(terminalLog).toEqual(expect.objectContaining({
      provider_id: provider.body.id,
      requested_model: dnsProviderModel,
      model: dnsProviderModel,
      error: 'Invalid base_url: Hostname could not be resolved',
    }));
  });

  it('rejects conflicting provider selectors', async () => {
    const callsBeforeRequest = axiosPost.mock.calls.length;
    const res = await request(app)
      .post('/v1/chat/completions')
      .set({ Authorization: `Bearer ${apiKey}` })
      .send({
        messages: [{ role: 'user', content: 'hi' }],
        model: 'default',
        provider: apiProviderName,
        provider_id: 'provider-id-default',
      });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('invalid_provider');
    expect(axiosPost.mock.calls).toHaveLength(callsBeforeRequest);
  });

  it.each([
    ['provider_id', { provider_id: 'provider-id-missing' }],
    ['provider', { provider: 'provider-name-missing' }],
  ])('rejects an explicitly unknown %s instead of using the default', async (_field, selector) => {
    const callsBeforeRequest = axiosPost.mock.calls.length;
    const res = await request(app)
      .post('/v1/chat/completions')
      .set({ Authorization: `Bearer ${apiKey}` })
      .send({
        messages: [{ role: 'user', content: 'hi' }],
        model: 'default',
        ...selector,
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toEqual(expect.objectContaining({
      message: 'Provider not found',
      type: 'invalid_request_error',
      code: 'invalid_provider',
    }));
    expect(axiosPost.mock.calls).toHaveLength(callsBeforeRequest);
  });

  it('does not distinguish an inaccessible provider selector from an unknown one', async () => {
    const callsBeforeRequest = axiosPost.mock.calls.length;
    const body = { messages: [{ role: 'user', content: 'hi' }], model: groupProviderModel };
    const inaccessible = await request(app)
      .post('/v1/chat/completions')
      .set({ Authorization: `Bearer ${memberApiKey}` })
      .send({ ...body, provider_id: groupProviderId });
    const unknown = await request(app)
      .post('/v1/chat/completions')
      .set({ Authorization: `Bearer ${memberApiKey}` })
      .send({ ...body, provider_id: 'provider-id-unknown-private' });

    expect(inaccessible.status).toBe(400);
    expect(inaccessible.body).toEqual(unknown.body);
    expect(inaccessible.body.error).toEqual(expect.objectContaining({
      message: 'Provider not found',
      code: 'invalid_provider',
    }));
    expect(axiosPost.mock.calls).toHaveLength(callsBeforeRequest);
  });
});
