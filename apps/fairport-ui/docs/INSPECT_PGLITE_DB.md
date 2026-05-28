# Inspect PGlite DB

If you can exec into the container runnig pglite, you can inspect data by running a node module from stdin like this:

```
node --input-type=module - << 'EOF'
import { PGlite } from '@electric-sql/pglite';

const db = new PGlite('./pglite-data');

// 1. List all databases in the cluster
const { rows: dbs } = await db.query('SELECT datname FROM pg_database;');
console.log('--- Databases ---');
console.log(dbs.map(d => d.datname));

// 2. List all user-created tables in the default "public" schema
const { rows: tables } = await db.query(
  "SELECT tablename FROM pg_tables WHERE schemaname = 'public';"
);
console.log('\n--- Tables ---');
console.log(tables.map(t => t.tablename));
EOF
```
