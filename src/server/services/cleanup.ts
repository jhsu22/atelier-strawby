import { cleanupRequestSchema } from "../../domain/cleanup.ts";
import type { CleanupRequest } from "../../domain/cleanup.ts";
import { artworkSchema } from "../../domain/item.ts";
import { statement as s, revision, revisionGuard } from "../db/store.ts";
import type { Store, Statement } from "../db/store.ts";
import { ApiError } from "../http/api.ts";
import { artworkStatements, assertNoImport } from "./items.ts";

const PROVIDERS: Record<string, string> = {
  mangadex: "MangaDex",
  openlibrary: "Open Library",
  googlebooks: "Google Books",
  musicbrainz: "MusicBrainz",
  coverartarchive: "Cover Art Archive",
  itunes: "iTunes",
};
const providerName = (provider: string) => PROVIDERS[provider] ?? provider;
const now = () => new Date().toISOString();
const reload = (what: string) => new ApiError(409, `${what} changed since this page loaded. Reload and try again.`);

/** Apply one clean-up queue fix atomically. */
export async function applyCleanup(db: Store, raw: unknown) {
  await assertNoImport(db);
  const request = cleanupRequestSchema.parse(raw);
  const before = await revision(db);
  const writes =
    request.action === "edition"
      ? await editionWrites(db, request)
      : request.action === "date"
        ? await dateWrites(db, request)
        : await coverWrites(db, request);
  try {
    await db.batch([revisionGuard(before), ...writes]);
  } catch (error) {
    if ((await revision(db)) !== before) throw reload("The collection");
    throw error;
  }
  return { ok: true };
}

type EditionRequest = Extract<CleanupRequest, { action: "edition" }>;
/**
 * Confirm an edition run's language, format or numbering in place, keeping
 * every copy and volume identity. If the corrected edition is identical to
 * another owned run, the two merge: an editor save would have filed the
 * corrected copies under that run anyway.
 */
async function editionWrites(db: Store, request: EditionRequest): Promise<Statement[]> {
  if (!request.language && !request.format && !request.numberingBasis) throw new ApiError(422, "Choose what to confirm.");
  const run = (await db.all("SELECT * FROM edition_runs WHERE id=?", [request.runId]))[0];
  if (!run) throw new ApiError(404, "This edition no longer exists. Reload to continue.");
  const { seen } = request;
  if (
    run.language !== seen.language ||
    run.language_basis !== seen.languageBasis ||
    run.format !== seen.format ||
    run.numbering_basis !== seen.numberingBasis
  )
    throw reload("This edition");
  const next = {
    language: request.language ?? String(run.language),
    languageBasis: request.language ? "confirmed" : String(run.language_basis),
    format: request.format ?? String(run.format),
    numberingBasis: request.numberingBasis ?? String(run.numbering_basis),
  };
  const writes = [
    // Open editor forms for these copies are now stale.
    s(
      `UPDATE collection_items SET version=version+1,updated_at=? WHERE id IN
      (SELECT v.item_id FROM volumes v JOIN volume_editions e ON e.id=v.volume_edition_id WHERE e.edition_run_id=?)`,
      now(),
      request.runId,
    ),
  ];
  const twin = (
    await db.all(
      `SELECT id FROM edition_runs WHERE id<>? AND series_id=? AND edition_title=? AND language=? AND publisher_id IS ?
      AND format=? AND numbering_basis=? AND language_basis=? AND medium=? LIMIT 1`,
      [
        request.runId,
        String(run.series_id),
        String(run.edition_title),
        next.language,
        (run.publisher_id as string | null) ?? null,
        next.format,
        next.numberingBasis,
        next.languageBasis,
        String(run.medium),
      ],
    )
  )[0];
  if (!twin) {
    writes.push(
      s(
        "UPDATE edition_runs SET language=?,language_basis=?,format=?,numbering_basis=?,numbering_verified=? WHERE id=?",
        next.language,
        next.languageBasis,
        next.format,
        next.numberingBasis,
        next.numberingBasis === "printed" ? 1 : 0,
        request.runId,
      ),
    );
    return writes;
  }
  const target = String(twin.id);
  writes.push(
    s(
      `UPDATE collection_items SET version=version+1,updated_at=? WHERE id IN
      (SELECT v.item_id FROM volumes v JOIN volume_editions e ON e.id=v.volume_edition_id WHERE e.edition_run_id=?)`,
      now(),
      target,
    ),
  );
  const existing = new Map(
    (await db.all("SELECT id,numbering_key FROM volume_editions WHERE edition_run_id=?", [target])).map((row) => [
      String(row.numbering_key),
      String(row.id),
    ]),
  );
  for (const edition of await db.all("SELECT id,numbering_key,isbn13,cover_asset_id FROM volume_editions WHERE edition_run_id=?", [request.runId])) {
    const source = String(edition.id),
      same = existing.get(String(edition.numbering_key));
    if (!same) {
      writes.push(s("UPDATE volume_editions SET edition_run_id=? WHERE id=?", target, source));
      continue;
    }
    // The same volume in both runs: its copies join the surviving volume edition,
    // which keeps its own ISBN and cover and gains any the other one had.
    writes.push(
      s("UPDATE volumes SET volume_edition_id=? WHERE volume_edition_id=?", same, source),
      s("UPDATE external_refs SET volume_edition_id=? WHERE volume_edition_id=?", same, source),
      s(
        "UPDATE volume_editions SET isbn13=COALESCE(isbn13,?),cover_asset_id=COALESCE(cover_asset_id,?) WHERE id=?",
        (edition.isbn13 as string | null) ?? null,
        (edition.cover_asset_id as string | null) ?? null,
        same,
      ),
      s("DELETE FROM volume_editions WHERE id=?", source),
    );
  }
  writes.push(s("DELETE FROM edition_runs WHERE id=?", request.runId));
  return writes;
}

