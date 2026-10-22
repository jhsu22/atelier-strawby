import { createServer } from 'node:http';
import { options } from './lib/cli.ts';
import { openSqlite } from './lib/sqlite.ts';
import { collectionSummary } from '../src/server/services/collection-summary.ts';
import { renderDiagnostic } from './lib/diagnostic.ts';

// Dependency-free diagnostic page, not an alternate production backend.
const opts = options('sqlite');
const db = openSqlite(opts.database);
const server = createServer(async (req, res) => {
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (req.url !== '/') { res.writeHead(404); res.end('Not found'); return; }
  try {
    const summary = await collectionSummary(sql => db.all(sql));
    res.end(renderDiagnostic(summary));
  } catch { res.writeHead(503); res.end('Database unavailable; apply offline migrations and seed first.'); }
});
server.on('error', async (error) => { console.error(error.message); await db.close(); process.exitCode = 1; });
server.listen(4322, '127.0.0.1', () => console.log('Offline database diagnostic: http://127.0.0.1:4322'));
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => server.close(async () => { await db.close(); process.exit(0); }));
