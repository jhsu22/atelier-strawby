import type { APIRoute } from "astro";
import { d1Store } from "../../../server/db/store.ts";
import { publicImageUrl } from "../../../domain/item.ts";
import {
  boundedFetch,
  reserveProvider,
} from "../../../server/metadata/http.ts";
import { imageMime } from "../../../server/metadata/artwork.ts";
export const GET: APIRoute = async ({ params, locals }) => {
  const db = d1Store(locals.runtime.env.DB);
  const row = (
    await db.all(
      `SELECT v.object_key,v.mime_type,a.source_url,a.provider FROM cover_variants v JOIN cover_assets a ON a.id=v.cover_asset_id WHERE v.cover_asset_id=? AND v.variant='original' AND a.status='ready'`,
      [params.id!],
    )
  )[0];
  if (!row) return new Response("Artwork not found", { status: 404 });
  const object = row.object_key
    ? await locals.runtime.env.COVERS?.get(String(row.object_key))
    : null;
  if (object)
    return new Response(object.body, {
      headers: {
        "Content-Type": String(row.mime_type),
        "Content-Security-Policy": "default-src 'none'; sandbox",
      },
    });
  // MangaDex forbids image hotlinking. Even before caching succeeds, its
  // artwork must travel through this authenticated, bounded server proxy.
  if (row.provider === "mangadex") {
    try {
      const url = new URL(String(row.source_url));
      if (
        url.hostname !== "uploads.mangadex.org" ||
        !url.pathname.startsWith("/covers/")
      )
        return new Response("Invalid artwork source", { status: 422 });
      await reserveProvider(db, "mangadex-images", 1100);
      const { response, bytes } = await boundedFetch(
        url.href,
        {
          headers: {
            Accept: "image/jpeg,image/png,image/webp",
            "User-Agent":
              "StrawbyStacks/0.2 (https://github.com/jhsu22/atelier-strawby)",
          },
        },
        5 * 1024 * 1024,
      );
      const mime = imageMime(bytes);
      if (!response.ok || !mime)
        return new Response("Artwork unavailable", { status: 502 });
      return new Response(new Uint8Array(bytes).buffer, {
        headers: {
          "Content-Type": mime,
          "Content-Security-Policy": "default-src 'none'; sandbox",
        },
      });
    } catch {
      return new Response("Artwork unavailable; retry later", { status: 503 });
    }
  }
  if (row.source_url && publicImageUrl(String(row.source_url)))
    return new Response(null, {
      status: 302,
      headers: { Location: String(row.source_url) },
    });
  return new Response("Artwork unavailable", { status: 404 });
};
