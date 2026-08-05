import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import type { DatabaseAdapter, DbData } from './types';

const COLLECTIONS = ['users', 'api_keys', 'roles', 'groups', 'models', 'messages', 'providers', 'model_pricing', 'usage_events'];

export class YamlAdapter implements DatabaseAdapter {
  constructor(private dbFile = path.join(process.cwd(), 'db.yaml')) {}

  async load(): Promise<DbData> {
    if (!fs.existsSync(this.dbFile)) {
      const defaultDb: DbData = {
        users: [], api_keys: [], roles: [], groups: [],
        models: [], messages: [], providers: [], model_pricing: [], usage_events: []
      };
      await this.save(defaultDb);
      return defaultDb;
    }
    try {
      const fileContents = fs.readFileSync(this.dbFile, 'utf8');
      const data: any = yaml.load(fileContents) || {};
      for (const col of COLLECTIONS) {
        if (data[col] === undefined) data[col] = [];
        if (!Array.isArray(data[col])) throw new Error(`${col} must be an array`);
      }
      for (const provider of data.providers) {
        if (provider?.offerings !== undefined && !Array.isArray(provider.offerings)) {
          throw new Error('providers.offerings must be an array');
        }
      }
      return data as DbData;
    } catch (error: any) {
      throw new Error(`Unable to load ${this.dbFile}: ${error.message}`);
    }
  }

  async save(data: DbData): Promise<void> {
    fs.writeFileSync(this.dbFile, yaml.dump(data, { sortKeys: false }));
  }
}
