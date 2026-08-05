import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-jwt-secret';
process.env.SECRET_KEY = 'test-secret-key';
process.env.PORT = '0';

let app: any;
let ensureDefaults: (db: any) => Promise<void>;
let ownerToken: string;
let ownerApiKey: string;
let ownerKeyId: string;
let otherToken: string;
let otherApiKey: string;
let alphaProviderId: string;
let alphaProviderName: string;
let zetaProviderId: string;
let zetaProviderName: string;
let otherProviderId: string;
let duplicateModel: string;
let alphaPrivateModel: string;
let alphaPublicModel: string;
let zetaPrivateModel: string;
let otherPublicModel: string;
let alphaPublicOfferingId: string;
let otherPublicOfferingId: string;
let defaultProviderName: string;
let defaultModelIds: string[];

const uniquePrefix = `models-${Date.now()}-${Math.random().toString(16).slice(2)}`;
const jwtAuth = (token: string) => ({ Authorization: `Bearer ${token}` });
const apiKeyAuth = (key: string) => ({ Authorization: `Bearer ${key}` });

function offeringId(provider: any, modelId: string): string {
  const offering = provider.offerings?.find((candidate: any) => candidate.model_id === modelId);
  if (!offering?.id) throw new Error(`Missing offering for ${modelId}`);
  return offering.id;
}

beforeAll(async () => {
  const mod = await import('../../server');
  app = mod.app;
  ensureDefaults = mod.ensureDefaults;

  const owner = await request(app)
    .post('/api/auth/signup')
    .send({ username: `${uniquePrefix}-owner@example.com`, password: 'password123' });
  if (owner.status !== 200) throw new Error(`Failed to create catalog owner: ${owner.text}`);
  ownerToken = owner.body.token;
  ownerApiKey = owner.body.api_key;
  const ownerKeys = await request(app)
    .get('/api/keys')
    .set(jwtAuth(ownerToken));
  ownerKeyId = ownerKeys.body[0].id;

  const other = await request(app)
    .post('/api/auth/signup')
    .send({ username: `${uniquePrefix}-other@example.com`, password: 'password123' });
  if (other.status !== 200) throw new Error(`Failed to create second catalog user: ${other.text}`);
  otherToken = other.body.token;
  otherApiKey = other.body.api_key;

  duplicateModel = `${uniquePrefix}-shared`;
  alphaPrivateModel = `${uniquePrefix}-alpha-private`;
  alphaPublicModel = `${uniquePrefix}-alpha-public`;
  zetaPrivateModel = `${uniquePrefix}-zeta-private`;
  otherPublicModel = `${uniquePrefix}-other-public`;
  alphaProviderName = `${uniquePrefix}-alpha-provider`;
  zetaProviderName = `${uniquePrefix}-zeta-provider`;

  const alphaProvider = await request(app)
    .post('/api/providers')
    .set(jwtAuth(ownerToken))
    .send({
      name: alphaProviderName,
      base_url: 'http://93.184.216.34/v1',
      models: `${duplicateModel},${alphaPrivateModel},${alphaPublicModel}`,
      rate_limits: '100:request:minute',
    });
  if (alphaProvider.status !== 200) throw new Error(`Failed to create alpha provider: ${alphaProvider.text}`);
  alphaProviderId = alphaProvider.body.id;
  alphaPublicOfferingId = offeringId(alphaProvider.body, alphaPublicModel);

  const zetaProvider = await request(app)
    .post('/api/providers')
    .set(jwtAuth(ownerToken))
    .send({
      name: zetaProviderName,
      base_url: 'http://93.184.216.34/v1',
      models: `${duplicateModel},${zetaPrivateModel}`,
      rate_limits: '100:request:minute',
    });
  if (zetaProvider.status !== 200) throw new Error(`Failed to create zeta provider: ${zetaProvider.text}`);
  zetaProviderId = zetaProvider.body.id;

  const otherProvider = await request(app)
    .post('/api/providers')
    .set(jwtAuth(otherToken))
    .send({
      name: `${uniquePrefix}-other-provider`,
      base_url: 'http://93.184.216.34/v1',
      models: otherPublicModel,
      rate_limits: '100:request:minute',
    });
  if (otherProvider.status !== 200) throw new Error(`Failed to create other provider: ${otherProvider.text}`);
  otherProviderId = otherProvider.body.id;
  otherPublicOfferingId = offeringId(otherProvider.body, otherPublicModel);

  for (const [token, id] of [
    [ownerToken, alphaPublicOfferingId],
    [otherToken, otherPublicOfferingId],
  ]) {
    const published = await request(app)
      .patch(`/api/models/${id}`)
      .set(jwtAuth(token))
      .send({ visibility: 'public' });
    if (published.status !== 200) throw new Error(`Failed to publish model offering: ${published.text}`);
  }

  const providers = await request(app)
    .get('/api/providers')
    .set(jwtAuth(ownerToken));
  if (providers.status !== 200 || !Array.isArray(providers.body)) {
    throw new Error(`Failed to load providers: ${providers.text}`);
  }
  const defaultProvider = providers.body.find((provider: any) => provider.immutable === true);
  if (!defaultProvider) throw new Error('Default provider was not returned');
  defaultProviderName = defaultProvider.name;
  defaultModelIds = defaultProvider.models.split(',').map((model: string) => model.trim()).filter(Boolean);
});

