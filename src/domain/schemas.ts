import { z } from 'zod';
import type { CollectionSummary } from './types.ts';
const count = z.number().int().nonnegative();
const distribution = z.array(z.object({ label: z.string(), count }));
export const collectionSummarySchema: z.ZodType<CollectionSummary> = z.object({
  physicalCopies: count, uniqueSeries: count, datedCopies: count, undatedCopies: count,
  distinctAcquisitionDates: count, recordsWithNotes: count,
  languages: distribution, publishers: distribution, years: distribution,
  personalCds: count,
});
