import { getTableConfig } from "drizzle-orm/sqlite-core";
import * as schema from "../db/schema/index.ts";
import { statement as s, revision, revisionGuard } from "../db/store.ts";
import type { Store, Value } from "../db/store.ts";
import { ApiError } from "../http/api.ts";
import { assertNoImport } from "./items.ts";
import { z } from "zod";
import { publicImageUrl } from "../../domain/item.ts";

// Dependency order; caches, transient provider leases and collection revision
// are operational state and are intentionally excluded from portable backups.
const tables = [
  schema.coverAssets,
  schema.coverVariants,
  schema.creators,
  schema.publishers,
  schema.labels,
  schema.series,
  schema.seriesAliases,
  schema.seriesCreators,
  schema.editionRuns,
  schema.volumeEditions,
  schema.albums,
  schema.albumCreators,
  schema.albumReleases,
  schema.releaseLabels,
  schema.releaseMedia,
  schema.tracks,
  schema.importBatches,
  schema.collectionItems,
  schema.volumes,
  schema.cds,
  schema.tags,
  schema.itemTags,
  schema.importRecords,
  schema.externalRefs,
];
export const backupTables = tables.map((table) => {
  const config = getTableConfig(table);
  return {
    name: config.name,
    columns: config.columns.map((c) => c.name),
    keys: config.columns
      .filter((c) => c.primary)
      .map((c) => c.name)
      .concat(config.primaryKeys.flatMap((p) => p.columns.map((c) => c.name))),
  };
});
const row = z.record(
  z.union([z.string().max(100000), z.number().finite(), z.null()]),
);
/** Columns added by later migrations, with the default older rows receive. */
const addedColumns: Record<string, Record<string, Value>> = {
  edition_runs: { medium: "manga" },
  volume_editions: { book_title: "" },
};
export const backupSchema = z
  .object({
    format: z.literal("strawby-collection"),
    version: z.literal(1),
    exportedAt: z.string(),
    tables: z.record(z.array(row).max(20000)),
  })
  .strict();
export type Backup = z.infer<typeof backupSchema>;
export async function exportBackup(db: Store): Promise<Backup> {
  await assertNoImport(db);
  const before = await revision(db),
    data: Backup["tables"] = {};
  for (const table of backupTables)
    data[table.name] = (await db.all(
      `SELECT * FROM ${table.name} ORDER BY ${table.keys.join(",")}`,
    )) as Record<string, Value>[];
  if ((await revision(db)) !== before)
    throw new ApiError(409, "The collection changed during export. Retry.");
  return {
    format: "strawby-collection",
    version: 1,
    exportedAt: new Date().toISOString(),
    tables: data,
  };
}
const canonical = (value: Record<string, Value>, columns: string[]) =>
  JSON.stringify(columns.map((column) => value[column] ?? null));
