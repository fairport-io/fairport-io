import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import type { DatabaseAdapter, DbData } from './types';

const DB_FILE = path.join(process.cwd(), 'db.yaml');

const COLLECTIONS = ['users', 'api_keys', 'roles', 'groups', 'models', 'messages', 'providers', 'model_pricing', 'usage_events'];

export class YamlAdapter implements DatabaseAdapter {
  async load(): Promise<DbData> {
    if (!fs.existsSync(DB_FILE)) {
      const defaultDb: DbData = {
        users: [], api_keys: [], roles: [], groups: [],
        models: [], messages: [], providers: [], model_pricing: [], usage_events: []
      };
      await this.save(defaultDb);
      return defaultDb;
    }
    try {
      const fileContents = fs.readFileSync(DB_FILE, 'utf8');
      const data: any = yaml.load(fileContents) || {};
      for (const col of COLLECTIONS) {
        if (!data[col]) data[col] = [];
      }
      return data as DbData;
    } catch {
      return {
        users: [], api_keys: [], roles: [], groups: [],
        models: [], messages: [], providers: [], model_pricing: [], usage_events: []
      };
    }
  }

  async save(data: DbData): Promise<void> {
    fs.writeFileSync(DB_FILE, yaml.dump(data, { sortKeys: false }));
  }
}
