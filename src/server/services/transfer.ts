import { z } from "zod";
import { itemSchema, key } from "../../domain/item.ts";
import type { ItemInput } from "../../domain/item.ts";
import { parseCsv } from "../../domain/normalization/csv.ts";
import {
  correctRow,
  editionIdentity,
} from "../../domain/normalization/corrections.ts";
import { resolveNote, newNoteState } from "../../domain/normalization/notes.ts";
import { parseAcquiredOn } from "../../domain/normalization/dates.ts";
import { libraryData } from "./library.ts";
import { planItem, assertNoImport } from "./items.ts";
import { exportBackup, previewBackup, restoreBackup } from "./backup.ts";
import {
  digest,
  statement as s,
  revision,
  revisionGuard,
} from "../db/store.ts";
import type { Store, Statement } from "../db/store.ts";
import { ApiError } from "../http/api.ts";
import type { ImportPreview, ImportKind } from "../../domain/transfer.ts";
import { MEDIUM_LABELS } from "../../domain/types.ts";
import type { Medium } from "../../domain/types.ts";

// "Medium" accepts the exported labels and common shorthands; blank is manga.
function medium(value: string): Medium {
  const found = (
    {
      "": "manga",
      manga: "manga",
      "light novel": "light_novel",
      light_novel: "light_novel",
      ln: "light_novel",
      book: "book",
      novel: "book",
    } as Record<string, Medium>
  )[value.trim().toLowerCase()];
  if (!found) throw new Error("Medium must be Manga, Light novel or Book.");
  return found;
}

export const importSchema = z.object({
  kind: z.enum(["manga", "cd", "discogs", "json"]),
  filename: z.string().min(1).max(200),
  text: z.string().max(900000),
  discogsDateAddedAsAcquired: z.boolean().default(false),
});
interface PlannedRow {
  number: number;
  id: string;
  item: ItemInput;
  source: Record<string, string>;
  duplicate: boolean;
  existingId: boolean;
  errors: string[];
}
interface Plan {
  kind: ImportKind;
  filename: string;
  hash: string;
  revision: number;
  rows: PlannedRow[];
  warnings: string[];
  backup?: unknown;
}
const split = (text: string) =>
  text
    .split(" | ")
    .map((s) => s.trim())
    .filter(Boolean);
const date = (text: string) =>
  !text
    ? null
    : /^\d{4}-\d{2}-\d{2}$/.test(text)
      ? text
      : parseAcquiredOn(text);
const signature = (
  item: Pick<
    ItemInput,
    | "kind"
    | "title"
    | "volume"
    | "language"
    | "editionTitle"
    | "publisher"
    | "artists"
    | "labels"
    | "acquiredOn"
    | "notes"
    | "medium"
  >,
) =>
  JSON.stringify(
    item.kind === "manga"
      ? [
          "manga",
          key(item.title),
          key(item.editionTitle || item.title),
          item.volume,
          item.language,
          key(item.publisher),
          item.acquiredOn,
          item.notes || null,
          // A book and a manga volume of the same title are different copies.
          item.medium,
        ]
      : [
          "cd",
          key(item.title),
          item.artists.map(key).sort(),
          item.labels
            .map((l) => key(l.catalogNumber))
            .filter(Boolean)
            .sort(),
          item.acquiredOn,
          item.notes || null,
        ],
  );