describe('GET /v1/models', () => {
  it('returns only default-provider models for an anonymous unfiltered request', async () => {
    const res = await request(app).get('/v1/models');

    expect(res.status).toBe(200);
    expect(res.body.object).toBe('list');
    expect(res.body.data.map((model: any) => model.id).sort()).toEqual([...defaultModelIds].sort());
    expect(res.body.data.every((model: any) => model.owned_by === defaultProviderName)).toBe(true);
    expect(res.body.data.some((model: any) => model.id === alphaPublicModel)).toBe(false);
    expect(res.body.data.some((model: any) => model.id === otherPublicModel)).toBe(false);
  });

  it('returns only public offerings for an anonymous provider-filtered request', async () => {
    const res = await request(app)
      .get('/v1/models')
      .query({ provider: alphaProviderName });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      object: 'list',
      data: [expect.objectContaining({
        id: alphaPublicModel,
        object: 'model',
        owned_by: alphaProviderName,
      })],
    });
  });

  it('returns all usable offerings for an authenticated unfiltered request', async () => {
    const res = await request(app)
      .get('/v1/models')
      .set(apiKeyAuth(ownerApiKey));

    expect(res.status).toBe(200);
    const ids = res.body.data.map((model: any) => model.id);
    expect(ids).toEqual(expect.arrayContaining([
      ...defaultModelIds,
      duplicateModel,
      alphaPrivateModel,
      alphaPublicModel,
      zetaPrivateModel,
      otherPublicModel,
    ]));
    expect(ids.filter((id: string) => id === duplicateModel)).toHaveLength(1);
  });

  it('returns private usable offerings for an authenticated provider-filtered request', async () => {
    const res = await request(app)
      .get('/v1/models')
      .set(apiKeyAuth(ownerApiKey))
      .query({ provider_id: zetaProviderId });

    expect(res.status).toBe(200);
    expect(res.body.data.map((model: any) => model.id).sort()).toEqual([
      duplicateModel,
      zetaPrivateModel,
    ].sort());
    expect(res.body.data.every((model: any) => model.owned_by === zetaProviderName)).toBe(true);
  });

  it('rejects invalid credentials instead of falling back to the anonymous catalog', async () => {
    const res = await request(app)
      .get('/v1/models')
      .set({ Authorization: 'Bearer sk-invalid-model-catalog-key' });

    expect(res.status).toBe(401);
    expect(res.body).toEqual({
      error: {
        message: 'Invalid authentication credentials',
        type: 'authentication_error',
        param: null,
        code: 'invalid_api_key',
      },
    });
  });

  it('deduplicates shared model IDs using the deterministic chat provider order', async () => {
    const list = await request(app)
      .get('/v1/models')
      .set(apiKeyAuth(ownerApiKey));
    const matches = list.body.data.filter((model: any) => model.id === duplicateModel);

    const retrieve = await request(app)
      .get(`/v1/models/${encodeURIComponent(duplicateModel)}`)
      .set(apiKeyAuth(ownerApiKey));

    expect(matches).toHaveLength(1);
    expect(matches[0].owned_by).toBe(alphaProviderName);
    expect(retrieve.status).toBe(200);
    expect(retrieve.body).toEqual(matches[0]);
  });

  it('does not disclose a provider whose offerings are all private', async () => {
    const privateProvider = await request(app)
      .get('/v1/models')
      .query({ provider_id: zetaProviderId });
    const missingProvider = await request(app)
      .get('/v1/models')
      .query({ provider_id: `${uniquePrefix}-missing-provider` });
    const privateModel = await request(app)
      .get(`/v1/models/${encodeURIComponent(zetaPrivateModel)}`);

    expect(privateProvider.status).toBe(404);
    expect(privateProvider.body).toEqual(missingProvider.body);
    expect(privateModel.status).toBe(404);
    expect(privateModel.body.error.code).toBe('model_not_found');
  });

  it('reflects an authorized public/private visibility toggle in the anonymous catalog', async () => {
    const privatized = await request(app)
      .patch(`/api/models/${alphaPublicOfferingId}`)
      .set(jwtAuth(ownerToken))
      .send({ visibility: 'private' });
    const hidden = await request(app)
      .get('/v1/models')
      .query({ provider_id: alphaProviderId });
    const restored = await request(app)
      .patch(`/api/models/${alphaPublicOfferingId}`)
      .set(jwtAuth(ownerToken))
      .send({ visibility: 'public' });
    const visible = await request(app)
      .get('/v1/models')
      .query({ provider_id: alphaProviderId });

    expect(privatized.status).toBe(200);
    expect(privatized.body.visibility).toBe('private');
    expect(hidden.status).toBe(404);
    expect(restored.status).toBe(200);
    expect(restored.body.visibility).toBe('public');
    expect(visible.status).toBe(200);
    expect(visible.body.data.map((model: any) => model.id)).toEqual([alphaPublicModel]);
  });
});

