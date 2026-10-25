import { itemSchema, key, memoryTags } from "../../domain/item.ts";
import type { ItemInput, ArtworkInput } from "../../domain/item.ts";
import {
  statement as s,
  digest,
  revision,
  revisionGuard,
} from "../db/store.ts";
import type { Store, Statement } from "../db/store.ts";
import { ApiError } from "../http/api.ts";

const idFor = async (kind: string, value: unknown) =>
  `${kind}-${(await digest(JSON.stringify(value))).slice(0, 32)}`;
export async function getItem(
  db: Store,
  id: string,
): Promise<{ item: ItemInput; version: number }> {
  const row = (
    await db.all(
      `SELECT i.* FROM collection_items i LEFT JOIN import_batches b ON b.id=i.import_batch_id
    WHERE i.id=? AND (b.id IS NULL OR b.status='complete')`,
      [id],
    )
  )[0];
  if (!row) throw new ApiError(404, "This copy no longer exists.");
  const tags = await db.all(
    "SELECT t.label,it.source FROM item_tags it JOIN tags t ON t.id=it.tag_id WHERE it.item_id=? ORDER BY t.label",
    [id],
  );
  const base = {
    kind: row.media_kind,
    acquiredOn: row.acquired_on,
    notes: row.notes,
    notesPrivate: row.notes_private !== 0,
    acquisitionBatchId: row.acquisition_batch_id ?? null,
    isSample: row.is_sample === 1,
    tags: [
      ...new Set(
        tags.filter((t) => t.source === "manual").map((t) => String(t.label)),
      ),
    ],
    tagsMode:
      tags.some((t) => t.source === "derived") ||
      (!tags.length && !memoryTags(row.notes as string | null).length)
        ? "auto"
        : "manual",
  };
  let data: Record<string, unknown>, cover: unknown;
  if (row.media_kind === "manga") {
    const r = (
      await db.all(
        `SELECT s.id AS seriesId,s.canonical_title AS title,r.edition_title AS editionTitle,
      r.language,r.language_basis AS languageBasis,r.format,r.numbering_basis AS numberingBasis,r.medium,
      COALESCE(p.name,'') AS publisher,e.volume_label AS volume,e.cover_asset_id AS cover,e.isbn13
      FROM volumes v JOIN volume_editions e ON e.id=v.volume_edition_id JOIN edition_runs r ON r.id=e.edition_run_id
      JOIN series s ON s.id=r.series_id LEFT JOIN publishers p ON p.id=r.publisher_id WHERE v.item_id=?`,
        [id],
      )
    )[0]!;
    data = {
      ...base,
      ...r,
      authors: (
        await db.all(
          "SELECT c.display_name FROM series_creators sc JOIN creators c ON c.id=sc.creator_id WHERE sc.series_id=? ORDER BY sc.credit_order",
          [String(r.seriesId)],
        )
      ).map((c) => c.display_name),
      aliases: [
        ...new Set(
          (
            await db.all(
              "SELECT title FROM series_aliases WHERE series_id=? ORDER BY title",
              [String(r.seriesId)],
            )
          ).map((a) => a.title),
        ),
      ],
    };
    cover = r.cover;
  } else {
    const r = (
      await db.all(
        `SELECT a.title,a.id AS albumId,r.id AS releaseId,r.release_date AS releaseDate,
      COALESCE(r.edition_title,'') AS editionTitle,r.cover_asset_id AS cover FROM cds c JOIN album_releases r ON r.id=c.release_id
      JOIN albums a ON a.id=r.album_id WHERE c.item_id=?`,
        [id],
      )
    )[0]!;
    data = {
      ...base,
      ...r,
      artists: (
        await db.all(
          "SELECT c.display_name FROM album_creators ac JOIN creators c ON c.id=ac.creator_id WHERE ac.album_id=? ORDER BY ac.credit_order",
          [String(r.albumId)],
        )
      ).map((c) => c.display_name),
      labels: await db.all(
        "SELECT l.name,COALESCE(rl.catalog_number,'') AS catalogNumber FROM release_labels rl JOIN labels l ON l.id=rl.label_id WHERE rl.release_id=? ORDER BY rl.credit_order",
        [String(r.releaseId)],
      ),
      media: await db.all(
        "SELECT position,format,COALESCE(title,'') AS title FROM release_media WHERE release_id=? ORDER BY position",
        [String(r.releaseId)],
      ),
      tracks: await db.all(
        "SELECT m.position AS medium,t.position,t.title,t.duration_ms AS durationMs FROM tracks t JOIN release_media m ON m.id=t.medium_id WHERE m.release_id=? ORDER BY m.position,t.position",
        [String(r.releaseId)],
      ),
    };
    cover = r.cover;
  }
  data.artwork = cover
    ? ((
        await db.all(
          `SELECT a.source_url AS url,a.match_scope AS scope,a.provider,COALESCE(a.source_record_id,'') AS sourceId,
    COALESCE(a.attribution,'') AS attribution,a.source_language AS language FROM cover_assets a WHERE a.id=?`,
          [String(cover)],
        )
      )[0] ?? null)
    : null;
  return { item: itemSchema.parse(data), version: Number(row.version) };
}

