import { sql } from 'drizzle-orm';
import { createDb } from '../db/client.ts';
import { collectionSummary } from '../services/collection-summary.ts';
import { collectionSummarySchema } from '../../domain/schemas.ts';

export function readCollectionSummary(binding: D1Database) {
  const db = createDb(binding);
  return collectionSummary(query => db.all<Record<string, unknown>>(sql.raw(query)))
    .then(summary => collectionSummarySchema.parse(summary));
}