describe('GET and PATCH /api/models', () => {
  it('paginates model offerings and applies provider, search, and visibility filters', async () => {
    const firstPage = await request(app)
      .get('/api/models')
      .set(jwtAuth(ownerToken))
      .query({ limit: '2' });

    expect(firstPage.status).toBe(200);
    expect(firstPage.body.object).toBe('list');
    expect(firstPage.body.data).toHaveLength(2);
    expect(firstPage.body.has_more).toBe(true);
    expect(typeof firstPage.body.next_cursor).toBe('string');

    const secondPage = await request(app)
      .get('/api/models')
      .set(jwtAuth(ownerToken))
      .query({ limit: '2', after: firstPage.body.next_cursor });

    expect(secondPage.status).toBe(200);
    const firstIds = new Set(firstPage.body.data.map((offering: any) => offering.id));
    expect(secondPage.body.data.every((offering: any) => !firstIds.has(offering.id))).toBe(true);

    const byProvider = await request(app)
      .get('/api/models')
      .set(jwtAuth(ownerToken))
      .query({ provider_id: alphaProviderId, limit: '100' });
    expect(byProvider.status).toBe(200);
    expect(byProvider.body.data.map((offering: any) => offering.model_id).sort()).toEqual([
      duplicateModel,
      alphaPrivateModel,
      alphaPublicModel,
    ].sort());
    expect(byProvider.body.data.every((offering: any) => offering.provider_id === alphaProviderId)).toBe(true);

    const bySearch = await request(app)
      .get('/api/models')
      .set(jwtAuth(ownerToken))
      .query({ q: alphaPrivateModel, limit: '100' });
    expect(bySearch.status).toBe(200);
    expect(bySearch.body.data.map((offering: any) => offering.model_id)).toEqual([alphaPrivateModel]);

    const publicOnly = await request(app)
      .get('/api/models')
      .set(jwtAuth(ownerToken))
      .query({ visibility: 'public', limit: '100' });
    expect(publicOnly.status).toBe(200);
    expect(publicOnly.body.data.length).toBeGreaterThan(0);
    expect(publicOnly.body.data.every((offering: any) => offering.visibility === 'public')).toBe(true);
  });

  it('allows only JWT-authenticated offering managers to change visibility', async () => {
    const ownerRows = await request(app)
      .get('/api/models')
      .set(jwtAuth(ownerToken))
      .query({ provider_id: otherProviderId, limit: '100' });
    const otherPublicRow = ownerRows.body.data.find((offering: any) => offering.id === otherPublicOfferingId);

    const nonOwner = await request(app)
      .patch(`/api/models/${otherPublicOfferingId}`)
      .set(jwtAuth(ownerToken))
      .send({ visibility: 'private' });
    const apiKeyOnly = await request(app)
      .patch(`/api/models/${alphaPublicOfferingId}`)
      .set(apiKeyAuth(ownerApiKey))
      .send({ visibility: 'private' });
    const owner = await request(app)
      .patch(`/api/models/${otherPublicOfferingId}`)
      .set(jwtAuth(otherToken))
      .send({ visibility: 'private' });
    const restored = await request(app)
      .patch(`/api/models/${otherPublicOfferingId}`)
      .set(jwtAuth(otherToken))
      .send({ visibility: 'public' });

    expect(ownerRows.status).toBe(200);
    expect(otherPublicRow).toEqual(expect.objectContaining({
      model_id: otherPublicModel,
      visibility: 'public',
      can_update_visibility: false,
    }));
    expect(nonOwner.status).toBe(403);
    expect(apiKeyOnly.status).toBe(401);
    expect(owner.status).toBe(200);
    expect(owner.body.visibility).toBe('private');
    expect(restored.status).toBe(200);
    expect(restored.body.visibility).toBe('public');
  });

  it('does not expose private offerings owned by another user', async () => {
    const ownerView = await request(app)
      .get('/api/models')
      .set(jwtAuth(ownerToken))
      .query({ limit: '100' });
    const otherView = await request(app)
      .get('/api/models')
      .set(jwtAuth(otherToken))
      .query({ limit: '100' });

    expect(ownerView.status).toBe(200);
    expect(ownerView.body.data.some((offering: any) => offering.model_id === zetaPrivateModel)).toBe(true);
    expect(otherView.status).toBe(200);
    expect(otherView.body.data.some((offering: any) => offering.model_id === zetaPrivateModel)).toBe(false);
    expect(otherView.body.data.some((offering: any) => offering.model_id === alphaPublicModel)).toBe(true);
  });

  it('lists every offering usable by the API key selected in the Chat UI', async () => {
    const selectedKeyView = await request(app)
      .get('/api/models')
      .set({ ...jwtAuth(ownerToken), 'x-api-key-id': ownerKeyId })
      .query({ usable: 'true', limit: '100' });
    const noSelectedKey = await request(app)
      .get('/api/models')
      .set(jwtAuth(ownerToken))
      .query({ usable: 'true', limit: '100' });

    expect(selectedKeyView.status).toBe(200);
    expect(selectedKeyView.body.data.map((offering: any) => offering.model_id)).toEqual(expect.arrayContaining([
      alphaPrivateModel,
      alphaPublicModel,
      zetaPrivateModel,
      otherPublicModel,
    ]));
    expect(noSelectedKey.status).toBe(200);
    expect(noSelectedKey.body.data).toEqual([]);
  });

  it('requires JWT management authentication', async () => {
    const anonymous = await request(app).get('/api/models');
    const apiKey = await request(app)
      .get('/api/models')
      .set(apiKeyAuth(otherApiKey));

    expect(anonymous.status).toBe(401);
    expect(apiKey.status).toBe(401);
  });

  it('keeps stored offerings authoritative when the legacy model projection drifts', async () => {
    const db: any = {
      users: [],
      api_keys: [],
      roles: [],
      groups: [],
      models: [],
      messages: [],
      providers: [{
        id: 'provider-id-existing-default',
        name: 'default',
        base_url: 'http://localhost:1234/v1',
        models: 'default',
        models_path: 'models',
        api_key: '',
        owner_id: null,
        group_id: null,
        visibility: 'public',
        immutable: true,
        allow_private: true,
      }, {
        id: 'provider-id-drifted-projection',
        name: 'drifted',
        base_url: 'https://example.com/v1',
        models: 'disabled-model',
        models_path: 'models',
        api_key: '',
        owner_id: 'user-id-owner',
        group_id: null,
        visibility: 'private',
        immutable: false,
        allow_private: false,
        offerings: [{
          id: 'offering-id-disabled',
          model_id: 'disabled-model',
          visibility: 'public',
          source: 'discovered',
          enabled: false,
          created_at: 1,
          last_seen_at: 2,
          input_cost_per_1m_tokens: 0,
          output_cost_per_1m_tokens: 0,
          rate_limits: '10:request:minute',
          queue_max_size: 5,
        }],
      }],
      model_pricing: [],
      usage_events: [],
    };

    await ensureDefaults(db);

    const provider = db.providers.find((candidate: any) => candidate.id === 'provider-id-drifted-projection');
    expect(provider.models).toBe('');
    expect(provider.offerings).toEqual([expect.objectContaining({
      id: 'offering-id-disabled',
      model_id: 'disabled-model',
      visibility: 'public',
      source: 'discovered',
      enabled: false,
      created_at: 1,
      last_seen_at: 2,
    })]);
  });
});
