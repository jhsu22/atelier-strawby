import type { Store } from "../db/store.ts";
import {
  statement as s,
  digest,
  revision,
  revisionGuard,
} from "../db/store.ts";
import { ApiError } from "../http/api.ts";
import { artworkStatements, assertNoImport } from "../services/items.ts";
import { cacheItemArtwork } from "./artwork.ts";
import {
  creditsCompatible,
  lookupMetadata,
  openLibraryBookCovers,
  openLibraryVolumeCovers,
} from "./providers.ts";
import type { Fetcher } from "./http.ts";
import type { MetadataCandidate, MetadataResult } from "../../domain/metadata.ts";
import { coverCandidatesRequestSchema } from "../../domain/cleanup.ts";
import type { CoverCandidate, CoverCandidates } from "../../domain/cleanup.ts";
import { artworkSchema } from "../../domain/item.ts";
import type { ArtworkInput } from "../../domain/item.ts";
import type { Medium } from "../../domain/types.ts";

export type CoverOutcomeKind =
  | "matched"
  | "cached"
  | "already-cached"
  | "unmatched"
  | "failed"
  | "deferred"
  | "needs-selection";
export interface CoverOutcome {
  outcome: CoverOutcomeKind;
  title: string;
  volume?: string;
  language?: string;
  reason: string;
}
export interface CoverReport {
  dryRun: boolean;
  totals: Record<CoverOutcomeKind, number>;
  outcomes: CoverOutcome[];
}
export interface CoverRunOptions {
  bucket?: R2Bucket | undefined;
  fetcher?: Fetcher;
  contact?: string;
  /** Bypass cached provider failures/misses and artwork retry delays. */
  retry?: boolean;
  /** Look up candidates without changing the collection or R2. */
  dryRun?: boolean;
  /**
   * Maximum number of series that need provider requests in this run. Series
   * answered entirely from D1 checkpoints and cache do not count, so repeated
   * limited runs progress through the collection.
   */
  seriesLimit?: number;
  onOutcome?: (outcome: CoverOutcome) => void;
}

const ATTRIBUTION = {
  mangadex:
    "mangadex · automatic volume/language match; confirm the physical publisher edition",
  openlibrary:
    "openlibrary · automatic edition match (volume, language); confirm the publisher",
  openlibraryPublisher:
    "openlibrary · automatic edition match (volume, language, publisher); confirm against your copy",
  book: "openlibrary · automatic edition match (title, author, language); confirm the cover against your printing",
  bookPublisher:
    "openlibrary · automatic edition match (title, author, language, publisher); confirm against your copy",
};
const normalized = (value: string) =>
  value
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, "");
class Deferred extends Error {}
const WAIT = "A provider asked us to wait or is busy. Rerun later to resume.";
function assertAvailable(result: MetadataResult) {
  const failures = result.failures ?? [];
  if (failures.includes(429)) throw new Deferred(WAIT);
  if (failures.length)
    throw new ApiError(
      502,
      result.warnings[0] ?? "MangaDex lookup failed. Rerun to retry.",
    );
}

interface PendingEdition {
  editionId: string;
  seriesId: string;
  title: string;
  volume: string;
  language: "EN" | "JP" | "KR";
  publisher: string;
  medium: Medium;
}

/**
 * Resumable, unattended artwork enrichment shared by the CLI utility.
 *
 * Only unambiguous evidence is applied: one MangaDex title whose name equals the
 * series title or an alias, with compatible credits, and exactly one cover with
 * the owned printed volume number and language. Anything else is reported for
 * owner review in the editor. Open Library is never crawled, CDs are never
 * guessed, and existing artwork is never replaced. Progress is checkpointed in
 * D1: series matches in external_refs, applied artwork in cover_assets and
 * provider responses in metadata_cache, so a rerun skips completed work.
 */
