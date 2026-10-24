import { z } from "zod";
import type { ScanEdition } from "../../domain/scan.ts";
import { scanEditionSchema } from "../../domain/scan.ts";
import type { Medium } from "../../domain/types.ts";

// Provider payloads are untrusted. Each reader extracts known fields only and
// leaves a field null/empty rather than inferring it from unrelated data.
const object = z.record(z.unknown());
const record = (value: unknown) => {
  const parsed = object.safeParse(value);
  return parsed.success ? parsed.data : {};
};
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const str = (value: unknown) => (typeof value === "string" ? value.trim() : "");
const strings = (value: unknown) => list(value).map(str).filter(Boolean);
const languages: Record<string, ScanEdition["language"]> = {
  en: "EN", eng: "EN", ja: "JP", jpn: "JP", ko: "KR", kor: "KR",
};

export interface ParsedTitle {
  series: string;
  volume: string | null;
  basis: ScanEdition["volumeBasis"];
  medium: Medium | null;
  format: ScanEdition["format"];
}
/**
 * Split a catalog title such as "Spy x Family, Vol. 1", "チェンソーマン 2" or
 * "A Sign of Affection Omnibus 1 (Vol. 1-3)" into series and volume.
 */
export function parseCatalogTitle(raw: string): ParsedTitle {
  let title = raw.normalize("NFKC").replace(/\s+/g, " ").trim();
  let medium: Medium | null = null;
  let format: ScanEdition["format"] = null;
  // Trailing parentheticals are imprints ("ジャンプコミックス"), media or ranges.
  for (let match = title.match(/\s*\(([^()]*)\)\s*$/); match; match = title.match(/\s*\(([^()]*)\)\s*$/)) {
    const note = match[1]!;
    if (/(light )?novel|ライトノベル|小説/i.test(note)) medium = "light_novel";
    else if (/manga|comic|コミック/i.test(note)) medium ??= "manga";
    if (/\bvol(?:ume)?s?\.?\s*\d+\s*[-–~]\s*\d+/i.test(note)) format = "omnibus";
    title = title.slice(0, match.index).trim();
  }
  if (/\bomnibus\b|\b\d+-in-1\b|\bvols?\.?\s*\d+\s*[-–]\s*\d+/i.test(title)) format = "omnibus";
  else if (/collector'?s edition/i.test(title)) format = "collectors";
  if (/light novel/i.test(title)) medium = "light_novel";
  const markers = [
    /[\s,:–-]*\b(?:vol(?:ume)?|v)\.?\s*(\d{1,4}(?:\.\d)?)\b/i,
    /[\s,:]*第\s*(\d{1,4})\s*巻/,
    /[\s,:]*(\d{1,4})\s*巻/,
    /[\s,:]*\btome\s*(\d{1,4})\b/i,
  ];
  for (const marker of markers) {
    const match = title.match(marker);
    if (match) {
      const series = (title.slice(0, match.index) + title.slice(match.index! + match[0].length))
        .replace(/[\s,:–-]+$/, "").trim();
      return { series, volume: String(Number(match[1])), basis: "marker", medium, format };
    }
  }
  const trailing = title.match(/^(.*?\S)[\s,:]+(\d{1,3})$/);
  if (trailing)
    return { series: trailing[1]!.replace(/[\s,:–-]+$/, ""), volume: String(Number(trailing[2])), basis: "trailing-number", medium, format };
  return { series: title, volume: null, basis: null, medium, format };
}

function categoryMedium(values: string[], physicalFormat = ""): Medium | null {
  const text = [...values, physicalFormat].join(" ");
  if (/light novel/i.test(text)) return "light_novel";
  if (/manga|comics?\b|graphic novel/i.test(text)) return "manga";
  return null;
}
const sameIsbn = (identifiers: string[], isbn13: string, isbn10: string | null) =>
  identifiers.some((value) => {
    const clean = value.replace(/[\s-]/g, "").toUpperCase();
    return clean === isbn13 || (isbn10 !== null && clean === isbn10);
  });

function safeCover(raw: string, hosts: string[]): string | null {
  try {
    const url = new URL(raw);
    if (!hosts.includes(url.hostname) || url.username || url.password || url.port) return null;
    if (!["http:", "https:"].includes(url.protocol)) return null;
    url.protocol = "https:";
    url.searchParams.delete("key");
    url.searchParams.delete("edge");
    return url.href;
  } catch {
    return null;
  }
}

function edition(value: Omit<ScanEdition, "warnings">, warnings: string[]): ScanEdition {
  return scanEditionSchema.parse({ ...value, warnings: warnings.filter(Boolean).slice(0, 10) });
}

/** Google Books `q=isbn:` responses can include unrelated volumes; each is checked. */
export function googleEditions(payload: unknown, isbn13: string, isbn10: string | null, limit = 5): ScanEdition[] {
  const editions: ScanEdition[] = [];
  for (const item of list(record(payload).items).slice(0, limit)) {
    const entry = record(item);
    const id = str(entry.id);
    if (!/^[A-Za-z0-9_-]{1,100}$/.test(id)) continue;
    const info = record(entry.volumeInfo);
    const title = [str(info.title), str(info.subtitle)].filter(Boolean).join(": ");
    if (!title) continue;
    const identifiers = list(info.industryIdentifiers)
      .map(record)
      .filter((value) => ["ISBN_10", "ISBN_13"].includes(str(value.type)))
      .map((value) => str(value.identifier));
    const parsed = parseCatalogTitle(title);
    const display = str(record(info.seriesInfo).bookDisplayNumber);
    const seriesNumber = /^\d{1,4}$/.test(display) ? String(Number(display)) : null;
    const language = languages[str(info.language).toLowerCase()] ?? null;
    const images = record(info.imageLinks);
    const isbnVerified = sameIsbn(identifiers, isbn13, isbn10);
    const ebook = record(entry.saleInfo).isEbook === true;
    editions.push(
      edition(
        {
          provider: "googlebooks",
          sourceId: id,
          sourceUrl: `https://books.google.com/books?id=${encodeURIComponent(id)}`,
          title,
          seriesTitle: parsed.series,
          volume: seriesNumber ?? parsed.volume,
          volumeBasis: seriesNumber ? "series-data" : parsed.basis,
          authors: strings(info.authors).slice(0, 30),
          publisher: str(info.publisher).slice(0, 300),
          language,
          publishedDate: str(info.publishedDate).slice(0, 40),
          pageCount: Number.isInteger(info.pageCount) && Number(info.pageCount) >= 0 ? Number(info.pageCount) : null,
          medium: parsed.medium ?? categoryMedium(strings(info.categories)),
          format: parsed.format,
          isbnVerified,
          ebook,
          cover: safeCover(str(images.thumbnail) || str(images.smallThumbnail), ["books.google.com", "books.googleusercontent.com"]),
        },
        [
          isbnVerified ? "" : "Google Books returned this record for the search, but it does not list the scanned ISBN.",
          str(info.language) && !language ? `Catalog language "${str(info.language)}" is not an edition language this collection tracks.` : "",
          seriesNumber && parsed.volume && seriesNumber !== parsed.volume ? `Google's series number (${seriesNumber}) differs from the title (${parsed.volume}).` : "",
        ],
      ),
    );
  }
  return editions;
}

/** Open Library `api/books?jscmd=details`, keyed by the requested bibkeys. */
export function openLibraryEditions(payload: unknown, isbn13: string, isbn10: string | null): ScanEdition[] {
  const editions: ScanEdition[] = [];
  const seen = new Set<string>();
  for (const value of Object.values(record(payload)).slice(0, 2)) {
    const entry = record(value);
    const details = record(entry.details);
    const key = str(details.key);
    if (!/^\/books\/OL\d+M$/.test(key) || seen.has(key)) continue;
    seen.add(key);
    const title = [str(details.title), str(details.subtitle)].filter(Boolean).join(": ");
    if (!title) continue;
    const parsed = parseCatalogTitle(title);
    const series = strings(details.series)[0]?.normalize("NFKC") ?? "";
    const physical = str(details.physical_format);
    const languageKeys = list(details.languages).map((language) => str(record(language).key).replace("/languages/", ""));
    const language = languageKeys.length === 1 ? (languages[languageKeys[0]!] ?? null) : null;
    const cover = list(details.covers).find((id) => Number.isInteger(id) && Number(id) > 0);
    const isbnVerified = sameIsbn([...strings(details.isbn_13), ...strings(details.isbn_10)], isbn13, isbn10);
    editions.push(
      edition(
        {
          provider: "openlibrary",
          sourceId: key.slice("/books/".length),
          sourceUrl: `https://openlibrary.org${key}`,
          title,
          // A catalog series name is cleaner than the title prefix when present.
          seriesTitle: series && !/\d+$/.test(series) ? series.replace(/\s*\([^()]*\)\s*$/, "") : parsed.series,
          volume: parsed.volume,
          volumeBasis: parsed.basis,
          authors: list(details.authors).map((author) => str(record(author).name)).filter(Boolean).slice(0, 30),
          publisher: strings(details.publishers)[0]?.slice(0, 300) ?? "",
          language,
          publishedDate: str(details.publish_date).slice(0, 40),
          pageCount: Number.isInteger(details.number_of_pages) && Number(details.number_of_pages) >= 0 ? Number(details.number_of_pages) : null,
          medium: parsed.medium ?? categoryMedium(strings(details.subjects), physical),
          format: parsed.format,
          isbnVerified,
          ebook: /e-?book|electronic|digital/i.test(physical),
          cover: cover ? `https://covers.openlibrary.org/b/id/${Number(cover)}-L.jpg?default=false` : null,
        },
        [
          isbnVerified ? "" : "Open Library returned this record, but it does not list the scanned ISBN.",
          languageKeys.length > 1 ? "Open Library lists several languages for this edition." : "",
        ],
      ),
    );
  }
  return editions;
}

const completeness = (edition: ScanEdition) =>
  (edition.isbnVerified ? 100 : 0) +
  (edition.volume ? 8 : 0) +
  (edition.volumeBasis === "trailing-number" ? -2 : 0) +
  (edition.language ? 4 : 0) +
  (edition.publisher ? 2 : 0) +
  (edition.authors.length ? 2 : 0) +
  (edition.cover ? 1 : 0) +
  (edition.ebook ? -6 : 0);
/** Verified, complete printed-edition records first; provider order breaks ties. */
export const rankEditions = (editions: ScanEdition[]) =>
  editions
    .map((edition, index) => ({ edition, index }))
    .sort((a, b) => completeness(b.edition) - completeness(a.edition) || a.index - b.index)
    .map(({ edition }) => edition);

/** Disagreements between verified records are shown, never silently resolved. */
export function editionConflicts(editions: ScanEdition[]): string[] {
  const verified = editions.filter((edition) => edition.isbnVerified);
  const warnings: string[] = [];
  const distinct = (values: (string | null)[]) => [...new Set(values.filter((value): value is string => Boolean(value)))];
  const volumes = distinct(verified.map((edition) => edition.volume));
  if (volumes.length > 1) warnings.push(`Catalogs disagree about the volume number (${volumes.join(" vs ")}). Check the spine.`);
  const languageValues = distinct(verified.map((edition) => edition.language));
  if (languageValues.length > 1) warnings.push(`Catalogs disagree about the edition language (${languageValues.join(" vs ")}).`);
  return warnings;
}
