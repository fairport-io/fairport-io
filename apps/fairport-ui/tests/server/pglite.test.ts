import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PGliteAdapter } from '../../src/db/pglite-adapter';
import type { DbData } from '../../src/db/types';
import * as fs from 'fs';
import * as path from 'path';

const TEST_DIR = path.join(process.cwd(), 'pglite-test-' + Date.now());

describe('PGliteAdapter', () => {
  let adapter: PGliteAdapter;

  beforeAll(async () => {
    if (!fs.existsSync(TEST_DIR)) {
      fs.mkdirSync(TEST_DIR, { recursive: true });
    }
    adapter = new PGliteAdapter(TEST_DIR);
  });

  afterAll(async () => {
    if (adapter) {
      await adapter.close();
    }
    if (fs.existsSync(TEST_DIR)) {
      fs.rmSync(TEST_DIR, { recursive: true, force: true });
    }
  });

  it('loads an empty database', async () => {
    const data = await adapter.load();
    expect(data.users).toEqual([]);
    expect(data.api_keys).toEqual([]);
    expect(data.roles).toEqual([]);
    expect(data.groups).toEqual([]);
    expect(data.models).toEqual([]);
    expect(data.messages).toEqual([]);
    expect(data.providers).toEqual([]);
    expect(data.model_pricing).toEqual([]);
    expect(data.usage_events).toEqual([]);
  });

  it('saves and loads data', async () => {
    const testData: DbData = {
      users: [
        { id: 'user-id-1', name: 'test@example.com', password_hash: 'hash1' },
        { id: 'user-id-2', name: 'alice@example.com', password_hash: 'hash2', oauth_provider: 'google' },
      ],
      api_keys: [
        { id: 'key-id-1', name: 'default', owner_id: 'user-id-1', group_id: null, key_prefix: 'sk-abc', key_hash: 'hash', created_at: 1000, expires_at: 2000, last_used_at: null },
      ],
      roles: [
        { id: 'role-id-1', name: 'Admin', permissions: [{ verbs: ['*'], resources: ['*'], resource_names_regex: ['.*'] }] },
      ],
      groups: [
        { id: 'group-id-1', name: 'admins', api_keys: [], members: [{ ids: ['*'], role_ids: ['role-id-1'] }] },
      ],
      models: [
        { id: 'model-id-1', name: 'gpt-4', base_url: 'http://localhost', owner_id: null, visibility: 'public' },
      ],
      messages: [],
      providers: [
        { id: 'prov-id-1', name: 'openai', base_url: 'https://api.openai.com/v1', models: 'gpt-4', api_key: 'sk-xxx', owner_id: 'user-id-1', group_id: null, visibility: 'public', immutable: false },
      ],
      model_pricing: [
        { model_id: 'gpt-4', input_cost_per_1m_tokens: 10, output_cost_per_1m_tokens: 30, rate_limits: '10:request:minute', queue_max_size: 5 },
      ],
      usage_events: [
        { id: 'usage-id-1', api_key_id: 'key-id-1', model_id: 'gpt-4', provider_id: 'prov-id-1', user_id: 'user-id-1', group_id: null, timestamp: 1000, input_tokens: 10, output_tokens: 20, source: 'UI' },
      ],
    };

    await adapter.save(testData);
    const loaded = await adapter.load();

    // Check individual fields to avoid strict object equality issues with null/undefined
    expect(loaded.users).toHaveLength(2);
    expect(loaded.users[0].id).toBe('user-id-1');
    expect(loaded.users[0].name).toBe('test@example.com');
    expect(loaded.users[0].password_hash).toBe('hash1');
    expect(loaded.users[1].id).toBe('user-id-2');
    expect(loaded.users[1].name).toBe('alice@example.com');
    expect(loaded.users[1].password_hash).toBe('hash2');
    expect(loaded.users[1].oauth_provider).toBe('google');

    expect(loaded.api_keys).toHaveLength(1);
    expect(loaded.api_keys[0].id).toBe('key-id-1');
    expect(loaded.api_keys[0].group_id).toBeNull();
    expect(loaded.api_keys[0].created_at).toBe(1000);
    expect(loaded.api_keys[0].expires_at).toBe(2000);

    expect(loaded.roles).toHaveLength(1);
    expect(loaded.roles[0].permissions).toEqual([{ verbs: ['*'], resources: ['*'], resource_names_regex: ['.*'] }]);

    expect(loaded.groups).toHaveLength(1);
    expect(loaded.groups[0].members).toEqual([{ ids: ['*'], role_ids: ['role-id-1'] }]);

    expect(loaded.providers).toHaveLength(1);
    expect(loaded.providers[0].immutable).toBe(false);

    expect(loaded.model_pricing).toHaveLength(1);
    expect(loaded.model_pricing[0].input_cost_per_1m_tokens).toBe(10);

    expect(loaded.usage_events).toHaveLength(1);
    expect(loaded.usage_events[0].source).toBe('UI');
  });

  it('overwrites data on subsequent saves', async () => {
    const initial: DbData = {
      users: [{ id: 'user-id-1', name: 'initial@example.com', password_hash: 'hash' }],
      api_keys: [],
      roles: [],
      groups: [],
      models: [],
      messages: [],
      providers: [],
      model_pricing: [],
      usage_events: [],
    };

    await adapter.save(initial);
    const updated = { ...initial, users: [{ id: 'user-id-2', name: 'updated@example.com', password_hash: 'hash' }] };
    await adapter.save(updated);
    const loaded = await adapter.load();

    expect(loaded.users).toHaveLength(1);
    expect(loaded.users[0].name).toBe('updated@example.com');
  });

  it('handles immutable provider field correctly', async () => {
    const data: DbData = {
      users: [],
      api_keys: [],
      roles: [],
      groups: [],
      models: [],
      messages: [],
      providers: [
        { id: 'prov-immutable', name: 'default', base_url: 'http://localhost', models: 'default', api_key: '', owner_id: null, group_id: null, visibility: 'public', immutable: true },
        { id: 'prov-normal', name: 'custom', base_url: 'http://localhost', models: 'default', api_key: 'sk-key', owner_id: 'user-id-1', group_id: null, visibility: 'private', immutable: false },
      ],
      model_pricing: [],
      usage_events: [],
    };

    await adapter.save(data);
    const loaded = await adapter.load();

    expect(loaded.providers[0].immutable).toBe(true);
    expect(loaded.providers[1].immutable).toBe(false);
  });
});
