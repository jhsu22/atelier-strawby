import { z } from "zod";
import { MEDIUMS } from "./types.ts";
import { TAGS, deriveTags } from "./normalization/tags.ts";
import { validIsbn13 } from "./isbn.ts";

export const key = (value: string) =>
  value.normalize("NFKC").trim().toLocaleLowerCase("en");
export function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number) as [
    number,
    number,
    number,
  ];
  const days = [
    31,
    year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28,
    31,
    30,
    31,
    30,
    31,
    31,
    30,
    31,
    30,
    31,
  ];
  return (
    year > 0 && month >= 1 && month <= 12 && day > 0 && day <= days[month - 1]!
  );
}
export function publicImageUrl(value: string): boolean {
  try {
    const url = new URL(value),
      host = url.hostname.toLowerCase();
    return (
      url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      !url.port &&
      host.includes(".") &&
      !/^[\d.]+$/.test(host) &&
      !host.includes(":") &&
      !/(^|\.)(localhost|local|internal|test|invalid)$/.test(host)
    );
  } catch {
    return false;
  }
}
const text = z.string().trim().max(300);
const names = z.array(text.min(1)).max(30);
export const artworkSchema = z.object({
  url: z
    .string()
    .max(2048)
    .refine(publicImageUrl, "Use a public HTTPS image URL"),
  scope: z.enum(["edition", "representative"]).default("representative"),
  provider: text.default("manual"),
  sourceId: text.default(""),
  attribution: z.string().max(1000).default("Owner-selected artwork"),
  language: z.enum(["EN", "JP", "KR"]).nullable().default(null),
});
export const itemSchema = z
  .object({
    kind: z.enum(["manga", "cd"]),
    title: text.min(1, "A title is required"),
    seriesId: z.string().max(100).optional(),
    authors: names.default([]),
    aliases: names.default([]),
    editionTitle: text.default(""),
    volume: text.max(40).default("1"),
    bookTitle: text.default(""),
    language: z.enum(["EN", "JP", "KR"]).default("EN"),
    languageBasis: z
      .enum(["specified", "assumed", "confirmed"])
      .default("confirmed"),
    publisher: text.default(""),
    format: z
      .enum([
        "standard",
        "omnibus",
        "collectors",
        "artbook",
        "anthology",
        "unknown",
      ])
      .default("standard"),
    numberingBasis: z
      .enum(["printed", "source_record", "unknown"])
      .default("printed"),
    // Volume-shaped copies are manga, light novels or other (prose) books.
    medium: z.enum(MEDIUMS).default("manga"),
    artists: names.default([]),
    releaseDate: z
      .string()
      .nullable()
      .default(null)
      .refine(
        (value) =>
          value === null ||
          (/^\d{4}$/.test(value) && Number(value) > 0) ||
          (/^\d{4}-\d{2}$/.test(value) && validDate(value + "-01")) ||
          validDate(value ?? ""),
        "Invalid release date",
      ),
    labels: z
      .array(z.object({ name: text.min(1), catalogNumber: text.default("") }))
      .max(20)
      .default([]),
    media: z
      .array(
        z.object({
          position: z.number().int().min(1).max(99),
          format: z.enum(["CD", "Blu-ray", "DVD", "other"]),
          title: text.default(""),
        }),
      )
      .max(20)
      .default([]),
    tracks: z
      .array(
        z.object({
          medium: z.number().int().min(1).max(99),
          position: z.number().int().min(1).max(999),
          title: text.min(1),
          durationMs: z
            .number()
            .int()
            .min(0)
            .max(86400000)
            .nullable()
            .default(null),
        }),
      )
      .max(500)
      .default([]),
    acquiredOn: z
      .string()
      .nullable()
      .default(null)
      .refine(
        (value) => value === null || validDate(value),
        "Use a valid acquisition date",
      ),
    notes: z.string().max(10000).nullable().default(null),
    // Private notes and their derived memory tags are hidden on the public shelf.
    notesPrivate: z.boolean().default(true),
    /** The haul this copy was logged with (acquisition_batches), if any. */
    acquisitionBatchId: z.string().max(100).nullable().default(null),
    tags: z.array(text.min(1).max(80)).max(30).default([]),
    tagsMode: z.enum(["auto", "manual"]).default("auto"),
    isSample: z.boolean().default(false),
    artwork: artworkSchema.nullable().default(null),
    // A checksum-valid ISBN-13 for the volume edition. Callers convert ISBN-10.
    isbn13: z
      .string()
      .nullable()
      .default(null)
      .refine((value) => value === null || validIsbn13(value), "Use a valid 13-digit ISBN"),
    // The catalog record the owner confirmed for this ISBN, kept as provenance.
    catalogSource: z
      .object({
        provider: z.enum(["googlebooks", "openlibrary"]),
        sourceId: z.string().trim().min(1).max(100),
        sourceUrl: z.string().url().max(2048),
      })
      .nullable()
      .default(null),
  })
  .superRefine((item, ctx) => {
    const issue = (path: string, message: string) =>
      ctx.addIssue({ code: "custom", path: [path], message });
    if (item.kind === "manga" && !item.volume && !(item.medium === "book" && item.bookTitle))
      issue("volume", "A volume number or label is required");
    if (item.kind === "manga" && item.medium === "book" && item.volume &&
      (!/^\d+$/.test(item.volume) || !Number.isSafeInteger(Number(item.volume)) || Number(item.volume) < 1))
      issue("volume", "Use a positive whole number for the number in series");
    if (item.kind === "cd" && (item.isbn13 || item.catalogSource))
      issue("isbn13", "ISBNs apply to books and manga only.");
    if (item.catalogSource && !item.isbn13)
      issue("catalogSource", "A catalog record is only kept with the scanned ISBN.");
    for (const field of ["authors", "artists"] as const) {
      if (new Set(item[field].map(key)).size !== item[field].length)
        issue(field, "Names must be unique.");
    }
    if (
      new Set(
        item.labels.map(
          (label) => `${key(label.name)}:${key(label.catalogNumber)}`,
        ),
      ).size !== item.labels.length
    )
      issue("labels", "Label and catalog number pairs must be unique.");
    if (new Set(item.media.map((m) => m.position)).size !== item.media.length)
      issue("media", "Disc positions must be unique");
    if (
      new Set(item.tracks.map((t) => `${t.medium}:${t.position}`)).size !==
      item.tracks.length
    )
      issue("tracks", "Track positions must be unique within each disc");
    if (
      item.tracks.some((t) => !item.media.some((m) => m.position === t.medium))
    )
      issue("tracks", "Each track must belong to a listed disc");
  });
export type ItemInput = z.infer<typeof itemSchema>;
export type ArtworkInput = z.infer<typeof artworkSchema>;
export function memoryTags(note: string | null, title = ""): string[] {
  const slugs = deriveTags(note, title);
  const labels: string[] = TAGS.filter((tag) => slugs.includes(tag.slug)).map(
    (tag) => tag.label,
  );
  if (/\b(gift|gifts|gifted|christmas|xmas)\b/i.test(note ?? ""))
    labels.push("Gifts");
  return [...new Set(labels)];
}
