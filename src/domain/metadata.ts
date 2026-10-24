import type { ItemInput } from "./item.ts";
export interface MetadataCandidate {
  id: string;
  provider: "mangadex" | "openlibrary" | "googlebooks" | "musicbrainz" | "itunes";
  title: string;
  subtitle: string;
  sourceUrl: string;
  detail: boolean;
  patch: Partial<ItemInput>;
  warning: string;
  /** Show incompatible Google search results for context, without applying them. */
  applicable?: boolean;
  /** Every provider credit (authors and artists), for match checks only. */
  credits?: string[];
  /** Set by edition-level searches when the owned publisher is listed. */
  publisherMatch?: boolean;
  /** Edition-level searches: the edition is positively the requested medium. */
  mediumEvidence?: boolean;
}
export interface MetadataResult {
  candidates: MetadataCandidate[];
  warnings: string[];
  /** HTTP-style statuses of provider attempts that failed, distinct from "no match". */
  failures?: number[];
}