async function named(
  db: Store,
  statements: Statement[],
  table: "publishers" | "labels",
  name: string,
): Promise<string | null> {
  if (!name) return null;
  const normalized = key(name);
  const existing = (
    await db.all(`SELECT id FROM ${table} WHERE normalized_name=?`, [
      normalized,
    ])
  )[0];
  const id = String(existing?.id ?? (await idFor(table, normalized)));
  statements.push(
    s(
      `INSERT INTO ${table}(id,name,normalized_name) VALUES (?,?,?) ON CONFLICT(normalized_name) DO NOTHING`,
      id,
      name,
      normalized,
    ),
  );
  return id;
}
async function credits(
  db: Store,
  statements: Statement[],
  table: "series_creators" | "album_creators",
  parent: string,
  names: string[],
) {
  const parentColumn = table === "series_creators" ? "series_id" : "album_id";
  statements.push(s(`DELETE FROM ${table} WHERE ${parentColumn}=?`, parent));
  for (const [index, name] of [...new Set(names)].entries()) {
    const existing = (
      await db.all(
        "SELECT id FROM creators WHERE search_key=? ORDER BY id LIMIT 1",
        [key(name)],
      )
    )[0];
    const id = String(existing?.id ?? (await idFor("creator", key(name))));
    statements.push(
      s(
        "INSERT INTO creators(id,display_name,search_key,kind) VALUES (?,?,?,'unknown') ON CONFLICT(id) DO NOTHING",
        id,
        name,
        key(name),
      ),
    );
    statements.push(
      s(
        `INSERT INTO ${table}(${parentColumn},creator_id,role,credit_order) VALUES (?,?,?,?)`,
        parent,
        id,
        table === "series_creators" ? "author" : "artist",
        index,
      ),
    );
  }
}
export async function artworkStatements(
  art: ArtworkInput | null,
  ownerSelected = true,
): Promise<{ id: string | null; statements: Statement[] }> {
  if (!art) return { id: null, statements: [] };
  const id = await idFor("cover", art);
  return {
    id,
    statements: [
      s(
        `INSERT INTO cover_assets(id,provider,source_url,source_record_id,storage_mode,status,match_scope,source_language,fetched_at,policy_version,attribution,is_owner_selected)
      VALUES (?,?,?,?,'external','ready',?,?,?,'stage3-v1',?,?) ON CONFLICT(id) DO NOTHING`,
        id,
        art.provider,
        art.url,
        art.sourceId || null,
        art.scope,
        art.language,
        new Date().toISOString(),
        art.attribution,
        ownerSelected ? 1 : 0,
      ),
      s(
        `INSERT INTO cover_variants(id,cover_asset_id,variant,external_url,mime_type) VALUES (?,?,'original',?,'image/jpeg') ON CONFLICT(cover_asset_id,variant) DO NOTHING`,
        `${id}-original`,
        id,
        art.url,
      ),
    ],
  };
}