export async function cacheMissingCovers(
  db: Store,
  options: CoverRunOptions = {},
): Promise<CoverReport> {
  await assertNoImport(db);
  const report: CoverReport = {
    dryRun: Boolean(options.dryRun),
    totals: {
      matched: 0,
      cached: 0,
      "already-cached": 0,
      unmatched: 0,
      failed: 0,
      deferred: 0,
      "needs-selection": 0,
    },
    outcomes: [],
  };
  const record = (outcome: CoverOutcome) => {
    report.totals[outcome.outcome]++;
    report.outcomes.push(outcome);
    options.onOutcome?.(outcome);
  };
  let requests = 0;
  const counted: Fetcher = (input, init) => {
    requests++;
    return (options.fetcher ?? fetch)(input, init);
  };
  const lookup = { fetcher: counted, contact: options.contact };
  const visible = `EXISTS (SELECT 1 FROM collection_items i LEFT JOIN import_batches b ON b.id=i.import_batch_id
    WHERE i.id=%ITEM% AND (b.id IS NULL OR b.status='complete'))`;

  // Uncertain omnibus numbering and collector's/art/anthology formats do not
  // share MangaDex's tankobon volume numbering, so they are never matched.
  const editions = (await db.all(
    `SELECT e.id AS editionId,s.id AS seriesId,s.canonical_title AS title,e.volume_label AS volume,r.language,r.medium,COALESCE(p.name,'') AS publisher
    FROM volume_editions e JOIN edition_runs r ON r.id=e.edition_run_id JOIN series s ON s.id=r.series_id
    LEFT JOIN publishers p ON p.id=r.publisher_id
    WHERE e.cover_asset_id IS NULL AND r.format='standard' AND r.numbering_basis='printed'
    AND EXISTS (SELECT 1 FROM volumes v WHERE v.volume_edition_id=e.id AND ${visible.replace("%ITEM%", "v.item_id")})
    ORDER BY s.sort_title,s.id,r.language,e.volume_sort,e.volume_label`,
  )) as unknown as PendingEdition[];
  const bySeries = new Map<string, PendingEdition[]>();
  for (const edition of editions)
    bySeries.set(edition.seriesId, [
      ...(bySeries.get(edition.seriesId) ?? []),
      edition,
    ]);

  let deferred: string | null = null,
    attempted = 0;
  for (const [seriesId, pending] of bySeries) {
    const title = pending[0]!.title;
    if (
      !deferred &&
      options.seriesLimit !== undefined &&
      attempted >= options.seriesLimit
    )
      deferred = "Series limit reached. Rerun to continue.";
    if (deferred) {
      record({ outcome: "deferred", title, reason: deferred });
      continue;
    }
    const startRequests = requests;
    try {
      const titles = await seriesTitles(db, seriesId, title);
      const credits = await seriesCredits(db, seriesId);
      // MangaDex is comics only, so it is resolved once and only for manga.
      let series: Awaited<ReturnType<typeof resolveSeries>> | undefined;
      for (const edition of pending) {
        const base = {
          title,
          // A standalone book's "1" is not a meaningful volume number.
          ...(edition.medium === "book" && edition.volume === "1"
            ? {}
            : { volume: edition.volume }),
          language: edition.language,
        };
        const reasons: string[] = [];
        let choice: { art: ArtworkInput; attribution: string } | null = null;
        if (edition.medium === "manga")
          series ??= await resolveSeries(
            db,
            seriesId,
            titles,
            credits,
            options,
            lookup,
          );
        if (edition.medium !== "manga") {
          // Light novels and books: Open Library editions only (below).
        } else if (typeof series === "string") {
          const result = await lookupMetadata(
            db,
            {
              kind: "manga",
              provider: "mangadex",
              query: title,
              id: series,
              volume: edition.volume,
              language: edition.language,
              retry: options.retry ?? false,
            },
            lookup,
          );
          assertAvailable(result);
          const exact = result.candidates.filter(
            (candidate) => candidate.patch.artwork?.scope === "edition",
          );
          if (exact.length === 1)
            choice = {
              art: exact[0]!.patch.artwork!,
              attribution: ATTRIBUTION.mangadex,
            };
          else
            reasons.push(
              exact.length
                ? `${exact.length} MangaDex covers share this volume and language.`
                : "MangaDex has no cover for this volume in this language.",
            );
        } else if (series) reasons.push(series.reason);
        // Open Library edition records cover many English releases that
        // MangaDex lacks.
        if (!choice) {
          let editions;
          try {
            editions =
              edition.medium === "book"
                ? await openLibraryBookCovers(
                    db,
                    {
                      title,
                      authors: credits,
                      language: edition.language,
                      publisher: edition.publisher,
                      retry: options.retry ?? false,
                    },
                    lookup,
                  )
                : await openLibraryVolumeCovers(
                    db,
                    {
                      titles,
                      language: edition.language,
                      volume: edition.volume,
                      publisher: edition.publisher,
                      medium: edition.medium,
                      retry: options.retry ?? false,
                    },
                    lookup,
                  );
          } catch (error) {
            if (error instanceof ApiError && error.status === 429)
              throw new Deferred(WAIT);
            throw error;
          }
          // A listed publisher that differs is often another edition (e.g. the
          // light novel), so unattended runs only accept matching or unknown.
          // Light novels also need positive evidence of the novel edition:
          // the same house often prints the manga under an identical title.
          const best = editions.find(
            (candidate) =>
              candidate.publisherMatch !== false &&
              (edition.medium !== "light_novel" || candidate.mediumEvidence),
          );
          if (best?.patch.artwork)
            choice = {
              art: best.patch.artwork,
              attribution:
                edition.medium === "book"
                  ? best.publisherMatch
                    ? ATTRIBUTION.bookPublisher
                    : ATTRIBUTION.book
                  : best.publisherMatch
                    ? ATTRIBUTION.openlibraryPublisher
                    : ATTRIBUTION.openlibrary,
            };
          else
            reasons.push(
              editions.length
                ? edition.medium === "light_novel"
                  ? "Open Library editions are from a different publisher or not identifiable as the light novel."
                  : "Open Library editions list a different publisher."
                : edition.medium === "book"
                  ? "Open Library has no matching edition cover for this title."
                  : "Open Library has no edition cover for this volume.",
            );
        }
        if (!choice) {
          record({
            ...base,
            outcome: "unmatched",
            reason: `${reasons.join(" ")} Choose artwork in the editor.`,
          });
          continue;
        }
        const source =
          choice.art.provider === "mangadex" ? "MangaDex" : "Open Library";
        if (options.dryRun) {
          record({
            ...base,
            outcome: "matched",
            reason: `Would apply ${source} edition artwork (dry run).`,
          });
          continue;
        }
        const applied = await applyArtwork(db, edition.editionId, {
          ...choice.art,
          attribution: choice.attribution,
        });
        record({
          ...base,
          outcome: applied ? "matched" : "unmatched",
          reason: applied
            ? edition.medium === "book"
              ? `Applied ${source} edition artwork; confirm the cover against your printing.`
              : `Applied ${source} volume/language artwork; confirm the publisher edition.`
            : "Artwork was selected for this volume while the utility ran; kept the owner's choice.",
        });
      }
    } catch (error) {
      if (error instanceof Deferred) {
        deferred = error.message;
        record({ outcome: "deferred", title, reason: deferred });
      } else
        record({
          outcome: "failed",
          title,
          reason:
            error instanceof Error ? error.message : "Unexpected failure.",
        });
    } finally {
      if (requests > startRequests) attempted++;
    }
  }

  // Cache every referenced provider image that is not yet stored in R2,
  // including owner selections whose earlier cache attempt failed.
  const now = new Date().toISOString();
  const assets = await db.all(
    `SELECT a.id,a.provider,v.object_key AS objectKey,MIN(u.item_id) AS itemId,MIN(u.title) AS title
    FROM cover_assets a LEFT JOIN cover_variants v ON v.cover_asset_id=a.id AND v.variant='original' JOIN (
      SELECT e.cover_asset_id AS cover,v.item_id,s.canonical_title AS title FROM volume_editions e JOIN volumes v ON v.volume_edition_id=e.id
      JOIN edition_runs r ON r.id=e.edition_run_id JOIN series s ON s.id=r.series_id
      UNION ALL SELECT r.cover_asset_id,c.item_id,a.title FROM album_releases r JOIN cds c ON c.release_id=r.id JOIN albums a ON a.id=r.album_id
    ) u ON u.cover=a.id
    WHERE a.provider IN ('mangadex','coverartarchive','openlibrary') AND ${visible.replace("%ITEM%", "u.item_id")}
    AND (?=1 OR a.storage_mode='r2' OR a.retry_after IS NULL OR a.retry_after<=?)
    GROUP BY a.id ORDER BY MIN(u.title),a.id`,
    [options.retry ? 1 : 0, now],
  );
  const imagesDeferred = new Map<string, string>();
  for (const asset of assets) {
    const title = String(asset.title),
      provider = String(asset.provider);
    if (imagesDeferred.has(provider)) {
      record({
        outcome: "deferred",
        title,
        reason: imagesDeferred.get(provider)!,
      });
      continue;
    }
    if (!options.bucket) {
      record({
        outcome: "deferred",
        title,
        reason: "No COVERS R2 binding; the artwork reference is kept.",
      });
      continue;
    }
    if (
      asset.objectKey &&
      (await options.bucket.head(String(asset.objectKey)))
    ) {
      record({ outcome: "already-cached", title, reason: "Stored in R2." });
      continue;
    }
    if (options.dryRun) {
      record({
        outcome: "cached",
        title,
        reason: "Would cache this artwork in R2 (dry run).",
      });
      continue;
    }
    try {
      const result = await cacheItemArtwork(
        db,
        options.bucket,
        String(asset.itemId),
        options.fetcher,
      );
      record({
        outcome: result.cached ? "cached" : "failed",
        title,
        reason: result.message,
      });
    } catch (error) {
      if (error instanceof ApiError && error.status === 429) {
        imagesDeferred.set(provider, error.message);
        record({ outcome: "deferred", title, reason: error.message });
      } else
        record({
          outcome: "failed",
          title,
          reason:
            error instanceof Error
              ? `${error.message} The saved source is kept; rerun to retry.`
              : "Caching failed.",
        });
    }
  }

  // Many physical CDs share a title, so a release must be chosen by the owner.
  for (const album of await db.all(
    `SELECT a.title,COUNT(*) AS copies FROM cds c JOIN album_releases r ON r.id=c.release_id JOIN albums a ON a.id=r.album_id
    WHERE r.cover_asset_id IS NULL AND ${visible.replace("%ITEM%", "c.item_id")} GROUP BY r.id ORDER BY a.title`,
  ))
    record({
      outcome: "needs-selection",
      title: String(album.title),
      reason:
        "Choose the matching MusicBrainz release in the editor; CD editions are never guessed.",
    });
  return report;
}

