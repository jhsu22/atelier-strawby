import { SUMMARY_QUERIES } from '../repositories/summary-queries.ts';
import type { CollectionSummary } from '../../domain/types.ts';

type Row = Record<string, unknown>;
export type ReadRows = (sql: string) => Promise<Row[]>;
function count(row: Row | undefined, key: string): number {
  const value = row?.[key];
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new Error(`Invalid database count: ${key}`);
  return value;
}
function distribution(rows: Row[]) {
  return rows.map(row => {
    if (typeof row.label !== 'string') throw new Error('Invalid database label');
    return { label: row.label, count: count(row, 'count') };
  });
}
export async function collectionSummary(read: ReadRows): Promise<CollectionSummary> {
  const [totals, languages, publishers, years, cds, sampleCds] = await Promise.all([
    read(SUMMARY_QUERIES.counts), read(SUMMARY_QUERIES.languages), read(SUMMARY_QUERIES.publishers),
    read(SUMMARY_QUERIES.years), read(SUMMARY_QUERIES.cds), read(SUMMARY_QUERIES.sampleCds),
  ]);
  return {
    physicalCopies: count(totals[0], 'physicalCopies'), uniqueSeries: count(totals[0], 'uniqueSeries'),
    datedCopies: count(totals[0], 'datedCopies'), undatedCopies: count(totals[0], 'undatedCopies'),
    distinctAcquisitionDates: count(totals[0], 'distinctAcquisitionDates'), recordsWithNotes: count(totals[0], 'recordsWithNotes'),
    languages: distribution(languages), publishers: distribution(publishers), years: distribution(years),
    personalCds: count(cds[0], 'count'), sampleCds: count(sampleCds[0], 'count'),
  };
}
