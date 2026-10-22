import { options } from './lib/cli.ts';
import { openSqlite, migrateSqlite } from './lib/sqlite.ts';
const opts = options('sqlite');
if (opts.target !== 'sqlite') throw new Error('Use db:migrate:local for D1.');
const db = openSqlite(opts.database);
try { await migrateSqlite(db); console.log(`Applied offline SQLite migrations: ${opts.database}`); }
finally { await db.close(); }
