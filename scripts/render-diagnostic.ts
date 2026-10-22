import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { options, openTarget } from './lib/cli.ts';
import { collectionSummary } from '../src/server/services/collection-summary.ts';
import { renderDiagnostic } from './lib/diagnostic.ts';
const opts = options('sqlite');
const db = await openTarget(opts);
try {
  const html = renderDiagnostic(await collectionSummary(sql => db.all(sql)));
  await mkdir(opts.output, { recursive: true });
  const path = join(opts.output, 'diagnostic.html');
  await writeFile(path, html); console.log(`Database-backed diagnostic written to ${path}`);
} finally { await db.close(); }
