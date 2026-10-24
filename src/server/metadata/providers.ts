import { z } from "zod";
import type { Store } from "../db/store.ts";
import { providerJson } from "./http.ts";
import type { Fetcher } from "./http.ts";
import type {
  MetadataCandidate,
  MetadataResult,
} from "../../domain/metadata.ts";
import { publicImageUrl } from "../../domain/item.ts";
import type { ItemInput, ArtworkInput } from "../../domain/item.ts";

const object = z.record(z.unknown());
const str = (value: unknown) => (typeof value === "string" ? value : "");
const arr = (value: unknown): Record<string, unknown>[] =>
  z.array(object).parse(value ?? []);
const record = (value: unknown) => object.parse(value ?? {});
const strings = (value: unknown): string[] =>
  z.array(z.string()).parse(value ?? []);
export const lookupSchema = z.object({
  kind: z.enum(["manga", "cd"]),
  query: z.string().trim().min(1).max(200),
  artist: z.string().max(200).default(""),
  language: z.enum(["EN", "JP", "KR"]).default("EN"),
  volume: z.string().max(40).default("1"),
  aliases: z.array(z.string().max(200)).max(10).default([]),
  provider: z
    .enum(["auto", "mangadex", "openlibrary", "musicbrainz", "itunes"])
    .default("auto"),
  id: z.string().max(100).optional(),
  retry: z.boolean().default(false),
});
const lang = { EN: "en", JP: "ja", KR: "ko" };
const warn = (error: unknown) =>
  error instanceof Error ? error.message : "Provider unavailable";
const art = (
  url: string,
  provider: string,
  sourceId: string,
  scope: "edition" | "representative",
  language: "EN" | "JP" | "KR" | null = null,
): ArtworkInput => ({
  url,
  provider,
  sourceId,
  scope,
  language,
  attribution: `${provider} · ${scope === "edition" ? "selected edition" : "representative artwork"}`,
});

