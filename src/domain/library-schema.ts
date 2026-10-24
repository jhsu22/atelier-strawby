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
  volumeSort: z.number().nullable(),
  numberingBasis: z.enum(["printed", "source_record", "unknown"]),
  medium: z.enum(MEDIUMS),
  format: string,
  acquiredOn: nullable,
  notes: nullable,
  tags: z.array(string),
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
        editionTitle: string.optional(),
        id: string,
        title: string,
        artists: z.array(string),
        releaseId: string,
        releaseDate: nullable,
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
            isSample: z.boolean(),
          }),
        ),
      }),
    ]),
  ),
});