export async function previewBackup(db: Store, raw: unknown) {
  const backup = backupSchema.parse(raw),
    additions: Backup["tables"] = {};
  let skipped = 0;
  if (
    Object.keys(backup.tables).sort().join() !==
    backupTables
      .map((t) => t.name)
      .sort()
      .join()
  )
    throw new ApiError(
      422,
      "Backup must contain the complete version 1 table set.",
    );
  for (const table of backupTables) {
    const existing = (await db.all(`SELECT * FROM ${table.name}`)) as Record<
      string,
      Value
    >[];
    const indexed = new Map(existing.map((r) => [canonical(r, table.keys), r]));
    const seen = new Set<string>();
    additions[table.name] = [];
    for (const raw of backup.tables[table.name]!) {
      // Version 1 backups made before a later additive column get its default.
      const value = { ...(addedColumns[table.name] ?? {}), ...raw };
      if (table.name === "volume_editions" && raw.book_title === undefined &&
        typeof value.volume_label === "string" && /[^0-9]/.test(value.volume_label) &&
        backup.tables.edition_runs?.some(run => run.id === value.edition_run_id && run.medium === "book")) {
        value.book_title = value.volume_label;
        value.volume_label = "";
        value.volume_sort = null;
      }
      if (Object.keys(value).sort().join() !== [...table.columns].sort().join())
        throw new ApiError(422, `Invalid columns in ${table.name}.`);
      const id = canonical(value, table.keys);
      if (seen.has(id))
        throw new ApiError(422, `Duplicate identity in ${table.name}.`);
      seen.add(id);
      const match = indexed.get(id);
      if (match) {
        if (canonical(match, table.columns) !== canonical(value, table.columns))
          throw new ApiError(
            409,
            `Backup conflicts with existing ${table.name} data. Restore into an empty database to recover that snapshot; existing records will not be overwritten.`,
          );
        skipped++;
      } else additions[table.name]!.push(value);
    }
  }
  const batches = backup.tables.import_batches!;
  for (const asset of backup.tables.cover_assets!)
    if (asset.source_url !== null && !publicImageUrl(String(asset.source_url)))
      throw new ApiError(422, "Backup contains an unsafe artwork URL.");
  for (const variant of backup.tables.cover_variants!) {
    if (
      variant.external_url !== null &&
      !publicImageUrl(String(variant.external_url))
    )
      throw new ApiError(422, "Backup contains an unsafe external image URL.");
    if (
      variant.object_key !== null &&
      !/^covers\/[a-f0-9]{64}$/.test(String(variant.object_key))
    )
      throw new ApiError(422, "Backup contains an invalid artwork object key.");
  }
  if (batches.some((batch) => batch.status === "committing"))
    throw new ApiError(
      422,
      "Finish or cancel in-progress imports before backing up.",
    );
  const items = backup.tables.collection_items!,
    manga = backup.tables.volumes!,
    cds = backup.tables.cds!;
  const countByItem = (rows: Record<string, Value>[]) => {
    const counts = new Map<Value, number>();
    for (const row of rows) counts.set(row.item_id!, (counts.get(row.item_id!) ?? 0) + 1);
    return counts;
  };
  const mangaCounts = countByItem(manga), cdCounts = countByItem(cds);
  for (const item of items) {
    if (
      (mangaCounts.get(item.id!) ?? 0) !==
        Number(item.media_kind === "manga") ||
      (cdCounts.get(item.id!) ?? 0) !==
        Number(item.media_kind === "cd")
    )
      throw new ApiError(
        422,
        "Backup has an incomplete or mismatched physical copy.",
      );
  }
  return {
    backup,
    additions,
    skipped,
    copies: additions.collection_items!.length,
  };
}
export async function restoreBackup(
  db: Store,
  raw: unknown,
  expectedRevision: number,
) {
  await assertNoImport(db);
  const preview = await previewBackup(db, raw);
  if (Object.values(preview.additions).every((rows) => !rows.length))
    return { complete: true, added: 0, skipped: preview.skipped };
  if ((await revision(db)) !== expectedRevision)
    throw new ApiError(
      409,
      "The collection changed. Preview the backup again.",
    );
  // Bounded JSON parameters respect D1 value limits. Every table/chunk still
  // restores in one atomic batch, including the revision and FK/CHECK guards.
  const writes = backupTables
    .filter((table) => preview.additions[table.name]!.length)
    .flatMap((table) => chunkRows(preview.additions[table.name]!).map(chunk =>
      s(
        `INSERT INTO ${table.name}(${table.columns.join(",")}) SELECT ${table.columns.map((c) => `json_extract(value,'$.${c}')`).join(",")} FROM json_each(?)`,
        JSON.stringify(chunk),
      )),
    );
  try {
    await db.batch([revisionGuard(expectedRevision), ...writes]);
  } catch {
    throw new ApiError(
      409,
      "Backup restoration failed integrity or concurrency checks. No backup rows were committed.",
    );
  }
  return { complete: true, added: preview.copies, skipped: preview.skipped };
}

// Keep each bound value well below D1's 2 MB row/string limit, including UTF-8.
function chunkRows(rows: Record<string, Value>[]) {
  const chunks: Record<string, Value>[][] = [];
  let chunk: Record<string, Value>[] = [], bytes = 2;
  for (const row of rows) {
    const size = new TextEncoder().encode(JSON.stringify(row)).length + 1;
    if (size > 900000) throw new ApiError(413, "A backup row exceeds the restore limit.");
    if (bytes + size > 900000 && chunk.length) { chunks.push(chunk); chunk = []; bytes = 2; }
    chunk.push(row); bytes += size;
  }
  if (chunk.length) chunks.push(chunk);
  return chunks;
}
