import type { Store } from "../db/store.ts";
import { ApiError } from "./api.ts";

export interface RateLimit {
  bucket: string;
  limit: number;
  windowMs: number;
}
// Counted before any provider work, so a burst of scans cannot exhaust a
// provider quota. Lookups served from the collection still count: they use D1.
export const SCAN_LIMITS: RateLimit[] = [
  { bucket: "scan-lookup:minute", limit: 30, windowMs: 60_000 },
  { bucket: "scan-lookup:hour", limit: 400, windowMs: 3_600_000 },
];

/** Fixed windows in D1. One atomic upsert per window, shared by every isolate. */
export async function enforceRateLimits(
  db: Store,
  limits: RateLimit[],
  now = Date.now(),
): Promise<void> {
  for (const { bucket, limit, windowMs } of limits) {
    const windowStart = Math.floor(now / windowMs) * windowMs;
    const row = (
      await db.all<{ count: number }>(
        `INSERT INTO request_limits(bucket,window_start,count) VALUES (?,?,1)
        ON CONFLICT(bucket) DO UPDATE SET
          count=CASE WHEN request_limits.window_start=excluded.window_start THEN request_limits.count+1 ELSE 1 END,
          window_start=excluded.window_start
        RETURNING count`,
        [bucket, windowStart],
      )
    )[0];
    if (Number(row?.count ?? 0) > limit) {
      const seconds = Math.max(1, Math.ceil((windowStart + windowMs - now) / 1000));
      throw new ApiError(
        429,
        `Too many lookups. Wait ${seconds} second${seconds === 1 ? "" : "s"} and scan again; manual entry is still available.`,
      );
    }
  }
}
