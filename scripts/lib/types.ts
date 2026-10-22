import type { SourceRow, Correction } from '../../src/domain/normalization/corrections.ts';
export type Value = string | number | null;
export interface Statement { sql: string; params: Value[] }
export interface Database {
  all<T extends Record<string, unknown> = Record<string, unknown>>(sql: string, params?: Value[]): Promise<T[]>;
  batch(statements: Statement[]): Promise<void>;
  close(): Promise<void>;
}
export interface Issue { code: string; severity: 'warning' | 'error'; sourceRecords: number[]; message: string }
export interface NormalizedCopy {
  itemId: string; sourceRecordNumber: number; source: SourceRow; corrected: SourceRow;
  corrections: Correction[]; canonicalTitle: string; editionTitle: string;
  seriesId: string; creatorId: string; publisherId: string; editionRunId: string; volumeEditionId: string;
  language: 'EN' | 'JP' | 'KR'; languageBasis: 'specified' | 'assumed';
  volumeLabel: string; volumeSort: number; numberingKey: string;
  format: 'standard' | 'collectors' | 'artbook' | 'anthology' | 'unknown';
  numberingBasis: 'printed' | 'source_record'; acquiredOn: string | null; notes: string | null; tags: string[];
}
export interface SeedPlan {
  sourceSha256: string; sourceFilename: string; mappingVersion: string; batchId: string;
  parsedRecords: number; copies: NormalizedCopy[]; skipped: { sourceRecordNumber: number; source: SourceRow; reason: string }[];
  issues: Issue[];
  tables: Record<string, Record<string, Value>[]>;
}
