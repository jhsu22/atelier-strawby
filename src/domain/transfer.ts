export type ImportKind = "manga" | "cd" | "discogs" | "json";
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
