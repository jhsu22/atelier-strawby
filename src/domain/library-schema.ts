import { z } from "zod";
import type { LibraryData } from "./library.ts";
import { MEDIUMS } from "./types.ts";

const string = z.string();
const nullable = string.nullable();
const artwork = z
  .object({
    url: string,
    scope: z.enum(["edition", "representative"]),
    attribution: string,
    provider: string,
    sourceUrl: string,
  })
  .nullable()
  .optional();
const haul = z
  .object({ id: string, acquiredOn: nullable, store: nullable, storePrivate: z.boolean().optional() })
  .nullable()
  .optional();
const mangaCopy = z.object({
  version: z.number().int().positive().optional(),
  artwork,
  id: string,
  editionRunId: string,
  editionTitle: string,
  publisher: string,
  language: z.enum(["EN", "JP", "KR"]),
  languageBasis: z.enum(["specified", "assumed", "confirmed"]),
  volume: string,
  bookTitle: string.optional(),
  volumeSort: z.number().nullable(),
  isbn13: nullable.optional(),
  numberingBasis: z.enum(["printed", "source_record", "unknown"]),
  medium: z.enum(MEDIUMS),
  format: string,
  acquiredOn: nullable,
  notes: nullable,
  notesPrivate: z.boolean().optional(),
  haul,
  tags: z.array(string),
  dateUnknown: z.boolean().optional(),
  coverUnavailable: z.boolean().optional(),
});
const seriesEntry = <K extends "manga" | "book">(kind: K) =>
  z.object({
    kind: z.literal(kind),
    id: string,
    title: string,
    authors: z.array(string),
    aliases: z.array(string),
    copies: z.array(mangaCopy),
  });
export const librarySchema: z.ZodType<LibraryData> = z.object({
  entries: z.array(
    z.discriminatedUnion("kind", [
      seriesEntry("manga"),
      seriesEntry("book"),
      z.object({
        kind: z.literal("cd"),
        artwork,
        coverUnavailable: z.boolean().optional(),
        editionTitle: string.optional(),
        id: string,
        title: string,
        artists: z.array(string),
        releaseId: string,
        releaseDate: nullable,
        barcode: nullable.optional(),
        formats: z.array(string),
        labels: z.array(string),
        catalogNumbers: z.array(string),
        tracks: z.array(
          z.object({
            medium: z.number().int().positive(),
            position: z.number().int().positive(),
            title: string,
            durationMs: z.number().nonnegative().nullable(),
          }),
        ),
        copies: z.array(
          z.object({
            id: string,
            version: z.number().int().positive().optional(),
            tags: z.array(string).optional(),
            acquiredOn: nullable,
            notes: nullable,
            notesPrivate: z.boolean().optional(),
            haul,
            dateUnknown: z.boolean().optional(),
          }),
        ),
      }),
    ]),
  ),
});
