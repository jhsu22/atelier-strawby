export type Language = 'EN' | 'JP' | 'KR';
export type LanguageBasis = 'specified' | 'assumed' | 'confirmed';
export interface DistributionEntry { label: string; count: number }
export interface CollectionSummary {
  physicalCopies: number;
  uniqueSeries: number;
  datedCopies: number;
  undatedCopies: number;
  distinctAcquisitionDates: number;
  recordsWithNotes: number;
  languages: DistributionEntry[];
  publishers: DistributionEntry[];
  years: DistributionEntry[];
  personalCds: number;
  sampleCds: number;
}
export const MEDIUMS = ["manga", "light_novel", "book"] as const;
export type Medium = (typeof MEDIUMS)[number];
export const MEDIUM_LABELS: Record<Medium, string> = {
  manga: "Manga",
  light_novel: "Light novel",
  book: "Book",
};
