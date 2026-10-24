import { z } from "zod";
import { MEDIUMS } from "./types.ts";
import type { ItemInput } from "./item.ts";

// Strict boundary schemas for barcode lookups. Every client parse uses these, so
// an unexpected server or proxy response fails visibly instead of being trusted.
const language = z.enum(["EN", "JP", "KR"]);
const text = z.string().max(500);

export const SCAN_LOOKUP_BYTES = 2048;
export const scanLookupRequestSchema = z
  .object({
    code: z.string().trim().min(1).max(32),
    source: z.enum(["camera", "photo", "manual"]),
    /** Bypass the D1 provider cache, for example after an outage. */
    retry: z.boolean().default(false),
  })
  .strict();
export type ScanLookupRequest = z.input<typeof scanLookupRequestSchema>;

/** One provider's catalog record, normalized. Fields are absent, never guessed. */
export const scanEditionSchema = z
  .object({
    provider: z.enum(["googlebooks", "openlibrary"]),
    sourceId: z.string().max(100),
    sourceUrl: z.string().url().max(2048),
    title: text,
    seriesTitle: text,
    volume: z.string().max(40).nullable(),
    /** How volume was read: an explicit marker ("Vol. 3", "3巻"), provider series data, or a bare trailing number. */
    volumeBasis: z.enum(["series-data", "marker", "trailing-number"]).nullable(),
    authors: z.array(text).max(30),
    publisher: text,
    language: language.nullable(),
    publishedDate: z.string().max(40),
    pageCount: z.number().int().nonnegative().nullable(),
    medium: z.enum(MEDIUMS).nullable(),
    format: z.enum(["standard", "omnibus", "collectors"]).nullable(),
    /** The provider lists this exact ISBN among the record's identifiers. */
    isbnVerified: z.boolean(),
    ebook: z.boolean(),
    cover: z.string().url().max(2048).nullable(),
    warnings: z.array(text).max(10),
  })
  .strict();
export type ScanEdition = z.infer<typeof scanEditionSchema>;

const ownedCopy = z
  .object({ id: z.string().max(100), acquiredOn: z.string().nullable(), isbn13: z.string().nullable() })
  .strict();
/** An existing D1 series (and, when known, edition run) this scan may belong to. */
export const scanMatchSchema = z
  .object({
    seriesId: z.string().max(100),
    seriesTitle: text,
    aliases: z.array(text).max(50),
    authors: z.array(text).max(30),
    medium: z.enum(MEDIUMS),
    // Every attribute that identifies the owned edition run. Saving reuses the
    // run only when all of them are passed through unchanged.
    run: z
      .object({
        editionTitle: text,
        language,
        languageBasis: z.enum(["specified", "assumed", "confirmed"]),
        publisher: text,
        format: z.enum(["standard", "omnibus", "collectors", "artbook", "anthology", "unknown"]),
        numberingBasis: z.enum(["printed", "source_record", "unknown"]),
      })
      .strict()
      .nullable(),
    /** The owned volume label this match points at, when one exists. */
    volume: z.string().max(40).nullable(),
    /** Copies of the same volume in the matched run (or exact-ISBN copies). */
    copies: z.array(ownedCopy).max(100),
    /** ISBN recorded for that volume, which may differ from the scanned one. */
    recordedIsbn: z.string().nullable(),
    basis: z.enum(["isbn", "title", "alias", "bridge", "owner"]),
    score: z.number().min(0).max(1),
    reasons: z.array(text).max(10),
  })
  .strict();
export type ScanMatch = z.infer<typeof scanMatchSchema>;

export const scanLookupResultSchema = z
  .object({
    isbn13: z.string().regex(/^97[89]\d{10}$/),
    isbn10: z.string().regex(/^\d{9}[\dX]$/).nullable(),
    languageHint: language.nullable(),
    /** Ranked best first; only ISBN-verified records are applicable. */
    editions: z.array(scanEditionSchema).max(10),
    /** Ranked best first. */
    matches: z.array(scanMatchSchema).max(5),
    duplicate: z
      .object({
        level: z.enum(["exact-isbn", "same-volume", "none"]),
        copies: z.array(ownedCopy).max(100),
      })
      .strict(),
    /** True when the answer came from the collection without any provider request. */
    local: z.boolean(),
    warnings: z.array(text).max(20),
    failures: z
      .array(z.object({ provider: z.string().max(40), status: z.number().int() }).strict())
      .max(5),
  })
  .strict();
