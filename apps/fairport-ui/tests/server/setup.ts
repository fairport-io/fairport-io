import { beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import path from 'path';

const dbFile = path.join(process.cwd(), 'db.yaml');
const backupFile = path.join(process.cwd(), 'db.yaml.bak');

beforeAll(() => {
  // Backup existing db.yaml and start fresh
  if (fs.existsSync(dbFile)) {
    fs.renameSync(dbFile, backupFile);
  }
});

afterAll(() => {
  // Restore original db.yaml
  if (fs.existsSync(backupFile)) {
    fs.renameSync(backupFile, dbFile);
  } else if (fs.existsSync(dbFile)) {
    fs.unlinkSync(dbFile);
  }
});