async function seriesTitles(db: Store, seriesId: string, title: string) {
  const aliases = (
    await db.all(
      "SELECT title FROM series_aliases WHERE series_id=? ORDER BY title",
      [seriesId],
    )
  ).map((row) => String(row.title));
  return [...new Set([title, ...aliases])];
}

async function seriesCredits(db: Store, seriesId: string) {
  return (
    await db.all(
      "SELECT c.display_name FROM series_creators sc JOIN creators c ON c.id=sc.creator_id WHERE sc.series_id=?",
      [seriesId],
    )
  ).map((row) => String(row.display_name));
}

async function resolveSeries(
  db: Store,
  seriesId: string,
  titles: string[],
  credits: string[],
  options: CoverRunOptions,
  lookup: { fetcher?: Fetcher | undefined; contact?: string | undefined },
): Promise<string | { reason: string }> {
  const existing = (
    await db.all(
      "SELECT external_id FROM external_refs WHERE provider='mangadex' AND provider_entity_type='manga' AND series_id=? ORDER BY is_owner_confirmed DESC LIMIT 1",
      [seriesId],
    )
  )[0];
  if (existing) return String(existing.external_id);
  const keys = new Set(titles.map(normalized));
  for (const query of titles.slice(0, 3)) {
    const result = await lookupMetadata(
      db,
      {
        kind: "manga",
        provider: "mangadex",
        query,
        retry: options.retry ?? false,
      },
      lookup,
    );
    assertAvailable(result);
    const ids = [
      ...new Set(
        result.candidates
          .filter(
            (candidate) =>
              [candidate.title, ...(candidate.patch.aliases ?? [])].some(
                (name) => keys.has(normalized(name)),
              ) &&
              creditsCompatible(
                candidate.credits ?? candidate.patch.authors ?? [],
                credits,
              ),
          )
          .map((candidate) => candidate.id),
      ),
    ];
    if (ids.length > 1)
      return {
        reason: `${ids.length} MangaDex titles share this name; select the series in the editor.`,
      };
    if (!ids.length) continue;
    const id = ids[0]!;
    const claimed = (
      await db.all(
        "SELECT series_id FROM external_refs WHERE provider='mangadex' AND provider_entity_type='manga' AND external_id=?",
        [id],
      )
    )[0];
    if (claimed && claimed.series_id !== seriesId)
      return {
        reason:
          "The matching MangaDex title is already linked to another series; review both in the editor.",
      };
    if (!options.dryRun)
      await db.batch([
        s(
          `INSERT INTO external_refs(id,provider,provider_entity_type,external_id,source_url,fetched_at,match_basis,is_owner_confirmed,series_id)
          VALUES (?,'mangadex','manga',?,?,?,'automatic-exact-title',0,?) ON CONFLICT DO NOTHING`,
          `ref-${(await digest(`mangadex:manga:${id}`)).slice(0, 32)}`,
          id,
          `https://mangadex.org/title/${id}`,
          new Date().toISOString(),
          seriesId,
        ),
      ]);
    return id;
  }
  return {
    reason:
      "No MangaDex title exactly matches this series name and its credits.",
  };
}

