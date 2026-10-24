import type { ItemInput } from "./item.ts";
export interface MetadataCandidate {
  id: string;
  provider: "mangadex" | "openlibrary" | "musicbrainz" | "itunes";
  title: string;
  subtitle: string;
  sourceUrl: string;
  detail: boolean;
  patch: Partial<ItemInput>;
  warning: string;
}
export interface MetadataResult {
  candidates: MetadataCandidate[];
  warnings: string[];
}
