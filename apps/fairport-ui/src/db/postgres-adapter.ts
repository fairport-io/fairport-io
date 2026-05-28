import type { DatabaseAdapter, DbData } from './types';

let pgModule: any;

const TABLES = ['users', 'api_keys', 'roles', 'groups', 'models', 'messages', 'providers', 'model_pricing', 'usage_events'];

const SCHEMA: Record<string, string> = {
  users: `CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    password_hash TEXT NOT NULL DEFAULT '',
    oauth_provider TEXT
  )`,
  api_keys: `CREATE TABLE IF NOT EXISTS api_keys (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    owner_id TEXT NOT NULL,
    group_id TEXT,
    key_prefix TEXT NOT NULL,
    key_hash TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    expires_at INTEGER,
    last_used_at INTEGER
  )`,
  roles: `CREATE TABLE IF NOT EXISTS roles (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    permissions JSONB NOT NULL DEFAULT '[]'::jsonb
  )`,
  groups: `CREATE TABLE IF NOT EXISTS groups_table (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    api_keys JSONB NOT NULL DEFAULT '[]'::jsonb,
    members JSONB NOT NULL DEFAULT '[]'::jsonb
  )`,
  models: `CREATE TABLE IF NOT EXISTS models (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    base_url TEXT,
    owner_id TEXT,
    visibility TEXT NOT NULL DEFAULT 'public'
  )`,
  messages: `CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    thinking_content TEXT,
    timestamp INTEGER NOT NULL
  )`,
  providers: `CREATE TABLE IF NOT EXISTS providers (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    base_url TEXT NOT NULL,
    models TEXT NOT NULL DEFAULT 'default',
    api_key TEXT NOT NULL DEFAULT '',
    owner_id TEXT,
    group_id TEXT,
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
    id TEXT PRIMARY KEY,
    api_key_id TEXT NOT NULL,
    model_id TEXT NOT NULL,
    provider_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    group_id TEXT,
    timestamp INTEGER NOT NULL,
    input_tokens INTEGER NOT NULL DEFAULT 0,
    output_tokens INTEGER NOT NULL DEFAULT 0,
    source TEXT NOT NULL DEFAULT 'UI'
  )`,
};

const TABLE_MAP: Record<string, string> = {
  users: 'users',
  api_keys: 'api_keys',
  roles: 'roles',
  groups: 'groups_table',
  models: 'models',
  messages: 'messages',
  providers: 'providers',
  model_pricing: 'model_pricing',
  usage_events: 'usage_events',
};

function toPgValue(val: any): any {
  if (val === null || val === undefined) return null;
  if (typeof val === 'boolean') return val ? 1 : 0;
  if (Array.isArray(val) || typeof val === 'object') return JSON.stringify(val);
  return val;
}

function fromPgValue(table: string, col: string, val: any): any {
  if (val === null || val === undefined) return null;
  if (table === 'providers' && col === 'immutable') return val === 1 || val === true;
  return val;
}

export class PostgresAdapter implements DatabaseAdapter {
  private pool: any;
  private connected = false;

  constructor() {
    // defer connection to first load/save call
  }

  async load(): Promise<DbData> {
    const client = await this.getClient();
    const result: any = {};
    for (const table of TABLES) {
      const sqlTable = TABLE_MAP[table];
      const res = await client.query(`SELECT * FROM "${sqlTable}"`);
      if (table === 'providers') {
        result[table] = res.rows.map((r: any) => {
          const obj: any = {};
          for (const key of Object.keys(r)) {
            obj[key] = fromPgValue('providers', key, r[key]);
          }
          return obj;
        });
      } else {
        result[table] = res.rows.map((r: any) => this.fromRow(table, r));
      }
    }
    client.release();
    return result as DbData;
  }

  async save(data: DbData): Promise<void> {
    const client = await this.getClient();
    try {
      await client.query('BEGIN');
      for (const table of TABLES) {
        const records = (data as any)[table] || [];
        const sqlTable = TABLE_MAP[table];
        await client.query(`DELETE FROM "${sqlTable}"`);

        if (records.length === 0) continue;

        const cols = [...new Set(records.flatMap((r: any) => Object.keys(r)))];
        const paramIndexes = cols.map((_, i) => `$${i + 1}`).join(', ');
        const stmt = `INSERT INTO "${sqlTable}" (${cols.map((c) => `"${c}"`).join(', ')}) VALUES (${paramIndexes})`;

        for (const record of records) {
          const vals = cols.map((c) => toPgValue(record[c]));
          await client.query(stmt, vals);
        }
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async close(): Promise<void> {
    if (this.pool) {
      await this.pool.end();
      this.pool = null;
      this.connected = false;
    }
  }

  private fromRow(table: string, row: any): any {
    if (!row) return row;
    if (table === 'roles' && row.permissions && typeof row.permissions === 'string') {
      try { row.permissions = JSON.parse(row.permissions); } catch {}
    }
    if (table === 'groups') {
      if (row.api_keys && typeof row.api_keys === 'string') {
        try { row.api_keys = JSON.parse(row.api_keys); } catch {}
      }
      if (row.members && typeof row.members === 'string') {
        try { row.members = JSON.parse(row.members); } catch {}
      }
    }
    return row;
  }

  private async getClient(): Promise<any> {
    if (!this.connected) {
      await this.connect();
    }
    return this.pool.connect();
  }

  private async connect(): Promise<void> {
    if (!pgModule) {
      pgModule = await import('pg');
    }
    const { Pool } = pgModule.default || pgModule;

    const pgHost = process.env.PGHOST;
    const pgPort = parseInt(process.env.PGPORT || '5432', 10);
    const pgDatabase = process.env.PGDATABASE || 'fairport-ui';
    const pgUser = process.env.PGUSER;
    const pgPassword = process.env.PGPASSWORD;

    if (!pgHost || !pgUser || !pgPassword) {
      throw new Error('PGHOST, PGUSER, and PGPASSWORD are required when DATABASE_TYPE=postgres');
    }

    // First, ensure the database exists by connecting to the default 'postgres' db
    const adminPool = new Pool({
      host: pgHost,
      port: pgPort,
      database: 'postgres',
      user: pgUser,
      password: pgPassword,
      max: 1,
      connectionTimeoutMillis: 5000,
    });

    try {
      const dbExists = await adminPool.query(
        `SELECT 1 FROM pg_database WHERE datname = $1`,
        [pgDatabase]
      );
      if (dbExists.rows.length === 0) {
        await adminPool.query(`CREATE DATABASE "${pgDatabase}"`);
      }
    } finally {
      await adminPool.end();
    }

    // Connect to the target database
    this.pool = new Pool({
      host: pgHost,
      port: pgPort,
      database: pgDatabase,
      user: pgUser,
      password: pgPassword,
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    });

    // Create tables
    const client = await this.pool.connect();
    try {
      for (const ddl of Object.values(SCHEMA)) {
        await client.query(ddl);
      }
    } finally {
      client.release();
    }

    this.connected = true;
  }
}