async function applyArtwork(
  db: Store,
  editionId: string,
  art: Parameters<typeof artworkStatements>[0],
): Promise<boolean> {
  // Schema parsing gives the same asset identity an owner re-save computes.
  const cover = await artworkStatements(artworkSchema.parse(art), false);
  const before = await revision(db);
  try {
    // The conditional update keeps any artwork chosen concurrently. Copy versions
    // change only when this cover was applied, so stale editor forms get a 409.
    await db.batch([
      revisionGuard(before),
      ...cover.statements,
      s(
        "UPDATE volume_editions SET cover_asset_id=? WHERE id=? AND cover_asset_id IS NULL",
        cover.id,
        editionId,
      ),
      s(
        `UPDATE collection_items SET version=version+1,updated_at=? WHERE id IN (SELECT item_id FROM volumes WHERE volume_edition_id=?)
        AND EXISTS (SELECT 1 FROM volume_editions WHERE id=? AND cover_asset_id=?)`,
        new Date().toISOString(),
        editionId,
        editionId,
        cover.id,
      ),
    ]);
  } catch (error) {
    if ((await revision(db)) !== before)
      throw new ApiError(
        409,
        "The collection changed while applying artwork. Rerun to resume.",
      );
    throw error;
  }
  return (
    (
      await db.all("SELECT cover_asset_id FROM volume_editions WHERE id=?", [
        editionId,
      ])
    )[0]?.cover_asset_id === cover.id
  );
}