async function copyRow(db: Store, copyId: string, version: number) {
  const row = (
    await db.all("SELECT id,version,media_kind,acquisition_batch_id FROM collection_items WHERE id=?", [copyId])
  )[0];
  if (!row) throw new ApiError(404, "This copy no longer exists. Reload to continue.");
  if (Number(row.version) !== version) throw reload("This copy");
  return row;
}

type DateRequest = Extract<CleanupRequest, { action: "date" }>;
async function dateWrites(db: Store, request: DateRequest): Promise<Statement[]> {
  const row = await copyRow(db, request.copyId, request.version);
  // A logged haul has one shared date, so the answer applies to all its copies.
  const haul = (row.acquisition_batch_id as string | null) ?? null;
  const scope = haul ? "acquisition_batch_id=?" : "id=?";
  const target = haul ?? request.copyId;
  if (request.acquiredOn === null)
    return [
      s(
        `UPDATE collection_items SET date_unknown=1,version=version+1,updated_at=? WHERE ${scope} AND acquired_on IS NULL`,
        now(),
        target,
      ),
    ];
  return [
    ...(haul ? [s("UPDATE acquisition_batches SET acquired_on=? WHERE id=?", request.acquiredOn, haul)] : []),
    s(
      `UPDATE collection_items SET acquired_on=?,date_unknown=0,version=version+1,updated_at=? WHERE ${scope}`,
      request.acquiredOn,
      now(),
      target,
    ),
  ];
}

