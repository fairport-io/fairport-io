import path from 'path';
import type { DatabaseAdapter, DbData } from './types';

let PGlite: any;

const TABLES = ['users', 'api_keys', 'roles', 'groups', 'models', 'messages', 'providers', 'model_pricing', 'usage_events'];

const SCHEMA: Record<string, string> = {
  users: `CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY, name TEXT NOT NULL,
    password_hash TEXT NOT NULL DEFAULT '', oauth_provider TEXT
  )`,
  api_keys: `CREATE TABLE IF NOT EXISTS api_keys (
    id TEXT PRIMARY KEY, name TEXT NOT NULL,
    owner_id TEXT NOT NULL, group_id TEXT,
    key_prefix TEXT NOT NULL, key_hash TEXT NOT NULL,
    created_at INTEGER NOT NULL, expires_at INTEGER, last_used_at INTEGER
  )`,
  roles: `CREATE TABLE IF NOT EXISTS roles (
    id TEXT PRIMARY KEY, name TEXT NOT NULL,
    permissions TEXT NOT NULL DEFAULT '[]'
  )`,
  groups_table: `CREATE TABLE IF NOT EXISTS groups_table (
    id TEXT PRIMARY KEY, name TEXT NOT NULL,
    api_keys TEXT NOT NULL DEFAULT '[]',
    members TEXT NOT NULL DEFAULT '[]'
  )`,
  models: `CREATE TABLE IF NOT EXISTS models (
    id TEXT PRIMARY KEY, name TEXT NOT NULL,
    base_url TEXT, owner_id TEXT,
    visibility TEXT NOT NULL DEFAULT 'public'
  )`,
  messages: `CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL,
    role TEXT NOT NULL, content TEXT NOT NULL,
    thinking_content TEXT, timestamp INTEGER NOT NULL
  )`,
  providers: `CREATE TABLE IF NOT EXISTS providers (
    id TEXT PRIMARY KEY, name TEXT NOT NULL,
    base_url TEXT NOT NULL, models TEXT NOT NULL DEFAULT 'default',
    api_key TEXT NOT NULL DEFAULT '', owner_id TEXT, group_id TEXT,
    visibility TEXT NOT NULL DEFAULT 'private',
    immutable INTEGER NOT NULL DEFAULT 0
  )`,
  model_pricing: `CREATE TABLE IF NOT EXISTS model_pricing (
    model_id TEXT PRIMARY KEY,
    input_cost_per_1m_tokens REAL NOT NULL DEFAULT 0,
    output_cost_per_1m_tokens REAL NOT NULL DEFAULT 0,
    rate_limits TEXT NOT NULL DEFAULT '',
    queue_max_size INTEGER NOT NULL DEFAULT 5
  )`,
  usage_events: `CREATE TABLE IF NOT EXISTS usage_events (
    id TEXT PRIMARY KEY, api_key_id TEXT NOT NULL,
    model_id TEXT NOT NULL, provider_id TEXT NOT NULL,
    user_id TEXT NOT NULL, group_id TEXT,
    timestamp INTEGER NOT NULL,
    input_tokens INTEGER NOT NULL DEFAULT 0,
    output_tokens INTEGER NOT NULL DEFAULT 0,
    source TEXT NOT NULL DEFAULT 'UI'
  )`,
};

const TABLE_MAP: Record<string, string> = {
  users: 'users', api_keys: 'api_keys', roles: 'roles',
  groups: 'groups_table', models: 'models', messages: 'messages',
  providers: 'providers', model_pricing: 'model_pricing', usage_events: 'usage_events',
};

function toPgValue(val: any): any {
  if (val === null || val === undefined) return null;
  if (typeof val === 'boolean') return val ? 1 : 0;
  if (Array.isArray(val) || (typeof val === 'object' && val.constructor === Object)) return JSON.stringify(val);
  return val;
}

export class PGliteAdapter implements DatabaseAdapter {
  private client: any;
  private dataDir: string;
  private initialized = false;

  constructor(dataDir?: string) {
    this.dataDir = dataDir || path.join(process.cwd(), 'pglite-data');
  }

  async load(): Promise<DbData> {
    await this.ensureClient();
    await this.ensureTables();
    const result: any = {};
    for (const table of TABLES) {
      const sqlTable = TABLE_MAP[table];
      const res = await this.client.query(`SELECT * FROM "${sqlTable}"`);
      const rows = res.rows || res;
      if (table === 'providers') {
        result[table] = rows.map((r: any) => {
          const obj: any = {};
          for (const key of Object.keys(r)) {
            obj[key] = (key === 'immutable') ? (r[key] === 1 || r[key] === true) : r[key];
          }
          return obj;
        });
      } else {
        result[table] = this.parseRows(table, rows);
      }
    }
    return result as DbData;
  }

  async save(data: DbData): Promise<void> {
    await this.ensureClient();
    await this.ensureTables();
    try {
      for (const table of TABLES) {
        const records = (data as any)[table] || [];
        const sqlTable = TABLE_MAP[table];
        await this.client.query(`DELETE FROM "${sqlTable}"`);

        if (records.length === 0) continue;

        const cols = [...new Set(records.flatMap((r: any) => Object.keys(r)))];
        const placeholders = cols.map((_, i) => `$${i + 1}`).join(', ');
        const stmt = `INSERT INTO "${sqlTable}" (${cols.map((c) => `"${c}"`).join(', ')}) VALUES (${placeholders})`;

        for (const record of records) {
          const vals = cols.map((c) => toPgValue(record[c]));
          await this.client.query(stmt, vals);
        }
      }
    } catch (err) {
      throw err;
    }
  }

  private parseRows(table: string, rows: any[]): any[] {
    return rows.map((r: any) => {
      const obj: any = {};
      for (const key of Object.keys(r)) {
        let val = r[key];
        if (typeof val === 'string') {
          if ((key === 'permissions' || key === 'api_keys' || key === 'members') && (val.startsWith('[') || val.startsWith('{'))) {
            try { val = JSON.parse(val); } catch {}
          }
        }
        obj[key] = val;
      }
      return obj;
    });
  }

  private async ensureClient(): Promise<void> {
    if (this.client) return;
    if (!PGlite) {
      PGlite = (await import('@electric-sql/pglite')).PGlite;
    }
    this.client = await PGlite.create({ dataDir: this.dataDir });
  }

  private async ensureTables(): Promise<void> {
    if (this.initialized) return;
    for (const ddl of Object.values(SCHEMA)) {
      await this.client.query(ddl);
    }
    this.initialized = true;
  }

  async close(): Promise<void> {
    if (this.client) {
      await this.client.close();
      this.client = null;
      this.initialized = false;
    }
  }
}
