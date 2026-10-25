import { z } from "zod";
import { validDate } from "./item.ts";

/**
 * A haul: copies acquired together, logged at once with a shared date, store
 * and note. One save is atomic; D1 counts every statement toward its
 * per-request query limit, so a larger haul is saved in parts that share the
 * haul id.
 */
export const HAUL_MAX_COPIES = 20;
export const HAUL_REQUEST_BYTES = 256 * 1024;

export const haulSchema = z
  .object({
    /** Chosen by the client, so later parts join the same haul. */
    id: z.string().uuid(),
    acquiredOn: z
      .string()
      .nullable()
      .default(null)
      .refine((value) => value === null || validDate(value), "Use a valid acquisition date"),
    store: z
      .string()
      .trim()
      .max(120)
      .nullable()
      .default(null)
      .transform((value) => value || null),
    notes: z
      .string()
      .max(10000)
      .nullable()
      .default(null)
      .transform((value) => value?.trim() || null),
    /** Keeps the note and the store off the public shelf. */
    private: z.boolean().default(true),
    items: z.array(z.record(z.unknown())).min(1, "Add at least one copy").max(HAUL_MAX_COPIES, `Save at most ${HAUL_MAX_COPIES} copies at a time`),
  })
  .strict();
export type HaulInput = z.input<typeof haulSchema>;

export const haulRequestSchema = z.object({ haul: haulSchema, requestId: z.string().uuid() }).strict();

/** Volume labels for an inclusive whole-number range, e.g. 4–8. The caller enforces the haul limit. */
export function volumeRange(from: number, to: number): string[] {
  if (!Number.isSafeInteger(from) || !Number.isSafeInteger(to) || from < 1 || to < from || to - from >= 1000) return [];
  return Array.from({ length: to - from + 1 }, (_, index) => String(from + index));
}