export type ScanLookupResult = z.infer<typeof scanLookupResultSchema>;

/** Matches at or above this score are preselected; lower ones are offered. */
export const CONFIDENT_MATCH = 0.8;
export const preselectedMatch = (result: ScanLookupResult) =>
  result.matches[0] && result.matches[0].score >= CONFIDENT_MATCH ? result.matches[0] : null;

/** Where a draft field came from, shown beside the field in the review screen. */
export type FieldSource = "collection" | "provider" | "isbn-prefix" | "scan" | "missing";
export interface ScanDraft {
  item: Partial<ItemInput> & { title: string; volume: string; isbn13: string };
  sources: Partial<Record<"title" | "volume" | "language" | "publisher" | "authors" | "medium", FieldSource>>;
  /** Things the owner must check before saving. */
  flags: string[];
  /** Required fields with no value; each message applies while the field is empty. */
  fieldFlags: Partial<Record<"title" | "volume", string>>;
}

/**
 * Compose the editable draft. The scanned ISBN is the only identifier used;
 * provider ISBNs are never copied. Unknown fields stay empty and are flagged.
 */
export function draftFromScan(
  result: ScanLookupResult,
  edition: ScanEdition | null,
  match: ScanMatch | null,
): ScanDraft {
  const flags: string[] = [];
  const fieldFlags: ScanDraft["fieldFlags"] = {};
  const sources: ScanDraft["sources"] = {};
  const usable = edition?.isbnVerified ? edition : null;
  let title = "";
  if (match) {
    title = match.seriesTitle;
    sources.title = "collection";
  } else if (usable?.seriesTitle) {
    title = usable.seriesTitle;
    sources.title = "provider";
  } else {
    sources.title = "missing";
    fieldFlags.title = "No catalog title was found. Type the series title from the cover.";
  }
  // The owner's recorded volume for this exact ISBN outranks catalog parsing.
  const recorded = match?.basis === "isbn" ? match.volume : null;
  const volume = recorded ?? usable?.volume ?? "";
  if (recorded) sources.volume = "collection";
  else if (volume) {
    sources.volume = "provider";
    if (usable?.volumeBasis === "trailing-number")
      flags.push(`Volume ${volume} was read from the end of the catalog title. Check it against the spine.`);
  } else {
    sources.volume = "missing";
    fieldFlags.volume = "The volume number was not found. Enter the number printed on the spine.";
  }
  let languageValue: ItemInput["language"] = "EN";
  let languageBasis: ItemInput["languageBasis"] = "assumed";
  if (match?.run) {
    languageValue = match.run.language;
    languageBasis = match.run.languageBasis;
    sources.language = "collection";
  } else if (usable?.language) {
    languageValue = usable.language;
    languageBasis = "specified";
    sources.language = "provider";
  } else if (result.languageHint) {
    languageValue = result.languageHint;
    sources.language = "isbn-prefix";
    flags.push("Edition language is assumed from the ISBN registration group.");
  } else {
    sources.language = "missing";
    flags.push("Edition language is unknown. Choose the language printed in the book.");
  }
  if (usable?.language && match?.run && usable.language !== match.run.language)
    flags.push(`The catalog lists this ISBN as ${usable.language}, but the matched edition in your collection is ${match.run.language}.`);
  const publisher = match?.run?.publisher || usable?.publisher || "";
  sources.publisher = match?.run?.publisher ? "collection" : usable?.publisher ? "provider" : "missing";
  const authors = match?.authors.length ? match.authors : (usable?.authors ?? []);
  sources.authors = match?.authors.length ? "collection" : authors.length ? "provider" : "missing";
  const medium = match?.medium ?? usable?.medium ?? "manga";
  sources.medium = match ? "collection" : usable?.medium ? "provider" : "missing";
  if (!match && !usable?.medium) flags.push("Assumed to be manga. Change the type for light novels or other books.");
  if (usable?.ebook) flags.push("The catalog marks this listing as an eBook. Confirm it describes your printed copy.");
  if (usable?.format === "omnibus") flags.push("The catalog title suggests an omnibus; its numbering may differ from single volumes.");
  if (match?.recordedIsbn && match.recordedIsbn !== result.isbn13)
    flags.push(`Volume ${volume || "?"} in this edition already records ISBN ${match.recordedIsbn}. A different ISBN usually means a different printing or edition.`);
  if (!usable && result.editions.length)
    flags.push("No catalog record lists this exact ISBN, so catalog details were not applied.");
  return {
    item: {
      kind: "manga",
      title,
      volume,
      isbn13: result.isbn13,
      ...(match ? { seriesId: match.seriesId, aliases: match.aliases } : {}),
      authors,
      // A new language edition of an owned series keeps its printed title,
      // for example 薫る花は凛と咲く under The Fragrant Flower Blooms With Dignity.
      editionTitle: match?.run?.editionTitle ?? usable?.seriesTitle ?? "",
      language: languageValue,
      languageBasis,
      publisher,
      format: match?.run?.format ?? (usable?.format ?? "standard"),
      numberingBasis: match?.run?.numberingBasis ?? (volume ? "printed" : "unknown"),
      medium,
      ...(usable?.cover
        ? {
            artwork: {
              url: usable.cover,
              scope: "representative" as const,
              provider: usable.provider,
              sourceId: usable.sourceId,
              attribution: `${usable.provider === "googlebooks" ? "Google Books" : "Open Library"} · catalog cover for this ISBN; printing unverified`,
              language: usable.language,
            },
          }
        : {}),
    },
    sources,
    flags,
    fieldFlags,
  };
}