type CoverRequest = Extract<CleanupRequest, { action: "cover" | "apply-cover" }>;
/** The volume edition or CD release whose cover a copy shows. */
async function coverOwner(db: Store, copyId: string, kind: string) {
  const [table, join] =
    kind === "cd"
      ? ["album_releases", "SELECT release_id FROM cds WHERE item_id=?"]
      : ["volume_editions", "SELECT volume_edition_id FROM volumes WHERE item_id=?"];
  const row = (await db.all(`SELECT id,cover_asset_id,cover_unavailable FROM ${table} WHERE id=(${join})`, [copyId]))[0];
  if (!row) throw new ApiError(404, "This copy no longer exists. Reload to continue.");
  const copies =
    kind === "cd" ? "SELECT item_id FROM cds WHERE release_id=?" : "SELECT item_id FROM volumes WHERE volume_edition_id=?";
  return {
    table,
    id: String(row.id),
    cover: (row.cover_asset_id as string | null) ?? null,
    // Every copy sharing the cover; their open editor forms become stale.
    bump: s(`UPDATE collection_items SET version=version+1,updated_at=? WHERE id IN (${copies})`, now(), String(row.id)),
  };
}
async function coverWrites(db: Store, request: CoverRequest): Promise<Statement[]> {
  const row = await copyRow(db, request.copyId, request.version);
  const owner = await coverOwner(db, request.copyId, String(row.media_kind));
  if (request.action === "apply-cover") {
    if (owner.cover) throw new ApiError(409, "This volume has a cover now. Reload to see it.");
    // Choosing a cover by looking at it confirms it for this edition.
    const art = artworkSchema.parse({
      ...request.artwork,
      scope: "edition",
      attribution: `${providerName(request.artwork.provider ?? "manual")} · chosen by the owner for this edition`,
    });
    const cover = await artworkStatements(art, true);
    return [
      ...cover.statements,
      s(`UPDATE ${owner.table} SET cover_asset_id=?,cover_unavailable=0 WHERE id=? AND cover_asset_id IS NULL`, cover.id, owner.id),
      owner.bump,
    ];
  }
  if (request.decision === "unavailable") {
    if (owner.cover) throw new ApiError(409, "This volume has a cover now. Reload to see it.");
    return [s(`UPDATE ${owner.table} SET cover_unavailable=1 WHERE id=?`, owner.id), owner.bump];
  }
  if (!owner.cover) throw new ApiError(409, "This cover was already removed. Reload to continue.");
  if (request.decision === "remove")
    return [s(`UPDATE ${owner.table} SET cover_asset_id=NULL WHERE id=?`, owner.id), owner.bump];
  const asset = (await db.all("SELECT * FROM cover_assets WHERE id=?", [owner.cover]))[0]!;
  if (asset.match_scope === "edition") throw new ApiError(409, "This cover is already confirmed. Reload to continue.");
  // Other volumes may share the representative asset, so the confirmation is a
  // new edition-scope asset for this one. Its identity is the one an editor
  // re-save computes, so saving the copy later does not duplicate it.
  const art = artworkSchema.parse({
    url: String(asset.source_url),
    scope: "edition",
    provider: String(asset.provider),
    sourceId: String(asset.source_record_id ?? ""),
    attribution: `${providerName(String(asset.provider))} · confirmed by the owner for this edition`,
    language: (asset.source_language as "EN" | "JP" | "KR" | null) ?? null,
  });
  const cover = await artworkStatements(art, true);
  const [insertAsset, insertVariant] = cover.statements;
  return [
    insertAsset!,
    // Bytes already cached in R2 are reused rather than fetched again.
    s(
      `INSERT INTO cover_variants(id,cover_asset_id,variant,object_key,external_url,sha256,mime_type,width,height,byte_size,etag)
      SELECT ?,?,variant,object_key,external_url,sha256,mime_type,width,height,byte_size,etag FROM cover_variants
      WHERE cover_asset_id=? AND variant='original' ON CONFLICT DO NOTHING`,
      `${cover.id}-original`,
      cover.id,
      owner.cover,
    ),
    insertVariant!,
    s(
      "UPDATE cover_assets SET storage_mode='r2' WHERE id=? AND EXISTS (SELECT 1 FROM cover_variants WHERE cover_asset_id=? AND object_key IS NOT NULL)",
      cover.id,
      cover.id,
    ),
    s(`UPDATE ${owner.table} SET cover_asset_id=? WHERE id=?`, cover.id, owner.id),
    owner.bump,
  ];
}
