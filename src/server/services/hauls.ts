import { itemSchema } from "../../domain/item.ts";
import { haulRequestSchema } from "../../domain/haul.ts";
import { statement as s, revision, revisionGuard } from "../db/store.ts";
import type { Store, Statement } from "../db/store.ts";
import { ApiError } from "../http/api.ts";
import { assertNoImport, planItem } from "./items.ts";

/**
 * Writes beyond this would risk D1's per-request query limit (planning also
 * reads); the client caps a save at HAUL_MAX_COPIES, which stays well under it.
 */
const HAUL_WRITE_BUDGET = 650;

/** Save every copy of one haul (or one part of it) atomically. */
export async function saveHaul(db: Store, raw: unknown) {
  await assertNoImport(db);
  const { haul, requestId } = haulRequestSchema.parse(raw);
  // The haul's shared details win over anything a copy carried.
  const items = haul.items.map((item) =>
    itemSchema.parse({
      ...item,
      acquiredOn: haul.acquiredOn,
      notes: haul.notes,
      notesPrivate: haul.private,
      acquisitionBatchId: haul.id,
    }),
  );
  const prefix = `haul:${requestId}:`;
  const previous = await db.all(
    "SELECT id FROM collection_items WHERE idempotency_key LIKE ? ORDER BY idempotency_key",
    [`${prefix}%`],
  );
  if (previous.length) {
    if (previous.length !== items.length)
      throw new ApiError(409, "An earlier version of this haul was already saved. Reload to see it.");
    return { haulId: haul.id, ids: previous.map((row) => String(row.id)), repeated: true };
  }
  const before = await revision(db);
  const writes: Statement[] = [
    s(
      `INSERT INTO acquisition_batches(id,acquired_on,store,store_private) VALUES (?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET acquired_on=excluded.acquired_on,store=excluded.store,store_private=excluded.store_private`,
      haul.id,
      haul.acquiredOn,
      haul.store,
      haul.private ? 1 : 0,
    ),
  ];
  const ids: string[] = [];
  for (const [index, item] of items.entries()) {
    const id = crypto.randomUUID();
    ids.push(id);
    writes.push(...(await planItem(db, item, id, { idempotencyKey: `${prefix}${String(index).padStart(2, "0")}` })));
  }
  if (writes.length > HAUL_WRITE_BUDGET)
    throw new ApiError(413, "This haul is too large to save in one step. Save fewer copies, then add the rest to the same haul.");
  try {
    await db.batch([revisionGuard(before), ...writes]);
  } catch (error) {
    if ((await revision(db)) !== before)
      throw new ApiError(409, "The collection changed while saving. Reload and try again.");
    throw error;
  }
  return { haulId: haul.id, ids, repeated: false };
}
