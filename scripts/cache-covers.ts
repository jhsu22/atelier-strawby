import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { assertPrivatePath } from './lib/cli.ts';
import { openLocalPlatform } from './lib/d1.ts';
import { cacheMissingCovers } from '../src/server/metadata/cover-utility.ts';

// Resumable local artwork enrichment. Rerun after interruption or rate limiting;
// completed series matches, applied covers and provider responses are reused.
const { values } = parseArgs({ options: {
  'dry-run': { type: 'boolean', default: false },
  retry: { type: 'boolean', default: false },
  limit: { type: 'string' },
  persist: { type: 'string', default: '.wrangler/state/v3' },
  report: { type: 'string', default: 'data/generated/cover-cache-report.json' },
} });
const limit = values.limit === undefined ? undefined : Number(values.limit);
if (limit !== undefined && (!Number.isInteger(limit) || limit < 1)) throw new Error('--limit must be a positive whole number of series.');
const reportPath = resolve(values.report!);
assertPrivatePath(reportPath);
const { db, bucket, contact } = await openLocalPlatform(values.persist);
try {
  const report = await cacheMissingCovers(db, {
    bucket, contact, retry: values.retry, dryRun: values['dry-run'],
    ...(limit === undefined ? {} : { seriesLimit: limit }),
    onOutcome: o => console.log(`${o.outcome.padEnd(15)} ${o.title}${o.volume ? ` vol ${o.volume}` : ''}${o.language ? ` (${o.language})` : ''}: ${o.reason}`),
  });
  await mkdir(dirname(reportPath), { recursive: true });
  await writeFile(reportPath, JSON.stringify({ generatedAt: new Date().toISOString(), ...report }, null, 2) + '\n');
  console.log(JSON.stringify(report.totals, null, 2));
  console.log(`Report: ${reportPath}${report.dryRun ? ' (dry run; collection unchanged)' : ''}`);
  if (report.totals.deferred || report.totals.failed) console.log('Some work was deferred or failed. Rerun later to resume; completed work is not repeated.');
} finally { await db.close(); }