/**
 * Cover choices for one volume with no artwork, for the owner to pick from in
 * the clean-up queue. Unlike the unattended run above, near matches are
 * offered too; the owner decides by looking. CD releases are never guessed.
 */
export async function coverCandidates(
  db: Store,
  raw: unknown,
  options: { fetcher?: Fetcher; contact?: string } = {},
): Promise<CoverCandidates> {
  const { copyId, retry } = coverCandidatesRequestSchema.parse(raw);
  const edition = (
    await db.all(
      `SELECT s.id AS seriesId,s.canonical_title AS title,e.volume_label AS volume,e.book_title AS bookTitle,r.language,r.medium,
      COALESCE(p.name,'') AS publisher FROM volumes v JOIN volume_editions e ON e.id=v.volume_edition_id
      JOIN edition_runs r ON r.id=e.edition_run_id JOIN series s ON s.id=r.series_id
      LEFT JOIN publishers p ON p.id=r.publisher_id WHERE v.item_id=?`,
      [copyId],
    )
  )[0] as (Omit<PendingEdition, "editionId"> & { bookTitle: string }) | undefined;
  if (!edition) {
    if ((await db.all("SELECT 1 FROM cds WHERE item_id=?", [copyId])).length)
      return { candidates: [], warnings: ["CD covers come with the exact release: choose it in the editor."] };
    throw new ApiError(404, "This copy no longer exists. Reload to continue.");
  }
  const found = new Map<string, CoverCandidate>();
  const warnings: string[] = [];
  const offer = (candidates: MetadataCandidate[], exact: (candidate: MetadataCandidate) => boolean) => {
    for (const candidate of candidates) {
      const art = candidate.patch.artwork;
      if (!art || found.has(art.url) || found.size >= 8) continue;
      found.set(art.url, {
        artwork: artworkSchema.parse(art),
        label: [candidate.title, candidate.subtitle].filter(Boolean).join(" · "),
        exact: exact(candidate),
      });
    }
  };
  const failed = (error: unknown) =>
    warnings.push(
      error instanceof Deferred || (error instanceof ApiError && error.status === 429)
        ? WAIT
        : error instanceof Error
          ? error.message
          : "A cover source failed. Try again later.",
    );
  const lookup = { fetcher: options.fetcher, contact: options.contact };
  const titles = await seriesTitles(db, edition.seriesId, edition.title);
  const credits = await seriesCredits(db, edition.seriesId);
  // MangaDex is comics only; its covers list the volume and language they show.
  if (edition.medium === "manga")
    try {
      const series = await resolveSeries(db, edition.seriesId, titles, credits, { retry }, lookup);
      if (typeof series === "string") {
        const result = await lookupMetadata(
          db,
          { kind: "manga", provider: "mangadex", query: edition.title, id: series, volume: edition.volume, language: edition.language, retry },
          lookup,
        );
        assertAvailable(result);
        offer(result.candidates, (candidate) => candidate.patch.artwork?.scope === "edition");
      } else warnings.push(series.reason);
    } catch (error) {
      failed(error);
    }
  try {
    offer(
      edition.medium === "book"
        ? await openLibraryBookCovers(
            db,
            { title: edition.bookTitle || edition.title, authors: credits, language: edition.language, publisher: edition.publisher, retry },
            lookup,
          )
        : await openLibraryVolumeCovers(
            db,
            { titles, language: edition.language, volume: edition.volume, publisher: edition.publisher, medium: edition.medium, retry },
            lookup,
          ),
      (candidate) => candidate.publisherMatch === true,
    );
  } catch (error) {
    failed(error);
  }
  const candidates = [...found.values()].sort((a, b) => Number(b.exact) - Number(a.exact));
  if (!candidates.length && !warnings.length) warnings.push("No catalog has a cover for this volume yet.");
  return { candidates, warnings };
}