export async function lookupMetadata(
  db: Store,
  raw: unknown,
  options: { contact?: string; fetcher?: Fetcher } = {},
): Promise<MetadataResult> {
  const input = lookupSchema.parse(raw),
    warnings: string[] = [];
  const json = (provider: string, url: string) =>
    providerJson(db, provider, url, { ...options, retry: input.retry });
  const attempt = async (task: () => Promise<MetadataCandidate[]>) => {
    try {
      return await task();
    } catch (error) {
      warnings.push(warn(error));
      return [];
    }
  };
  const mangaDex = async (): Promise<MetadataCandidate[]> => {
    if (input.id) {
      const id = z.string().uuid().parse(input.id);
      const payload = record(
        await json(
          "mangadex",
          `https://api.mangadex.org/cover?manga[]=${id}&limit=100`,
        ),
      );
      const covers = arr(payload.data);
      const matched = covers.filter((c) => {
        const a = record(c.attributes);
        return (
          str(a.volume) === input.volume && a.locale === lang[input.language]
        );
      });
      const results = matched.length ? matched : covers.slice(0, 5);
      if (Number(payload.total) > 100)
        warnings.push(
          "Only the first 100 covers were checked. Narrow or retry manually for unresolved volumes.",
        );
      return results.map((c) => {
        const a = record(c.attributes),
          filename = z
            .string()
            .regex(/^[a-zA-Z0-9._-]+$/)
            .parse(a.fileName);
        const exact =
          str(a.volume) === input.volume && a.locale === lang[input.language];
        return {
          id: String(c.id),
          provider: "mangadex",
          title: input.query,
          subtitle: `Volume ${str(a.volume) || "unknown"} · ${str(a.locale) || "language unknown"}`,
          sourceUrl: `https://mangadex.org/title/${id}`,
          detail: false,
          patch: {
            artwork: art(
              `https://uploads.mangadex.org/covers/${id}/${filename}.512.jpg`,
              "mangadex",
              String(c.id),
              exact ? "edition" : "representative",
              exact ? input.language : null,
            ),
          },
          warning: exact
            ? "Volume and cover language match. Confirm this artwork against your physical edition and publisher."
            : "Representative fallback: volume or language does not match. This is not verified artwork for your numbered edition.",
        };
      });
    }
    const payload = record(
      await json(
        "mangadex",
        `https://api.mangadex.org/manga?title=${encodeURIComponent(input.query)}&order[relevance]=desc&limit=8&includes[]=author&includes[]=artist&contentRating[]=safe&contentRating[]=suggestive&contentRating[]=erotica`,
      ),
    );
    return arr(payload.data).map((manga) => {
      const attributes = record(manga.attributes),
        titles = record(attributes.title),
        alternatives = arr(attributes.altTitles).flatMap(
          (a) =>
            Object.values(a).filter((v) => typeof v === "string") as string[],
        );
      const title =
        str(titles[lang[input.language]]) ||
        str(titles.en) ||
        str(Object.values(titles)[0]);
      const authors = arr(manga.relationships)
        .filter((r) => r.type === "author")
        .map((r) => str(record(r.attributes).name))
        .filter(Boolean);
      return {
        id: String(manga.id),
        provider: "mangadex",
        title,
        subtitle: authors.join(" · "),
        sourceUrl: `https://mangadex.org/title/${manga.id}`,
        detail: true,
        patch: {
          authors,
          aliases: [
            ...new Set([...Object.values(titles).map(str), ...alternatives]),
          ]
            .filter(Boolean)
            .slice(0, 30),
        },
        warning:
          "Select the matching series, then review its volume artwork. Existing collection titles are preserved.",
      };
    });
  };
  const openLibrary = async (): Promise<MetadataCandidate[]> => {
    const language = { EN: "eng", JP: "jpn", KR: "kor" }[input.language];
    const q = `${input.query} language:${language}`;
    const payload = record(
      await json(
        "openlibrary",
        `https://openlibrary.org/search.json?q=${encodeURIComponent(q)}&fields=key,title,author_name,cover_i&limit=8`,
      ),
    );
    return arr(payload.docs).map((doc) => ({
      id: str(doc.key),
      provider: "openlibrary",
      title: str(doc.title),
      subtitle: strings(doc.author_name).join(" · "),
      sourceUrl: `https://openlibrary.org${str(doc.key).startsWith("/") ? str(doc.key) : "/works/" + str(doc.key)}`,
      detail: false,
      patch: {
        authors: strings(doc.author_name),
        ...(typeof doc.cover_i === "number" && doc.cover_i > 0
          ? {
              artwork: art(
                `https://covers.openlibrary.org/b/id/${doc.cover_i}-L.jpg?default=false`,
                "openlibrary",
                str(doc.key),
                "representative",
              ),
            }
          : {}),
      },
      warning:
        "Work-level metadata and representative cover; physical volume and edition are unverified. Open Library artwork is served directly.",
    }));
  };
  const artistNames = (value: unknown) =>
    arr(value)
      .map((a) => str(a.name) || str(record(a.artist).name))
      .filter(Boolean);
  const releasePatch = (r: Record<string, unknown>): Partial<ItemInput> => ({
    title: str(r.title),
    artists: artistNames(r["artist-credit"]),
    releaseDate: str(r.date) || null,
    editionTitle: [str(r.disambiguation), str(r.country)]
      .filter(Boolean)
      .join(" · "),
    labels: arr(r["label-info"])
      .map((l) => ({
        name: str(record(l.label).name),
        catalogNumber: str(l["catalog-number"]),
      }))
      .filter((l) => l.name),
    media: arr(r.media).map((m, i) => ({
      position: Number(m.position ?? i + 1),
      format: (["CD", "Blu-ray", "DVD"].includes(str(m.format))
        ? str(m.format)
        : "other") as "CD" | "Blu-ray" | "DVD" | "other",
      title: str(m.title),
    })),
    tracks: arr(r.media).flatMap((m, i) =>
      arr(m.tracks).map((t, j) => ({
        medium: Number(m.position ?? i + 1),
        position: Number(t.position ?? j + 1),
        title: str(t.title) || str(record(t.recording).title),
        durationMs: typeof t.length === "number" ? t.length : null,
      })),
    ),
  });
  const musicBrainz = async (): Promise<MetadataCandidate[]> => {
    if (input.id) {
      const id = z.string().uuid().parse(input.id);
      const release = record(
        await json(
          "musicbrainz",
          `https://musicbrainz.org/ws/2/release/${id}?inc=artists+labels+recordings+release-groups&fmt=json`,
        ),
      );
      let artwork: ArtworkInput | undefined;
      try {
        const exact = record(
          await json(
            "coverartarchive",
            `https://coverartarchive.org/release/${id}`,
          ),
        );
        if (arr(exact.images).some((image) => image.front === true))
          artwork = art(
            `https://coverartarchive.org/release/${id}/front-500`,
            "coverartarchive",
            id,
            "edition",
          );
        else {
          const group = z
            .string()
            .uuid()
            .safeParse(record(release["release-group"]).id);
          if (group.success) {
            const fallback = record(
              await json(
                "coverartarchive",
                `https://coverartarchive.org/release-group/${group.data}`,
              ),
            );
            if (arr(fallback.images).some((image) => image.front === true))
              artwork = art(
                `https://coverartarchive.org/release-group/${group.data}/front-500`,
                "coverartarchive",
                group.data,
                "representative",
              );
          }
        }
      } catch (error) {
        warnings.push(`Artwork: ${warn(error)}`);
      }
      return [
        {
          id,
          provider: "musicbrainz",
          title: str(release.title),
          subtitle: `${str(release.date)} · ${str(release.country)} · ${str(release.disambiguation)}`,
          sourceUrl: `https://musicbrainz.org/release/${id}`,
          detail: false,
          patch: { ...releasePatch(release), ...(artwork ? { artwork } : {}) },
          warning:
            "Confirm label, catalog number and disc format against your physical copy. Missing artwork does not prevent saving metadata.",
        },
      ];
    }
    const escape = (value: string) =>
      value.replace(/[+\-!(){}\[\]^"~*?:\\/]/g, " ");
    const query = `release:"${escape(input.query)}"${input.artist ? ` AND artist:"${escape(input.artist)}"` : ""}`;
    const payload = record(
      await json(
        "musicbrainz",
        `https://musicbrainz.org/ws/2/release/?query=${encodeURIComponent(query)}&limit=8&fmt=json`,
      ),
    );
    return arr(payload.releases).map((r) => ({
      id: str(r.id),
      provider: "musicbrainz",
      title: str(r.title),
      subtitle: `${artistNames(r["artist-credit"]).join(" · ")} · ${str(r.date)} · ${str(r.country)} · ${arr(
        r.media,
      )
        .map((m) => str(m.format))
        .join(" + ")} · ${str(r.disambiguation)}`,
      sourceUrl: `https://musicbrainz.org/release/${r.id}`,
      detail: true,
      patch: {},
      warning:
        "Multiple physical editions can share a title. Select a release to inspect label, catalog number and discs.",
    }));
  };
  const itunes = async (): Promise<MetadataCandidate[]> => {
    const payload = record(
      await json(
        "itunes",
        `https://itunes.apple.com/search?term=${encodeURIComponent(`${input.artist} ${input.query}`.trim())}&entity=album&media=music&country=JP&limit=8`,
      ),
    );
    return arr(payload.results).map((r) => ({
      id: String(r.collectionId),
      provider: "itunes",
      title: str(r.collectionName),
      subtitle: `${str(r.artistName)} · digital album`,
      sourceUrl: str(r.collectionViewUrl),
      detail: false,
      patch: {
        title: str(r.collectionName),
        artists: [str(r.artistName)].filter(Boolean),
        releaseDate: str(r.releaseDate).slice(0, 10) || null,
      },
      warning:
        "Digital-album fallback only. Physical release date, label, catalog number, formats and tracks need confirmation. Apple promotional artwork is not copied into your collection.",
    }));
  };
  let candidates: MetadataCandidate[] = [];
  if (input.kind === "manga") {
    if (input.provider !== "openlibrary") candidates = await attempt(mangaDex);
    if (!candidates.length && !input.id && input.provider === "auto") {
      for (const alias of input.aliases
        .filter((alias) => alias !== input.query)
        .slice(0, 2)) {
        const original = input.query;
        input.query = alias;
        candidates = await attempt(mangaDex);
        input.query = original;
        if (candidates.length) break;
      }
    }
    if (
      !candidates.length &&
      !input.id &&
      ["auto", "openlibrary"].includes(input.provider)
    )
      candidates = await attempt(openLibrary);
  } else {
    if (input.provider !== "itunes") candidates = await attempt(musicBrainz);
    if (
      !candidates.length &&
      !input.id &&
      ["auto", "itunes"].includes(input.provider)
    )
      candidates = await attempt(itunes);
  }
  if (!candidates.length)
    warnings.push(
      "No reliable match found. Try an alternate title or enter the details manually.",
    );
  const normalized = (value: string) =>
    value
      .normalize("NFKC")
      .toLocaleLowerCase()
      .replace(/[^\p{L}\p{N}]/gu, "");
  const query = normalized(input.query);
  const score = (candidate: MetadataCandidate) =>
    Math.max(
      ...[candidate.title, ...(candidate.patch.aliases ?? [])].map((title) =>
        normalized(title) === query
          ? 100
          : normalized(title).includes(query)
            ? 50
            : 0,
      ),
    );
  candidates = candidates
    .filter((candidate) => publicImageUrl(candidate.sourceUrl))
    .sort((a, b) => score(b) - score(a));
  return { candidates, warnings };
}
