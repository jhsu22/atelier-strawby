import { z } from "zod";
import type { LibraryData } from "./library.ts";

const string = z.string();
const nullable = string.nullable();
const mangaCopy = z.object({
  id: string,
  editionRunId: string,
  editionTitle: string,
  publisher: string,
  language: z.enum(["EN", "JP", "KR"]),
  languageBasis: z.enum(["specified", "assumed", "confirmed"]),
  volume: string,
  volumeSort: z.number().nullable(),
  numberingBasis: z.enum(["printed", "source_record", "unknown"]),
  format: string,
  acquiredOn: nullable,
  notes: nullable,
  tags: z.array(string),
});
export const librarySchema: z.ZodType<LibraryData> = z.object({
  entries: z.array(
    z.discriminatedUnion("kind", [
      z.object({
        kind: z.literal("manga"),
        id: string,
        title: string,
        authors: z.array(string),
        aliases: z.array(string),
        copies: z.array(mangaCopy),
      }),
      z.object({
        kind: z.literal("cd"),
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
            acquiredOn: nullable,
            notes: nullable,
            isSample: z.boolean(),
          }),
        ),
      }),
    ]),
  ),
});