// Builds catalog and copy writes; callers execute them in an atomic D1 batch.
export async function planItem(
  db: Store,
  item: ItemInput,
  id: string,
  options: {
    update?: boolean;
    batchId?: string;
    idempotencyKey?: string;
    preserveCatalog?: boolean;
  } = {},
) {
  const statements: Statement[] = [];
  const cover = await artworkStatements(item.artwork);
  statements.push(...cover.statements);
  let coverId = cover.id;
  let target: string;
  if (item.kind === "manga") {
    let seriesId = item.seriesId;
    if (
      seriesId &&
      !(await db.all("SELECT id FROM series WHERE id=?", [seriesId])).length
    )
      throw new ApiError(422, "The selected series no longer exists.");
    seriesId ??= String(
      (
        await db.all(
          "SELECT id FROM series WHERE lower(canonical_title)=? ORDER BY id LIMIT 1",
          [key(item.title)],
        )
      )[0]?.id ?? (await idFor("series", key(item.title))),
    );
    const existingSeries = (
      await db.all("SELECT id,canonical_title FROM series WHERE id=?", [
        seriesId,
      ])
    )[0];
    const preserveCatalog = options.preserveCatalog || !options.update;
    if (existingSeries && !preserveCatalog) {
      const previousAuthors = (
        await db.all(
          "SELECT c.display_name FROM series_creators sc JOIN creators c ON c.id=sc.creator_id WHERE sc.series_id=? ORDER BY sc.credit_order",
          [seriesId],
        )
      ).map((c) => c.display_name);
      const previousAliases = (
        await db.all("SELECT title FROM series_aliases WHERE series_id=?", [
          seriesId,
        ])
      ).map((a) => String(a.title));
      const aliasesChanged =
        JSON.stringify([...new Set(previousAliases.map(key))].sort()) !==
        JSON.stringify([...new Set(item.aliases.map(key))].sort());
      if (
        existingSeries.canonical_title !== item.title ||
        JSON.stringify(previousAuthors) !== JSON.stringify(item.authors) ||
        aliasesChanged
      ) {
        statements.push(
          s(
            `UPDATE collection_items SET version=version+1,updated_at=? WHERE id<>? AND id IN
          (SELECT v.item_id FROM volumes v JOIN volume_editions e ON e.id=v.volume_edition_id JOIN edition_runs r ON r.id=e.edition_run_id WHERE r.series_id=?)`,
            new Date().toISOString(),
            id,
            seriesId,
          ),
        );
      }
      if (aliasesChanged)
        statements.push(
          s("DELETE FROM series_aliases WHERE series_id=?", seriesId),
        );
    }
    statements.push(
      s(
        `INSERT INTO series(id,canonical_title,sort_title) VALUES (?,?,?) ON CONFLICT(id) ${preserveCatalog ? "DO NOTHING" : "DO UPDATE SET canonical_title=excluded.canonical_title,sort_title=excluded.sort_title"}`,
        seriesId,
        item.title,
        key(item.title),
      ),
    );
    if (!preserveCatalog || !existingSeries)
      await credits(db, statements, "series_creators", seriesId, item.authors);
    for (const alias of [...new Set(item.aliases)])
      statements.push(
        s(
          `INSERT INTO series_aliases(id,series_id,title,search_key,kind) VALUES (?,?,?,?,'legacy') ON CONFLICT(series_id,search_key,kind) DO NOTHING`,
          await idFor("alias", [seriesId, key(alias)]),
          seriesId,
          alias,
          key(alias),
        ),
      );
    const publisher = await named(db, statements, "publishers", item.publisher);
    const editionTitle = item.editionTitle || item.title;
    // Medium belongs to the edition. Changing only the medium of a copy
    // reclassifies its whole edition in place, like a shared series edit.
    const current = options.update
      ? (
          await db.all(
            `SELECT r.* FROM volumes v JOIN volume_editions e ON e.id=v.volume_edition_id
          JOIN edition_runs r ON r.id=e.edition_run_id WHERE v.item_id=?`,
            [id],
          )
        )[0]
      : undefined;
    const reclassify =
      current &&
      current.medium !== item.medium &&
      current.series_id === seriesId &&
      current.edition_title === editionTitle &&
      current.language === item.language &&
      current.publisher_id === publisher &&
      current.format === item.format &&
      current.numbering_basis === item.numberingBasis &&
      current.language_basis === item.languageBasis
        ? String(current.id)
        : null;
    const existingRun = (
      await db.all(
        `SELECT id FROM edition_runs WHERE series_id=? AND edition_title=? AND language=? AND publisher_id IS ? AND format=? AND numbering_basis=? AND language_basis=? AND medium=? LIMIT 1`,
        [
          seriesId,
          editionTitle,
          item.language,
          publisher,
          item.format,
          item.numberingBasis,
          item.languageBasis,
          item.medium,
        ],
      )
    )[0];
    const run = String(
      reclassify ??
        existingRun?.id ??
        (await idFor("run", [
          seriesId,
          editionTitle,
          item.language,
          publisher,
          item.format,
          item.numberingBasis,
          item.languageBasis,
          // Manga identities predate the medium column and stay unchanged.
          ...(item.medium === "manga" ? [] : [item.medium]),
        ])),
    );
    statements.push(
      s(
        `INSERT INTO edition_runs(id,series_id,edition_title,language,language_basis,publisher_id,format,numbering_basis,numbering_verified,medium)
      VALUES (?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING`,
        run,
        seriesId,
        editionTitle,
        item.language,
        item.languageBasis,
        publisher,
        item.format,
        item.numberingBasis,
        item.numberingBasis === "printed" ? 1 : 0,
        item.medium,
      ),
    );
    if (reclassify) {
      // Unattended covers were matched for the old medium (for example a manga
      // cover on a light novel), so they are cleared; owner choices remain.
      // Compare with the copy's stored cover rather than a re-derived id.
      const stored = (
        await db.all(
          `SELECT a.source_url,a.is_owner_selected FROM volumes v JOIN volume_editions e ON e.id=v.volume_edition_id
          JOIN cover_assets a ON a.id=e.cover_asset_id WHERE v.item_id=?`,
          [id],
        )
      )[0];
      if (
        stored?.is_owner_selected === 0 &&
        item.artwork?.url === stored.source_url
      )
        coverId = null;
      statements.push(
        s("UPDATE edition_runs SET medium=? WHERE id=?", item.medium, run),
        s(
          `UPDATE volume_editions SET cover_asset_id=NULL WHERE edition_run_id=?
        AND cover_asset_id IN (SELECT id FROM cover_assets WHERE is_owner_selected=0)`,
          run,
        ),
        s(
          `UPDATE collection_items SET version=version+1,updated_at=? WHERE id<>? AND id IN
        (SELECT v.item_id FROM volumes v JOIN volume_editions e ON e.id=v.volume_edition_id WHERE e.edition_run_id=?)`,
          new Date().toISOString(),
          id,
          run,
        ),
      );
    }
    const existingEdition = (
      await db.all(
        "SELECT id,cover_asset_id,isbn13 FROM volume_editions WHERE edition_run_id=? AND volume_label=? LIMIT 1",
        [run, item.volume],
      )
    )[0];
    target = String(
      existingEdition?.id ?? (await idFor("volume", [run, key(item.volume)])),
    );
    // An ISBN belongs to the volume edition, so every copy shares it. Adding a
    // copy never replaces a different recorded ISBN; the owner decides instead.
    const recordedIsbn = (existingEdition?.isbn13 as string | null) ?? null;
    if (!options.update && item.isbn13 && recordedIsbn && recordedIsbn !== item.isbn13)
      throw new ApiError(
        409,
        `Volume ${item.volume} of this edition already records ISBN ${recordedIsbn}. A different ISBN usually means another printing or edition: change the edition name, or correct the ISBN.`,
      );
    const isbnChanged = options.update
      ? recordedIsbn !== item.isbn13
      : Boolean(item.isbn13 && !recordedIsbn);
    if (
      existingEdition &&
      (((options.update || item.artwork) &&
        existingEdition.cover_asset_id !== coverId) ||
        isbnChanged)
    ) {
      statements.push(
        s(
          "UPDATE collection_items SET version=version+1,updated_at=? WHERE id<>? AND id IN (SELECT item_id FROM volumes WHERE volume_edition_id=?)",
          new Date().toISOString(),
          id,
          target,
        ),
      );
    }
    const updates = [
      ...(options.update || item.artwork
        ? ["cover_asset_id=excluded.cover_asset_id"]
        : []),
      ...(options.update
        ? ["isbn13=excluded.isbn13"]
        : item.isbn13
          ? ["isbn13=COALESCE(volume_editions.isbn13,excluded.isbn13)"]
          : []),
    ];
    statements.push(
      s(
        `INSERT INTO volume_editions(id,edition_run_id,volume_label,volume_sort,numbering_key,cover_asset_id,isbn13) VALUES (?,?,?,?,?,?,?)
      ON CONFLICT(id) ${updates.length ? `DO UPDATE SET ${updates.join(",")}` : "DO NOTHING"}`,
        target,
        run,
        item.volume,
        /^\d+$/.test(item.volume) ? Number(item.volume) * 1000 : null,
        key(item.volume),
        coverId,
        item.isbn13,
      ),
    );
    if (item.catalogSource)
      statements.push(
        s(
          `INSERT INTO external_refs(id,provider,provider_entity_type,external_id,source_url,fetched_at,match_basis,is_owner_confirmed,volume_edition_id)
        VALUES (?,?,'edition',?,?,?,'isbn',1,?) ON CONFLICT DO NOTHING`,
          await idFor("ref", [item.catalogSource.provider, "edition", item.catalogSource.sourceId]),
          item.catalogSource.provider,
          item.catalogSource.sourceId,
          item.catalogSource.sourceUrl,
          new Date().toISOString(),
          target,
        ),
      );
  } else {
    // Album/release identities include editable catalog data. Changing one physical
    // copy's release never silently edits the metadata of its other owned copies.
    const album = await idFor("album", [
      key(item.title),
      item.artists.map(key),
    ]);
    statements.push(
      s(
        "INSERT INTO albums(id,title,sort_title) VALUES (?,?,?) ON CONFLICT(id) DO NOTHING",
        album,
        item.title,
        key(item.title),
      ),
    );
    await credits(db, statements, "album_creators", album, item.artists);
    target = await idFor("release", [
      album,
      item.editionTitle,
      item.releaseDate,
      item.labels,
      item.media,
      item.tracks,
      cover.id,
    ]);
    statements.push(
      s(
        `INSERT INTO album_releases(id,album_id,edition_title,release_date,date_precision,cover_asset_id,metadata_state)
      VALUES (?,?,?,?,?,?,'partial') ON CONFLICT(id) DO NOTHING`,
        target,
        album,
        item.editionTitle || null,
        item.releaseDate,
        item.releaseDate
          ? ({ 4: "year", 7: "month", 10: "day" } as Record<number, string>)[
              item.releaseDate.length
            ]!
          : null,
        cover.id,
      ),
    );
    for (const [index, label] of item.labels.entries()) {
      const labelId = await named(db, statements, "labels", label.name);
      statements.push(
        s(
          "INSERT INTO release_labels(id,release_id,label_id,catalog_number,credit_order) VALUES (?,?,?,?,?) ON CONFLICT(id) DO NOTHING",
          `${target}-label-${index}`,
          target,
          labelId,
          label.catalogNumber || null,
          index,
        ),
      );
    }
    for (const medium of item.media)
      statements.push(
        s(
          "INSERT INTO release_media(id,release_id,position,format,title) VALUES (?,?,?,?,?) ON CONFLICT(id) DO NOTHING",
          `${target}-disc-${medium.position}`,
          target,
          medium.position,
          medium.format,
          medium.title || null,
        ),
      );
    for (const track of item.tracks)
      statements.push(
        s(
          "INSERT INTO tracks(id,medium_id,position,title,duration_ms) VALUES (?,?,?,?,?) ON CONFLICT(id) DO NOTHING",
          `${target}-${track.medium}-${track.position}`,
          `${target}-disc-${track.medium}`,
          track.position,
          track.title,
          track.durationMs,
        ),
      );
  }
  if (options.update) {
    statements.push(
      s(
        "UPDATE collection_items SET acquired_on=?,notes=?,notes_private=?,acquisition_batch_id=?,is_sample=?,version=version+1,updated_at=? WHERE id=?",
        item.acquiredOn,
        item.notes,
        item.notesPrivate ? 1 : 0,
        item.acquisitionBatchId,
        item.isSample ? 1 : 0,
        new Date().toISOString(),
        id,
      ),
    );
    statements.push(s("DELETE FROM item_tags WHERE item_id=?", id));
    statements.push(
      s(
        `UPDATE ${item.kind === "manga" ? "volumes" : "cds"} SET ${item.kind === "manga" ? "volume_edition_id" : "release_id"}=? WHERE item_id=?`,
        target,
        id,
      ),
    );
  } else {
    statements.push(
      s(
        "INSERT INTO collection_items(id,media_kind,acquired_on,notes,notes_private,acquisition_batch_id,is_sample,import_batch_id,idempotency_key) VALUES (?,?,?,?,?,?,?,?,?)",
        id,
        item.kind,
        item.acquiredOn,
        item.notes,
        item.notesPrivate ? 1 : 0,
        item.acquisitionBatchId,
        item.isSample ? 1 : 0,
        options.batchId ?? null,
        options.idempotencyKey ?? null,
      ),
    );
    statements.push(
      s(
        `INSERT INTO ${item.kind === "manga" ? "volumes" : "cds"}(item_id,${item.kind === "manga" ? "volume_edition_id" : "release_id"}) VALUES (?,?)`,
        id,
        target,
      ),
    );
  }
  const tags = [
    ...[...new Set(item.tags)].map((label) => ({ label, source: "manual" })),
    ...(item.tagsMode === "auto"
      ? memoryTags(item.notes, item.editionTitle || item.title).map(
          (label) => ({ label, source: "derived" }),
        )
      : []),
  ];
  for (const { label, source } of tags) {
    const existing = (
      await db.all(
        "SELECT id FROM tags WHERE lower(label)=? ORDER BY id LIMIT 1",
        [key(label)],
      )
    )[0];
    const tagId = String(existing?.id ?? (await idFor("tag", key(label))));
    statements.push(
      s(
        `INSERT INTO tags(id,slug,label,category) VALUES (?,?,?,'memory') ON CONFLICT(id) DO NOTHING`,
        tagId,
        tagId,
        label,
      ),
    );
    statements.push(
      s(
        "INSERT INTO item_tags(item_id,tag_id,source,rule_version) VALUES (?,?,?,?) ON CONFLICT DO NOTHING",
        id,
        tagId,
        source,
        source === "derived" ? "stage3-v1" : null,
      ),
    );
  }
  return statements;
}
export async function saveItem(
  db: Store,
  raw: unknown,
  options: { id?: string; version?: number; requestId?: string } = {},
) {
  await assertNoImport(db);
  const item = itemSchema.parse(raw);
  if (
    item.acquisitionBatchId &&
    !(await db.all("SELECT id FROM acquisition_batches WHERE id=?", [item.acquisitionBatchId])).length
  )
    throw new ApiError(422, "That haul no longer exists. Clear it from the copy and save again.");
  const before = await revision(db);
  if (options.id) {
    const current = await getItem(db, options.id);
    if (current.version !== options.version)
      throw new ApiError(
        409,
        "This copy changed in another session. Reload it before saving.",
      );
    if (current.item.kind !== item.kind)
      throw new ApiError(422, "A copy cannot change media type.");
  }
  const requestKey = options.requestId
    ? `manual:${options.requestId}:${await digest(JSON.stringify(item))}`
    : null;
  if (!options.id && requestKey) {
    const previous = (
      await db.all(
        "SELECT id,idempotency_key FROM collection_items WHERE idempotency_key LIKE ?",
        [`manual:${options.requestId}:%`],
      )
    )[0];
    if (previous) {
      if (previous.idempotency_key !== requestKey)
        throw new ApiError(
          409,
          "An earlier version of this add request was already saved. Reload and edit that copy.",
        );
      return { id: String(previous.id), repeated: true };
    }
  }
  const id = options.id ?? crypto.randomUUID();
  const writes = await planItem(db, item, id, {
    update: Boolean(options.id),
    ...(requestKey ? { idempotencyKey: requestKey } : {}),
  });
  try {
    await db.batch([revisionGuard(before), ...writes]);
  } catch (error) {
    if ((await revision(db)) !== before)
      throw new ApiError(
        409,
        "The collection changed while saving. Reload and try again.",
      );
    throw error;
  }
  return { id, repeated: false };
}
export async function deleteItem(db: Store, id: string, version: number) {
  await assertNoImport(db);
  const before = await revision(db),
    current = await getItem(db, id);
  if (current.version !== version)
    throw new ApiError(409, "This copy changed. Reload before deleting.");
  try {
    await db.batch([
      revisionGuard(before),
      s("UPDATE import_records SET item_id=NULL WHERE item_id=?", id),
      s("DELETE FROM item_tags WHERE item_id=?", id),
      s("DELETE FROM volumes WHERE item_id=?", id),
      s("DELETE FROM cds WHERE item_id=?", id),
      s("DELETE FROM collection_items WHERE id=?", id),
    ]);
  } catch (error) {
    if ((await revision(db)) !== before)
      throw new ApiError(
        409,
        "The collection changed. Reload before deleting.",
      );
    throw error;
  }
  return { deleted: id };
}
export async function assertNoImport(db: Store) {
  if (
    (
      await db.all(
        "SELECT id FROM import_batches WHERE status='committing' LIMIT 1",
      )
    ).length
  )
    throw new ApiError(
      409,
      "An import is in progress. Resume or cancel it before editing.",
    );
}