/** An owned series as the shelf already knows it (manga, light novel or book). */
export interface OwnedSeries {
  id: string;
  title: string;
  aliases: string[];
  authors: string[];
  copies: {
    id: string;
    editionRunId: string;
    editionTitle: string;
    publisher: string;
    language: "EN" | "JP" | "KR";
    languageBasis: "specified" | "assumed" | "confirmed";
    volume: string;
    numberingBasis: "printed" | "source_record" | "unknown";
    medium: (typeof MEDIUMS)[number];
    format: string;
    acquiredOn: string | null;
  }[];
}
const RUN_FORMATS = ["standard", "omnibus", "collectors", "artbook", "anthology", "unknown"] as const;
type RunFormat = (typeof RUN_FORMATS)[number];

/** The owned run in a language, with every attribute needed to reuse it. */
export function ownedRun(series: OwnedSeries, language: "EN" | "JP" | "KR", format?: string | null) {
  const copies = series.copies.filter((copy) => copy.language === language);
  const copy = copies.find((entry) => !format || entry.format === format) ?? (format ? undefined : copies[0]);
  if (!copy) return null;
  return {
    id: copy.editionRunId,
    medium: copy.medium,
    run: {
      editionTitle: copy.editionTitle,
      language: copy.language,
      languageBasis: copy.languageBasis,
      publisher: copy.publisher,
      format: (RUN_FORMATS as readonly string[]).includes(copy.format) ? (copy.format as RunFormat) : "unknown",
      numberingBasis: copy.numberingBasis,
    },
  };
}
/** Copies of one volume in one owned run: the live duplicate check. */
export const ownedCopies = (series: OwnedSeries, runId: string | null, volume: string) =>
  runId && volume
    ? series.copies
        .filter((copy) => copy.editionRunId === runId && copy.volume === volume)
        .map((copy) => ({ id: copy.id, acquiredOn: copy.acquiredOn, isbn13: null }))
    : [];

/** A series the owner picked by hand, shaped like a lookup match. */
export function ownerMatch(series: OwnedSeries, language: "EN" | "JP" | "KR", volume: string, format?: string | null): ScanMatch {
  const owned = ownedRun(series, language, format);
  return {
    seriesId: series.id,
    seriesTitle: series.title,
    aliases: series.aliases.slice(0, 50),
    authors: series.authors.slice(0, 30),
    medium: owned?.medium ?? series.copies[0]?.medium ?? "manga",
    run: owned?.run ?? null,
    volume: volume || null,
    copies: ownedCopies(series, owned?.id ?? null, volume),
    recordedIsbn: null,
    basis: "owner",
    score: 1,
    reasons: [owned ? `You chose this series; your ${language} copies are its ${owned.run.publisher || "existing"} edition.` : `You chose this series; this starts its ${language} edition.`],
  };
}
