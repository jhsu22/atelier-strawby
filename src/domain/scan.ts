import { z } from "zod";
import { MEDIUMS } from "./types.ts";
import { parseIsbn } from "./isbn.ts";
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
    isbn13?: string | null;
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
/** The owned run with exactly these attributes, when the match names one. */
export function exactRun(series: OwnedSeries, run: NonNullable<ScanMatch["run"]>) {
  const copy = series.copies.find(
    (entry) =>
      entry.language === run.language &&
      entry.format === run.format &&
      entry.publisher === run.publisher &&
      entry.editionTitle === run.editionTitle,
  );
  return copy ? ownedRun({ ...series, copies: [copy] }, copy.language, copy.format) : null;
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

/** Owned volume labels as compact ranges, for example "1–4, 7, Special". */
export function volumeRanges(labels: string[]): string {
  const unique = [...new Set(labels)];
  const numbers = unique.filter((label) => /^[1-9]\d*$/.test(label)).map(Number).sort((a, b) => a - b);
  const ranges: string[] = [];
  for (let index = 0; index < numbers.length; index++) {
    const start = numbers[index]!;
    while (numbers[index + 1] === numbers[index]! + 1) index++;
    ranges.push(start === numbers[index] ? String(start) : `${start}–${numbers[index]}`);
  }
  return [...ranges, ...unique.filter((label) => !/^[1-9]\d*$/.test(label))].join(", ");
}
/** The lowest whole volume number not owned; null when labels aren't all whole numbers. */
export function nextVolume(labels: string[]): string | null {
  if (!labels.length || !labels.every((label) => /^[1-9]\d*$/.test(label))) return null;
  const owned = new Set(labels.map(Number));
  let next = 1;
  while (owned.has(next)) next++;
  return String(next);
}

export interface OwnershipRun {
  id: string;
  editionTitle: string;
  language: "EN" | "JP" | "KR";
  publisher: string;
  /** Owned volumes as ranges, e.g. "1–4, 7". */
  volumes: string;
  copies: number;
  next: string | null;
}
/** A read-only answer to "do I own this?". Nothing here is saved. */
export interface OwnershipAnswer {
  /** owned: this volume is on the shelf; series: the series is, this volume isn't; new: neither. */
  verdict: "owned" | "series" | "new";
  /** False when the series match is only a possible one; the owner should check the cover. */
  confident: boolean;
  title: string | null;
  volume: string | null;
  language: "EN" | "JP" | "KR";
  seriesId: string | null;
  copies: { id: string; acquiredOn: string | null }[];
  /** The owned edition run in this language, when there is one. */
  run: OwnershipRun | null;
  /** The series' other owned editions (other languages or formats). */
  otherRuns: OwnershipRun[];
  reasons: string[];
}

function ownershipRuns(series: OwnedSeries): OwnershipRun[] {
  const runs = new Map<string, OwnedSeries["copies"]>();
  for (const copy of series.copies) runs.set(copy.editionRunId, [...(runs.get(copy.editionRunId) ?? []), copy]);
  return [...runs].map(([id, copies]) => {
    const labels = copies.map((copy) => copy.volume);
    return {
      id,
      editionTitle: copies[0]!.editionTitle,
      language: copies[0]!.language,
      publisher: copies[0]!.publisher,
      volumes: volumeRanges(labels),
      copies: copies.length,
      next: nextVolume(labels),
    };
  });
}

/**
 * Answer "do I own this?" from a lookup and the shelf. It uses the same match,
 * volume and language the add flow would preselect, so checking first and then
 * adding agree.
 */
export function ownershipAnswer(result: ScanLookupResult, series: OwnedSeries[]): OwnershipAnswer {
  const edition = result.editions.find((entry) => entry.isbnVerified) ?? null;
  const match = preselectedMatch(result) ?? result.matches[0] ?? null;
  const draft = draftFromScan(result, edition, match);
  const language = draft.item.language ?? "EN";
  const volume = draft.item.volume || null;
  const shelf = match ? series.find((entry) => entry.id === match.seriesId) : undefined;
  const owned = shelf
    ? ((match?.run ? exactRun(shelf, match.run) : null) ?? ownedRun(shelf, language, match?.run?.format) ?? ownedRun(shelf, language))
    : null;
  const runs = shelf ? ownershipRuns(shelf) : [];
  const exact = result.duplicate.copies.map(({ id, acquiredOn }) => ({ id, acquiredOn }));
  const copies = exact.length ? exact : shelf && owned && volume ? ownedCopies(shelf, owned.id, volume).map(({ id, acquiredOn }) => ({ id, acquiredOn })) : [];
  return {
    verdict: copies.length ? "owned" : match ? "series" : "new",
    // "New" is only reliable when a catalog title was available to match against
    // the shelf; otherwise all we know is that no copy records this ISBN.
    confident: result.duplicate.level === "exact-isbn" || (match ? match.score >= CONFIDENT_MATCH : edition !== null),
    title: draft.item.title || null,
    volume,
    language,
    seriesId: match?.seriesId ?? null,
    copies,
    run: runs.find((run) => run.id === owned?.id) ?? null,
    otherRuns: runs.filter((run) => run.id !== owned?.id),
    reasons: match?.reasons ?? [],
  };
}

/** Marks a result answered from the shelf saved on this device, without the network. */
export const OFFLINE_PROVIDER = "offline";
export const answeredOffline = (result: ScanLookupResult) =>
  result.failures.some((failure) => failure.provider === OFFLINE_PROVIDER);

/**
 * Answer a scan with no connection, from copies whose ISBN is recorded on the
 * saved shelf. Copies added without an ISBN can only be found by title search,
 * so a miss here is never called "not owned".
 */
export function offlineLookup(code: string, series: OwnedSeries[]): ScanLookupResult | null {
  const isbn = parseIsbn(code);
  if (!isbn.ok) return null;
  const hits = series.flatMap((entry) => entry.copies.filter((copy) => copy.isbn13 === isbn.isbn13).map((copy) => ({ entry, copy })));
  const first = hits[0];
  return {
    isbn13: isbn.isbn13,
    isbn10: isbn.isbn10,
    languageHint: isbn.hint,
    editions: [],
    matches: first
      ? [{
          ...ownerMatch(first.entry, first.copy.language, first.copy.volume, first.copy.format),
          basis: "isbn",
          recordedIsbn: isbn.isbn13,
          reasons: ["This ISBN is recorded on a copy in the shelf saved on this device."],
        }]
      : [],
    duplicate: first
      ? { level: "exact-isbn", copies: hits.map(({ copy }) => ({ id: copy.id, acquiredOn: copy.acquiredOn, isbn13: isbn.isbn13 })) }
      : { level: "none", copies: [] },
    local: true,
    warnings: ["The server couldn’t be reached, so this was answered from the shelf saved on this device. Catalogs weren’t checked."],
    failures: [{ provider: OFFLINE_PROVIDER, status: 0 }],
  };
}
