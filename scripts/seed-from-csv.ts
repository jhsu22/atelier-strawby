import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { normalizeCsv, validationSummary, assertImportable } from './lib/normalize.ts';
import { importStatements, persistPlan, ReconciliationRequired } from './lib/import.ts';
import { options, openTarget } from './lib/cli.ts';

const opts = options();
const plan = normalizeCsv(await readFile(opts.input, 'utf8'), opts.input);
const summary = validationSummary(plan);
await mkdir(opts.output, { recursive: true });
const writeJson = (file: string, data: unknown) => writeFile(join(opts.output, file), JSON.stringify(data, null, 2) + '\n');
await writeJson('validation-summary.json', summary);
assertImportable(plan);
await writeJson('normalized-collection.json', plan);
await writeJson('import-statements.json', importStatements(plan));
console.log(`${summary.physicalCopies} manga copies; ${summary.uniqueSeries} series; ${summary.editionRuns} edition runs; ${summary.volumeEditions} volume editions.`);
console.log(JSON.stringify({ languages: summary.volumesPerLanguage, publishers: summary.publisherDistribution, dated: summary.datedCopies, undated: summary.undatedCopies, distinctDates: summary.distinctAcquisitionDates, notes: summary.recordsWithNotes, skipped: summary.skippedSourceRecords.length, issues: summary.issues.map(i => ({ code: i.code, records: i.sourceRecords.length })) }, null, 2));
if (opts.target !== 'artifacts') {
  const db = await openTarget(opts);
  try { console.log(await persistPlan(db, plan)); }
  catch (error) {
    if (error instanceof ReconciliationRequired) await writeJson('reconciliation-required.json', { reason: error.message, candidate: summary, proposedAction: 'Review source changes against existing import provenance before replacing or adding owned copies.' });
    throw error;
  } finally { await db.close(); }
}
