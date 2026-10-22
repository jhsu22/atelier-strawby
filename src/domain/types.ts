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