export async function createImportPreview(
  db: Store,
  raw: unknown,
): Promise<ImportPreview> {
  const input = importSchema.parse(raw);
  await assertNoImport(db);
  const before = await revision(db),
    hash = await digest(
      `${input.kind}:${input.discogsDateAddedAsAcquired}:${input.text}`,
    );
  const plan: Plan = {
    kind: input.kind,
    filename: input.filename,
    hash,
    revision: before,
    rows: [],
    warnings: [],
  };
  let restoredCopies: number | undefined;
  if (input.kind === "json") {
    let parsed: unknown;
    try {
      parsed = JSON.parse(input.text);
    } catch {
      throw new ApiError(422, "Invalid backup JSON.");
    }
    const preview = await previewBackup(db, parsed);
    plan.backup = preview.backup;
    restoredCopies = preview.copies;
    plan.warnings.push(
      "Restoration preserves IDs, editions, dates, notes, tags, tracks and provenance. Matching rows are skipped; conflicting identities block restoration. R2 image bytes require a separate backup.",
    );
  } else {
    let records: string[][];
    try {
      records = parseCsv(input.text);
    } catch (error) {
      throw new ApiError(
        422,
        error instanceof Error ? error.message : "Invalid CSV.",
      );
    }
    const headers = records.shift()?.map((s) => s.trim()) ?? [];
    const required =
      input.kind === "manga"
        ? ["Title", "Volume", "Author", "Publisher", "Date Acquired", "Notes"]
        : input.kind === "discogs"
          ? ["Artist", "Title"]
          : ["Title", "Artist"];
    if (required.some((h) => !headers.includes(h)))
      throw new ApiError(422, `Required columns: ${required.join(", ")}.`);
    if (
      new Set(headers.filter(Boolean)).size !== headers.filter(Boolean).length
    )
      throw new ApiError(422, "CSV contains duplicate column headers.");
    if (records.length > 1000)
      throw new ApiError(413, "Import at most 1,000 CSV records at a time.");
    const library = await libraryData((sql) => db.all(sql)),
      signatures = new Set<string>(),
      ids = new Set<string>();
    for (const entry of library.entries)
      for (const copy of entry.copies) {
        ids.add(copy.id);
        if (entry.kind !== "cd" && "volume" in copy)
          signatures.add(
            signature({
              kind: "manga",
              title: entry.title,
              volume: copy.volume,
              language: copy.language,
              editionTitle: copy.editionTitle,
              publisher: copy.publisher,
              artists: [],
              labels: [],
              acquiredOn: copy.acquiredOn,
              notes: copy.notes,
              medium: copy.medium,
            }),
          );
        if (entry.kind === "cd")
          signatures.add(
            signature({
              kind: "cd",
              medium: "manga",
              title: entry.title,
              volume: "",
              language: "EN",
              editionTitle: entry.editionTitle ?? "",
              publisher: "",
              artists: entry.artists,
              labels: entry.catalogNumbers.map((c) => ({
                name: "",
                catalogNumber: c,
              })),
              acquiredOn: copy.acquiredOn,
              notes: copy.notes,
            }),
          );
      }
    const noteState = newNoteState();
    const fileIds = new Set<string>();
    for (const [index, values] of records.entries()) {
      const row = Object.fromEntries(
        headers
          .filter(Boolean)
          .map((header) => [
            header,
            values[headers.indexOf(header)]?.trim() ?? "",
          ]),
      );
      if (
        !values.some((v) => v.trim()) ||
        (input.kind === "manga" && required.every((h) => !row[h]))
      ) {
        Object.assign(noteState, newNoteState());
        continue;
      }
      const errors: string[] = [];
      let item = itemSchema.parse({
        kind: input.kind === "manga" ? "manga" : "cd",
        title: row.Title || "(missing title)",
      });
      try {
        if (values.length !== headers.length)
          throw new Error("Column count does not match the header.");
        const base: Record<string, unknown> = {
          kind: item.kind,
          title: row.Title,
          acquiredOn: date(row["Date Acquired"] ?? ""),
          notes: row.Notes || null,
          tags: split(row.Tags ?? ""),
          tagsMode: Object.hasOwn(row, "Tags") ? "manual" : "auto",
        };
        if (input.kind === "manga") {
          const corrected = correctRow({
            Title: row.Title!,
            Volume: row.Volume!,
            Author: row.Author!,
            Publisher: row.Publisher!,
            "Date Acquired": row["Date Acquired"]!,
            Notes: row.Notes!,
          });
          const identity = editionIdentity(corrected.row);
          const resolved = Object.hasOwn(row, "Copy ID")
            ? { note: row.Notes || null, warning: null }
            : resolveNote(
                row.Notes!,
                base.acquiredOn as string | null,
                noteState,
              );
          if (resolved.warning)
            throw new Error(
              "A note continuation has no matching earlier note.",
            );
          const ambiguousNumbering = /omnibus/i.test(resolved.note ?? "");
          Object.assign(base, {
            title: row["Canonical Title"] || identity.canonicalTitle,
            editionTitle: row["Edition Title"] || corrected.row.Title,
            volume: corrected.row.Volume.replace(/^vol(?:ume)?\.?\s*/i, ""),
            authors: split(corrected.row.Author),
            publisher: corrected.row.Publisher,
            language: row.Language || identity.language,
            languageBasis: row.Language ? "confirmed" : identity.languageBasis,
            format:
              row.Format ||
              (ambiguousNumbering
                ? "unknown"
                : /collector's edition/i.test(corrected.row.Title)
                  ? "collectors"
                  : corrected.row.Title === "Fruits Basket: Illustrations"
                    ? "artbook"
                    : corrected.row.Title === "Project SEKAI Comic Anthology"
                      ? "anthology"
                      : "standard"),
            numberingBasis:
              row["Numbering Basis"] ||
              (ambiguousNumbering ? "source_record" : "printed"),
            medium: medium(row.Medium ?? ""),
            aliases: row["Alternate Titles"]
              ? split(row["Alternate Titles"])
              : identity.canonicalTitle !== corrected.row.Title
                ? [corrected.row.Title]
                : [],
            notes: resolved.note,
          });
        } else {
          const formatText = row.Format || "CD";
          const formats = formatText
            .split(/\s*\+\s*|,\s*/)
            .map((f) => (["CD", "Blu-ray", "DVD"].includes(f) ? f : "other"));
          Object.assign(base, {
            artists: split(row.Artist || ""),
            editionTitle:
              row.Edition || (input.kind === "discogs" ? formatText : ""),
            releaseDate: row["Release Date"] || row.Released || null,
            labels: row["Labels JSON"]
              ? JSON.parse(row["Labels JSON"])
              : row.Label
                ? split(row.Label).map((name, i) => ({
                    name,
                    catalogNumber:
                      split(row["Catalog Number"] || row.Catalogno || "")[i] ??
                      "",
                  }))
                : [],
            media: row["Media JSON"]
              ? JSON.parse(row["Media JSON"])
              : formats.map((format, i) => ({
                  position: i + 1,
                  format,
                  title: "",
                })),
            tracks: row["Tracks JSON"] ? JSON.parse(row["Tracks JSON"]) : [],
          });
          if (input.kind === "discogs") {
            const added = row["Date Added"];
            if (added && input.discogsDateAddedAsAcquired)
              base.acquiredOn = date(added.slice(0, 10));
            const extras = Object.entries(row).filter(
              ([name, value]) =>
                value &&
                ![
                  "Artist",
                  "Title",
                  "Label",
                  "Catalogno",
                  "Format",
                  "Released",
                  "Notes",
                ].includes(name),
            );
            base.notes =
              [
                row.Notes,
                ...extras.map(([name, value]) => `Discogs ${name}: ${value}`),
              ]
                .filter(Boolean)
                .join("\n") || null;
          }
        }
        if (row["Artwork URL"])
          base.artwork = {
            url: row["Artwork URL"],
            scope: row["Artwork Scope"] || "representative",
            provider: "manual",
          };
        item = itemSchema.parse(base);
      } catch (error) {
        errors.push(
          error instanceof z.ZodError
            ? error.issues
                .map((i) => `${i.path.join(".")}: ${i.message}`)
                .join("; ")
            : error instanceof Error
              ? error.message
              : "Invalid record",
        );
      }
      const id =
        row["Copy ID"] ||
        `import-${(await digest(`${hash}:${index + 1}`)).slice(0, 32)}`;
      if (!/^[a-zA-Z0-9_-]{1,100}$/.test(id))
        errors.push("Copy ID contains invalid characters.");
      if (fileIds.has(id))
        errors.push("Copy ID appears more than once in this file.");
      fileIds.add(id);
      const sig = signature(item),
        existingId = ids.has(id),
        duplicate = existingId || signatures.has(sig);
      signatures.add(sig);
      plan.rows.push({
        number: index + 1,
        id,
        item,
        source: row,
        duplicate,
        existingId,
        errors,
      });
    }
    if (input.kind === "discogs")
      plan.warnings.push(
        "Discogs Date Added is kept in notes unless you explicitly map it to acquisition date. Unmapped source fields are preserved in notes; digital or unknown formats need review.",
      );
    plan.warnings.push(
      "Duplicate candidates are skipped by default. You can include them as separate physical copies; existing Copy IDs are always skipped.",
    );
  }
  if ((await revision(db)) !== before)
    throw new ApiError(409, "The collection changed. Preview again.");
  const token = crypto.randomUUID(),
    payload = JSON.stringify(plan);
  if (new TextEncoder().encode(payload).length > 1000000)
    throw new ApiError(
      413,
      "Preview is too large. Split this file into smaller imports.",
    );
  await db.batch([
    s(
      `INSERT INTO metadata_cache(cache_key,provider,adapter_version,payload_json,status,fetched_at,expires_at) VALUES (?,'import-preview','1',?,'ready',?,?)`,
      `import:${token}`,
      payload,
      new Date().toISOString(),
      new Date(Date.now() + 86400000).toISOString(),
    ),
  ]);
  return {
    token,
    kind: input.kind,
    total: plan.rows.length,
    duplicates: plan.rows.filter((r) => r.duplicate).length,
    errors: plan.rows.filter((r) => r.errors.length).length,
    rows: plan.rows.map((r) => ({
      number: r.number,
      title: r.item.title,
      volume: r.item.kind === "manga" ? r.item.volume : "",
      language: r.item.kind === "manga" ? r.item.language : "",
      acquiredOn: r.item.acquiredOn,
      duplicate: r.duplicate,
      existingId: r.existingId,
      errors: r.errors,
    })),
    warnings: plan.warnings,
    ...(restoredCopies === undefined ? {} : { restoredCopies }),
  };
}
async function loadPlan(db: Store, token: string): Promise<Plan> {
  z.string().uuid().parse(token);
  const row = (
    await db.all(
      "SELECT payload_json FROM metadata_cache WHERE cache_key=? AND provider=?",
      [`import:${token}`, "import-preview"],
    )
  )[0];
  if (!row)
    throw new ApiError(404, "Import preview expired. Preview the file again.");
  return JSON.parse(String(row.payload_json)) as Plan;
}
export async function commitImport(
  db: Store,
  token: string,
  includeDuplicates: boolean,
) {
  const plan = await loadPlan(db, token);
  if (plan.kind === "json")
    return restoreBackup(db, plan.backup, plan.revision);
  if (plan.rows.some((r) => r.errors.length))
    throw new ApiError(
      422,
      "Correct every invalid row and preview the file again.",
    );
  const batchId = `csv-${plan.hash}`,
    previous = (
      await db.all("SELECT * FROM import_batches WHERE id=?", [batchId])
    )[0];
  if (previous?.status === "complete")
    return {
      complete: true,
      added: 0,
      skipped: plan.rows.length,
      repeated: true,
    };
  const selection = includeDuplicates
    ? "include-duplicates"
    : "skip-duplicates";
  if (previous && previous.error_summary !== selection)
    throw new ApiError(409, "Resume with the original duplicate choice.");
  const rows = plan.rows.filter(
    (row) => !row.existingId && (includeDuplicates || !row.duplicate),
  );
  if (!previous || previous.status === "failed") {
    await assertNoImport(db);
    if ((await revision(db)) !== plan.revision)
      throw new ApiError(
        409,
        "The collection changed. Preview the file again.",
      );
    await db.batch([
      revisionGuard(plan.revision),
      s(
        `INSERT INTO import_batches(id,source_kind,source_filename,source_sha256,mapping_version,status,preview_revision,error_summary)
      VALUES (?,?,?,?,?,'committing',?,?) ON CONFLICT(id) DO UPDATE SET status='committing',preview_revision=excluded.preview_revision,error_summary=excluded.error_summary`,
        batchId,
        `stage3-${plan.kind}`,
        plan.filename,
        plan.hash,
        "1",
        plan.revision + 1,
        selection,
      ),
    ]);
  }
  const batch = (
    await db.all("SELECT * FROM import_batches WHERE id=?", [batchId])
  )[0]!;
  const existing = new Set(
    (
      await db.all("SELECT id FROM collection_items WHERE import_batch_id=?", [
        batchId,
      ])
    ).map((r) => String(r.id)),
  );
  const pending: PlannedRow[] = [];
  let cost = 0;
  for (const row of rows.filter((row) => !existing.has(row.id))) {
    const estimate =
      30 +
      row.item.tracks.length +
      row.item.media.length +
      row.item.authors.length * 3 +
      row.item.artists.length * 3 +
      row.item.labels.length * 4 +
      row.item.tags.length * 3;
    if (pending.length && (cost + estimate > 300 || pending.length >= 5)) break;
    pending.push(row);
    cost += estimate;
  }
  const writes: Statement[] = [];
  for (const row of pending) {
    writes.push(
      ...(await planItem(db, row.item, row.id, {
        batchId,
        idempotencyKey: `csv:${plan.hash}:${row.number}`,
        preserveCatalog: true,
      })),
    );
    writes.push(
      s(
        `INSERT INTO import_records(id,batch_id,source_record_number,item_id,source_row_json,normalization_audit_json,status,issue_codes_json)
      VALUES (?,?,?,?,?,?,'imported','[]')`,
        `${batchId}-${row.number}`,
        batchId,
        row.number,
        row.id,
        JSON.stringify(row.source),
        JSON.stringify({
          mapping: "stage3-v1",
          filename: plan.filename,
          normalized: row.item,
        }),
      ),
    );
  }
  if (writes.length)
    await db.batch([
      revisionGuard(Number(batch.preview_revision), false),
      ...writes,
    ]);
  const count = Number(
    (
      await db.all(
        "SELECT COUNT(*) AS n FROM collection_items WHERE import_batch_id=?",
        [batchId],
      )
    )[0]!.n,
  );
  if (count === rows.length) {
    const invalid = await db.all(
      `SELECT i.id FROM collection_items i LEFT JOIN volumes v ON v.item_id=i.id LEFT JOIN cds c ON c.item_id=i.id WHERE i.import_batch_id=? AND ((i.media_kind='manga' AND v.item_id IS NULL) OR (i.media_kind='cd' AND c.item_id IS NULL))`,
      [batchId],
    );
    if (invalid.length)
      throw new ApiError(
        409,
        "Import has incomplete copies. Resume before finalizing.",
      );
    await db.batch([
      revisionGuard(Number(batch.preview_revision)),
      s(
        "UPDATE import_batches SET status='complete',updated_at=? WHERE id=?",
        new Date().toISOString(),
        batchId,
      ),
    ]);
  }
  return {
    complete: count === rows.length,
    added: count,
    total: rows.length,
    skipped: plan.rows.length - rows.length,
  };
}
export async function cancelImport(db: Store, token: string) {
  const plan = await loadPlan(db, token),
    batchId = `csv-${plan.hash}`;
  const batch = (
    await db.all(
      "SELECT * FROM import_batches WHERE id=? AND status='committing'",
      [batchId],
    )
  )[0];
  if (batch)
    await db.batch([
      revisionGuard(Number(batch.preview_revision)),
      s("DELETE FROM import_records WHERE batch_id=?", batchId),
      ...["item_tags", "volumes", "cds"].map((table) =>
        s(
          `DELETE FROM ${table} WHERE item_id IN (SELECT id FROM collection_items WHERE import_batch_id=?)`,
          batchId,
        ),
      ),
      s("DELETE FROM collection_items WHERE import_batch_id=?", batchId),
      s("UPDATE import_batches SET status='failed' WHERE id=?", batchId),
    ]);
  return { cancelled: true };
}
export async function pendingImport(db: Store) {
  const rows =
    await db.all(`SELECT m.cache_key,b.source_filename,b.error_summary FROM import_batches b JOIN metadata_cache m
    ON m.provider='import-preview' AND json_extract(m.payload_json,'$.hash')=b.source_sha256
    AND json_extract(m.payload_json,'$.revision')=b.preview_revision-1 WHERE b.status='committing' ORDER BY m.fetched_at DESC LIMIT 1`);
  const row = rows[0];
  return row
    ? {
        token: String(row.cache_key).slice(7),
        filename: String(row.source_filename),
        includeDuplicates: row.error_summary === "include-duplicates",
      }
    : null;
}
const cell = (value: unknown) => {
  const text = value == null ? "" : String(value);
  // CSV is spreadsheet-safe; JSON is the lossless backup for formula-like text.
  const safe = /^[\s]*[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return `"${safe.replaceAll('"', '""')}"`;
};
export async function exportCsv(
  db: Store,
  kind: "manga" | "cd",
  includeSamples = false,
) {
  await assertNoImport(db);
  const before = await revision(db);
  const headers =
    kind === "manga"
      ? [
          "Copy ID",
          "Title",
          "Volume",
          "Author",
          "Publisher",
          "Date Acquired",
          "Notes",
          "Canonical Title",
          "Edition Title",
          "Language",
          "Format",
          "Numbering Basis",
          "Medium",
          "Alternate Titles",
          "Tags",
          "Artwork URL",
          "Artwork Scope",
        ]
      : [
          "Copy ID",
          "Title",
          "Artist",
          "Date Acquired",
          "Notes",
          "Release Date",
          "Edition",
          "Label",
          "Catalog Number",
          "Format",
          "Labels JSON",
          "Media JSON",
          "Tracks JSON",
          "Tags",
          "Artwork URL",
          "Artwork Scope",
        ];
  const rows = [headers.map(cell).join(",")];
  const [library, releaseLabels, releaseMedia] = await Promise.all([
    libraryData((sql) => db.all(sql)),
    db.all(
      "SELECT rl.release_id,l.name,rl.catalog_number FROM release_labels rl JOIN labels l ON l.id=rl.label_id ORDER BY rl.credit_order",
    ),
    db.all(
      "SELECT release_id,position,format,COALESCE(title,'') AS title FROM release_media ORDER BY position",
    ),
  ]);
  for (const entry of library.entries) {
    // The volume CSV carries manga, light novels and books (see Medium).
    if ((kind === "cd") !== (entry.kind === "cd")) continue;
    if (entry.kind !== "cd")
      for (const copy of entry.copies) {
        rows.push(
          [
            copy.id,
            copy.editionTitle || entry.title,
            copy.volume,
            entry.authors.join(" | "),
            copy.publisher,
            copy.acquiredOn,
            copy.notes,
            entry.title,
            copy.editionTitle,
            copy.language,
            copy.format,
            copy.numberingBasis,
            MEDIUM_LABELS[copy.medium],
            entry.aliases.join(" | "),
            copy.tags.join(" | "),
            copy.artwork?.sourceUrl,
            copy.artwork?.scope,
          ]
            .map(cell)
            .join(","),
        );
      }
    if (entry.kind === "cd") {
      const labels = releaseLabels.filter(
        (label) => label.release_id === entry.releaseId,
      );
      const media = releaseMedia
        .filter((medium) => medium.release_id === entry.releaseId)
        .map(({ release_id, ...medium }) => medium);
      for (const copy of entry.copies) {
        if (copy.isSample && !includeSamples) continue;
        rows.push(
          [
            copy.id,
            entry.title,
            entry.artists.join(" | "),
            copy.acquiredOn,
            copy.notes,
            entry.releaseDate,
            entry.editionTitle,
            labels.map((label) => label.name).join(" | "),
            labels.map((label) => label.catalog_number ?? "").join(" | "),
            media.map((m) => m.format).join(" + "),
            JSON.stringify(
              labels.map((label) => ({
                name: label.name,
                catalogNumber: label.catalog_number ?? "",
              })),
            ),
            JSON.stringify(media),
            JSON.stringify(entry.tracks),
            (copy.tags ?? []).join(" | "),
            entry.artwork?.sourceUrl,
            entry.artwork?.scope,
          ]
            .map(cell)
            .join(","),
        );
      }
    }
  }
  if ((await revision(db)) !== before)
    throw new ApiError(409, "Collection changed during export. Retry.");
  return "\uFEFF" + rows.join("\r\n") + "\r\n";
}
export { exportBackup };
