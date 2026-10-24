import type { Store } from "../db/store.ts";
import { statement as s } from "../db/store.ts";
import { getItem } from "../services/items.ts";
import { boundedFetch, reserveProvider } from "./http.ts";
import type { Fetcher } from "./http.ts";
import { ApiError } from "../http/api.ts";

export function imageMime(bytes: Uint8Array): string | null {
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)
    return "image/jpeg";
  if ([137, 80, 78, 71, 13, 10, 26, 10].every((v, i) => bytes[i] === v))
    return "image/png";
  if (
    new TextDecoder().decode(bytes.slice(0, 4)) === "RIFF" &&
    new TextDecoder().decode(bytes.slice(8, 12)) === "WEBP"
  )
    return "image/webp";
  return null;
}
export async function cacheItemArtwork(
  db: Store,
  bucket: R2Bucket | undefined,
  itemId: string,
  fetcher?: Fetcher,
) {
  const { item } = await getItem(db, itemId),
    art = item.artwork;
  if (!art) return { cached: false, message: "No artwork selected." };
  // Open Library covers are served from archive.org storage that is sometimes
  // unavailable, so the owner's selected covers are kept in private R2 too.
  if (!["mangadex", "coverartarchive", "openlibrary"].includes(art.provider))
    return {
      cached: false,
      message: "This artwork is served directly from its source.",
    };
  const source = new URL(art.url);
  if (
    (art.provider === "mangadex" &&
      (source.hostname !== "uploads.mangadex.org" ||
        !source.pathname.startsWith("/covers/"))) ||
    (art.provider === "coverartarchive" &&
      (source.hostname !== "coverartarchive.org" ||
        !/^\/release(?:-group)?\/[0-9a-f-]{36}\/front-500$/.test(
          source.pathname,
        ))) ||
    (art.provider === "openlibrary" &&
      (source.hostname !== "covers.openlibrary.org" ||
        !/^\/b\/id\/\d+-L\.jpg$/.test(source.pathname)))
  )
    throw new ApiError(422, "Artwork URL does not match its provider.");
  if (!bucket)
    return {
      cached: false,
      message:
        "Artwork reference saved. Configure COVERS to cache image bytes.",
    };
  // Use the stored reference rather than re-deriving it from the artwork fields.
  const id = String(
    (
      await db.all(
        `SELECT e.cover_asset_id AS id FROM volumes v JOIN volume_editions e ON e.id=v.volume_edition_id WHERE v.item_id=?
      UNION ALL SELECT r.cover_asset_id FROM cds c JOIN album_releases r ON r.id=c.release_id WHERE c.item_id=?`,
        [itemId, itemId],
      )
    )[0]?.id,
  );
  const variant = (
    await db.all(
      "SELECT object_key FROM cover_variants WHERE cover_asset_id=? AND variant=?",
      [id, "original"],
    )
  )[0];
  if (variant?.object_key && (await bucket.head(String(variant.object_key))))
    return { cached: true, message: "Artwork already cached." };
  try {
    await reserveProvider(db, `${art.provider}-images`, 1100);
    const { response, bytes } = await boundedFetch(
      art.url,
      {
        headers: {
          Accept: "image/jpeg,image/png,image/webp",
          "User-Agent":
            "StrawbyStacks/0.2 (https://github.com/jhsu22/atelier-strawby)",
        },
      },
      5 * 1024 * 1024,
      fetcher,
    );
    if (!response.ok)
      throw new ApiError(
        502,
        "Artwork is unavailable from its source.",
      );
    const mime = imageMime(bytes);
    if (
      !mime ||
      !response.headers.get("content-type")?.split(";")[0]?.startsWith("image/")
    )
      throw new ApiError(
        422,
        "The URL did not return a supported JPEG, PNG or WebP image.",
      );
    const hash = Array.from(
      new Uint8Array(
        await crypto.subtle.digest("SHA-256", new Uint8Array(bytes).buffer),
      ),
    )
      .map((n) => n.toString(16).padStart(2, "0"))
      .join("");
    const objectKey = `covers/${hash}`;
    await bucket.put(objectKey, bytes, { httpMetadata: { contentType: mime } });
    await db.batch([
      s(
        "UPDATE cover_variants SET object_key=?,external_url=NULL,mime_type=?,sha256=?,byte_size=? WHERE cover_asset_id=? AND variant='original'",
        objectKey,
        mime,
        hash,
        bytes.length,
        id,
      ),
      s(
        "UPDATE cover_assets SET storage_mode='r2',status='ready',fetched_at=?,last_error_code=NULL,retry_after=NULL WHERE id=?",
        new Date().toISOString(),
        id,
      ),
    ]);
    return { cached: true, message: "Artwork cached." };
  } catch (error) {
    await db.batch([
      s(
        "UPDATE cover_assets SET last_error_code=?,retry_after=? WHERE id=?",
        "FETCH_FAILED",
        new Date(Date.now() + 60000).toISOString(),
        id,
      ),
    ]);
    throw error;
  }
}
