import type { DatabaseAdapter, DatabaseType, DbData } from './types';
import { YamlAdapter } from './yaml-adapter';
import { PGliteAdapter } from './pglite-adapter';
import { PostgresAdapter } from './postgres-adapter';

export type { DatabaseAdapter, DatabaseType, DbData };

export function createDatabase(type: DatabaseType, dataDir?: string): DatabaseAdapter {
  switch (type) {
    case 'pglite':
      return new PGliteAdapter(dataDir);
    case 'postgres':
      return new PostgresAdapter();
    case 'yaml':
    default:
      return new YamlAdapter();
  }
}
