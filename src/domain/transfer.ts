export type ImportKind = "manga" | "cd" | "discogs" | "json";
export const CSV_IMPORT_BYTES = 900000;
export const BACKUP_IMPORT_BYTES = 8 * 1024 * 1024;
export const IMPORT_REQUEST_BYTES = BACKUP_IMPORT_BYTES * 2 + 10000;
export interface ImportPreviewRow {
  number: number;
  title: string;
  volume: string;
  language: string;
  acquiredOn: string | null;
  duplicate: boolean;
  existingId: boolean;
  errors: string[];
}
export interface ImportPreview {
  token: string;
  kind: ImportKind;
  rows: ImportPreviewRow[];
  total: number;
  duplicates: number;
  errors: number;
  warnings: string[];
  restoredCopies?: number;
}
