import { afterEach, describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { YamlAdapter } from '../../src/db/yaml-adapter';

const testDirs: string[] = [];

afterEach(() => {
  for (const dir of testDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe('YamlAdapter', () => {
  it('rejects malformed offering data without replacing the source file', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fairport-yaml-'));
    testDirs.push(dir);
    const dbFile = path.join(dir, 'db.yaml');
    const source = 'providers:\n  - id: provider-invalid\n    offerings: {}\n';
    fs.writeFileSync(dbFile, source);
    const adapter = new YamlAdapter(dbFile);

    await expect(adapter.load()).rejects.toThrow('providers.offerings must be an array');
    expect(fs.readFileSync(dbFile, 'utf8')).toBe(source);
  });
});
