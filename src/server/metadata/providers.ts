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
import { ApiError } from "../http/api.ts";
import { MEDIUMS } from "../../domain/types.ts";
import type { Medium } from "../../domain/types.ts";

const object = z.record(z.unknown());
const str = (value: unknown) => (typeof value === "string" ? value : "");
const arr = (value: unknown): Record<string, unknown>[] =>
  z.array(object).parse(value ?? []);
const record = (value: unknown) => object.parse(value ?? {});
const strings = (value: unknown): string[] =>
  z.array(z.string()).parse(value ?? []);
export const lookupSchema = z.object({
  kind: z.enum(["manga", "cd"]),
  medium: z.enum(MEDIUMS).default("manga"),
  query: z.string().trim().min(1).max(200),
  artist: z.string().max(200).default(""),
  language: z.enum(["EN", "JP", "KR"]).default("EN"),
  volume: z.string().max(40).default("1"),
  publisher: z.string().max(200).default(""),
  aliases: z.array(z.string().max(200)).max(10).default([]),
  provider: z
    .enum(["auto", "mangadex", "openlibrary", "googlebooks", "musicbrainz", "itunes"])
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
  options: { contact?: string; fetcher?: Fetcher; googleBooksKey?: string } = {},
): Promise<MetadataResult> {
  const input = lookupSchema.parse(raw),
    warnings: string[] = [],
    failures: number[] = [];
  const json = (provider: string, url: string) =>
    providerJson(db, provider, url, { ...options, retry: input.retry });
  const attempt = async (task: () => Promise<MetadataCandidate[]>) => {
    try {
      return await task();
    } catch (error) {
      warnings.push(warn(error));
      failures.push(error instanceof ApiError ? error.status : 502);
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
      const names = (type: string) =>
        arr(manga.relationships)
          .filter((r) => r.type === type)
          .map((r) => str(record(r.attributes).name))
          .filter(Boolean);
      const authors = names("author");
      return {
        id: String(manga.id),
        provider: "mangadex",
        title,
        subtitle: authors.join(" · "),
        credits: [...new Set([...authors, ...names("artist")])],
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
        "Work-level metadata and representative cover; physical volume and edition are unverified.",
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
      value.replace(/[+\-!(){}[\]^"~*?:\\/]/g, " ");
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
  let googleMatched = false;
  const googleFirst = async () => {
    if (!options.googleBooksKey?.trim()) return [];
    const found = await attempt(() => googleBooksMetadata(db, input, options));
    googleMatched = found.some(candidate => candidate.applicable !== false);
    return googleMatched ? found : [];
  };
  if (input.kind === "manga" && input.provider === "googlebooks") {
    candidates = await attempt(() => googleBooksMetadata(db, input, options));
  } else if (input.kind === "manga" && input.medium === "book") {
    if (input.provider === "auto" && !input.id) candidates = await googleFirst();
    if (!candidates.length && !input.id)
      candidates = await attempt(() =>
        openLibraryBookCovers(
          db,
          {
            title: input.query,
            authors: input.artist ? [input.artist] : [],
            language: input.language,
            publisher: input.publisher,
            retry: input.retry,
          },
          options,
        ),
      );
    if (!candidates.length && !input.id)
      candidates = await attempt(openLibrary);
  } else if (input.kind === "manga") {
    // MangaDex is comics only; prose editions start with Google Books, then Open Library.
    if (input.provider !== "openlibrary" && input.medium === "manga")
      candidates = await attempt(mangaDex);
    if (
      !candidates.length &&
      !input.id &&
      input.provider === "auto" &&
      input.medium === "manga"
    ) {
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
    // Prefer Google Books before the Open Library edition fallback.
    if (!input.id && input.provider === "auto") candidates = [...(await googleFirst()), ...candidates];
    if (!input.id && !googleMatched && ["auto", "openlibrary"].includes(input.provider))
      candidates = [
        ...(await attempt(() =>
          openLibraryVolumeCovers(
            db,
            {
              titles: [input.query, ...input.aliases],
              language: input.language,
              volume: input.volume,
              publisher: input.publisher,
              medium: input.medium === "light_novel" ? "light_novel" : "manga",
              retry: input.retry,
            },
            options,
          ),
        )),
        ...candidates,
      ];
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
  candidates = candidates.filter(candidate => publicImageUrl(candidate.sourceUrl));
  // Keep Google search order and its preferred position ahead of fallback sources.
  if (!candidates.some(candidate => candidate.provider === "googlebooks"))
    candidates.sort((a, b) => score(b) - score(a));
  return { candidates, warnings, failures };
}

const binding = [
  "vol",
  "volume",
  "v",
  "no",
  "paperback",
  "softcover",
  "hardcover",
  "hard",
  "cover",
];
// Words an edition title may add around the series name and number. Each
// medium accepts only its own marker, so "(light novel)" never matches manga.
const filler: Record<"manga" | "light_novel", Set<string>> = {
  manga: new Set([...binding, "manga"]),
  // Vertical numbers its novels "Part 1"; its manga uses "Volume".
  light_novel: new Set([...binding, "part", "light", "novel", "ln"]),
};
const words = (value: string) =>
  value
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLocaleLowerCase()
    .replace(/['’]/g, "")
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
/** The printed volume number of an edition title such as "Spy x Family, Vol. 4". */
export function editionVolume(
  editionTitle: string,
  seriesTitles: string[],
  medium: "manga" | "light_novel" = "manga",
): string | null {
  const tokens = words(editionTitle);
  for (const series of seriesTitles.map(words).filter((s) => s.length)) {
    if (!series.every((word, i) => tokens[i] === word)) continue;
    const rest = tokens
      .slice(series.length)
      .filter((t) => !filler[medium].has(t));
    if (rest.length === 1 && /^\d+$/.test(rest[0]!))
      return String(Number(rest[0]));
    // A standalone light novel is catalogued without a number. Unnumbered
    // manga records are often omnibuses, so they are not treated as volume 1.
    if (!rest.length && medium === "light_novel") return "1";
  }
  return null;
}
const publisherKey = (value: string) =>
  words(value)
    .filter(
      (w) =>
        ![
          "llc",
          "inc",
          "incorporated",
          "america",
          "usa",
          "media",
          "press",
          "comics",
          "entertainment",
          "corporation",
          "publishing",
          "publishers",
          "communications",
          "co",
          "ltd",
          "shoten",
          "the",
        ].includes(w),
    )
    .join("");
// Imprints catalogued under their own names, per medium. Light-novel imprints
// such as Yen On only count for light novels: they are a different edition.
const imprints: Record<Medium, Record<string, string[]>> = {
  manga: {
    viz: ["shonenjump", "shojobeat", "vizsignature"],
    kodansha: ["vertical"],
    squareenix: ["squareenixmanga", "squareenixmangabooks"],
    sevenseas: ["ghostship"],
  },
  light_novel: {
    yen: ["yenon"],
    viz: ["haikasoru"],
    kodansha: ["vertical"],
    sevenseas: ["airship"],
    squareenix: ["squareenixbooks", "squareenixmangabooks"],
  },
  book: {},
};
// Publishers whose list is only prose light novels. A plain "Vol. N" from a
// house that also prints the manga (Yen Press) is not evidence of either.
const lightNovelImprints = new Set([
  "yenon",
  "airship",
  "haikasoru",
  "jnovelclub",
  "crossinfworld",
]);
const selfPublished =
  /independently published|createspace|lulu\.com|kindle direct/i;
export function samePublisher(
  owned: string,
  listed: string[],
  medium: Medium = "manga",
) {
  const key = publisherKey(owned);
  const names = [key, ...(imprints[medium][key] ?? [])];
  return Boolean(
    key &&
    listed.some((name) => {
      const other = publisherKey(name);
      // Exact after removing corporate suffixes: "Yen On" is not "Yen Press".
      return names.includes(other);
    }),
  );
}

/**
 * Edition-level Open Library search for one printed volume. Only editions whose
 * own title is the series title plus this volume number, in the owned language
 * and with a cover, are returned; publisher matches rank first.
 */
export async function openLibraryVolumeCovers(
  db: Store,
  query: {
    titles: string[];
    language: "EN" | "JP" | "KR";
    volume: string;
    publisher?: string;
    medium?: "manga" | "light_novel";
    retry?: boolean;
  },
  options: { contact?: string; fetcher?: Fetcher } = {},
): Promise<MetadataCandidate[]> {
  if (!/^\d+$/.test(query.volume)) return [];
  const medium = query.medium ?? "manga";
  const language = { EN: "eng", JP: "jpn", KR: "kor" }[query.language];
  const titles = [...new Set(query.titles.filter(Boolean))].slice(0, 2);
  const found = new Map<number, MetadataCandidate & { rank: number }>();
  for (const title of titles) {
    const q = `title:(${title.replace(/[():"[\]{}^~*?!+\-/&|]/g, " ")}) language:${language}`;
    const payload = record(
      await providerJson(
        db,
        "openlibrary",
        `https://openlibrary.org/search.json?q=${encodeURIComponent(q)}&fields=key,editions,editions.key,editions.title,editions.cover_i,editions.publisher,editions.language&limit=100`,
        { ...options, retry: query.retry ?? false },
      ),
    );
    for (const doc of arr(payload.docs)) {
      const edition = arr(record(doc.editions).docs)[0];
      if (!edition) continue;
      const cover = edition.cover_i,
        publishers = strings(edition.publisher),
        languages = strings(edition.language),
        key = str(edition.key);
      if (
        typeof cover !== "number" ||
        cover <= 0 ||
        found.has(cover) ||
        !/^\/books\/OL\d+M$/.test(key) ||
        publishers.some((name) => selfPublished.test(name)) ||
        (languages.length && !languages.includes(language)) ||
        Number(editionVolume(str(edition.title), titles, medium)) !==
          Number(query.volume)
      )
        continue;
      // Undefined when either side lists no publisher.
      const publisherMatch =
        query.publisher && publishers.length
          ? samePublisher(query.publisher, publishers, medium)
          : undefined;
      // Positive evidence of the owned medium: its title marker, Vertical's
      // "Part N" novel numbering, or a light-novel-only imprint.
      // Only words after the series title count ("Novel Series" is a name).
      const all = words(str(edition.title));
      const prefix = titles
        .map(words)
        .find((s) => s.length && s.every((w, i) => all[i] === w));
      const tokens = all.slice(prefix?.length ?? 0);
      const mediumEvidence =
        medium === "light_novel"
          ? tokens.some((t) => ["novel", "ln", "part"].includes(t)) ||
            publishers.some((p) => lightNovelImprints.has(publisherKey(p)))
          : tokens.includes("manga");
      found.set(cover, {
        id: key,
        provider: "openlibrary",
        title: str(edition.title),
        subtitle: `${publishers.slice(0, 2).join(" · ") || "Publisher unknown"} · Open Library edition`,
        sourceUrl: `https://openlibrary.org${key}`,
        detail: false,
        patch: {
          artwork: art(
            `https://covers.openlibrary.org/b/id/${cover}-L.jpg?default=false`,
            "openlibrary",
            key,
            "edition",
            query.language,
          ),
        },
        warning: publisherMatch
          ? "Open Library edition with this volume number, language and publisher. Confirm it against your copy."
          : publisherMatch === false
            ? "Open Library edition with this volume number and language from a different publisher; it may be another edition, such as a light novel."
            : "Open Library edition with this volume number and language; confirm the publisher against your copy.",
        ...(publisherMatch === undefined ? {} : { publisherMatch }),
        mediumEvidence,
        rank:
          (mediumEvidence ? 8 : 0) +
          (publisherMatch ? 2 : publisherMatch === false ? 0 : 1) * 2 +
          (/hard ?cover/i.test(str(edition.title)) ? 0 : 1),
      });
    }
    if (found.size) break;
  }
  return [...found.values()]
    .sort((a, b) => b.rank - a.rank)
    .map(({ rank: _rank, ...candidate }) => candidate);
}

const nameTokens = (names: string[]) =>
  new Set(
    names.flatMap((name) =>
      words(name)
        .map((token) => token.replace(/(.)\1+/gu, "$1"))
        .filter((token) => token.length >= 3),
    ),
  );
/**
 * Romanization and ordering vary (Ōima / Ooima / Oima, "Weir, Andy"), so
 * credits are compared as folded tokens. Missing credits on either side
 * neither confirm nor reject a match.
 */
export function creditsCompatible(provider: string[], owned: string[]) {
  if (!provider.length || !owned.length) return true;
  const tokens = nameTokens(owned);
  return [...nameTokens(provider)].some((token) => tokens.has(token));
}
// Derivative works that open with the book's title but are not the book.
const derivative = new Set([
  "guide",
  "summary",
  "study",
  "analysis",
  "workbook",
  "companion",
  "notes",
  "quiz",
  "trivia",
  "journal",
  "notebook",
  "calendar",
]);
const clean = (value: string) =>
  value.replace(/[():"[\]{}^~*?!+\-/&|]/g, " ");

/**
 * Edition-level Open Library search for a prose book. The edition title must
 * begin with the owned title (a subtitle may follow), the language must match,
 * credited authors must be compatible, and study guides, summaries and
 * self-published notebooks are rejected. The owned publisher is searched
 * first so the matching printing's cover ranks first.
 */
export async function openLibraryBookCovers(
  db: Store,
  query: {
    title: string;
    authors: string[];
    language: "EN" | "JP" | "KR";
    publisher?: string;
    retry?: boolean;
  },
  options: { contact?: string; fetcher?: Fetcher } = {},
): Promise<MetadataCandidate[]> {
  const language = { EN: "eng", JP: "jpn", KR: "kor" }[query.language];
  const title = words(query.title);
  if (!title.length) return [];
  const found = new Map<number, MetadataCandidate & { rank: number }>();
  for (const publisher of query.publisher ? [query.publisher, ""] : [""]) {
    const q = `title:(${clean(query.title)}) language:${language}${publisher ? ` publisher:(${clean(publisher)})` : ""}`;
    const payload = record(
      await providerJson(
        db,
        "openlibrary",
        `https://openlibrary.org/search.json?q=${encodeURIComponent(q)}&fields=key,title,author_name,editions,editions.key,editions.title,editions.cover_i,editions.publisher,editions.language&limit=20`,
        { ...options, retry: query.retry ?? false },
      ),
    );
    for (const doc of arr(payload.docs)) {
      const edition = arr(record(doc.editions).docs)[0];
      if (!edition) continue;
      const cover = edition.cover_i,
        publishers = strings(edition.publisher),
        languages = strings(edition.language),
        authors = strings(doc.author_name),
        key = str(edition.key),
        tokens = words(str(edition.title) || str(doc.title));
      if (
        typeof cover !== "number" ||
        cover <= 0 ||
        found.has(cover) ||
        !/^\/books\/OL\d+M$/.test(key) ||
        publishers.some((name) => selfPublished.test(name)) ||
        (languages.length && !languages.includes(language)) ||
        !title.every((word, i) => tokens[i] === word) ||
        tokens.slice(title.length).some((word) => derivative.has(word)) ||
        !creditsCompatible(authors, query.authors)
      )
        continue;
      const publisherMatch =
        query.publisher && publishers.length
          ? samePublisher(query.publisher, publishers, "book")
          : undefined;
      found.set(cover, {
        id: key,
        provider: "openlibrary",
        title: str(edition.title) || str(doc.title),
        subtitle: `${authors.join(" · ") || "Author unknown"} · ${publishers.slice(0, 2).join(" · ") || "Publisher unknown"} · Open Library edition`,
        sourceUrl: `https://openlibrary.org${key}`,
        detail: false,
        patch: {
          ...(authors.length ? { authors: authors.slice(0, 10) } : {}),
          ...(publishers[0] ? { publisher: publishers[0] } : {}),
          artwork: art(
            `https://covers.openlibrary.org/b/id/${cover}-L.jpg?default=false`,
            "openlibrary",
            key,
            "edition",
            query.language,
          ),
        },
        warning: publisherMatch
          ? "Open Library edition with this title, language, author and publisher. Confirm it against your copy."
          : publisherMatch === false
            ? "Open Library edition of this title from a different publisher; the cover may differ from your printing."
            : "Open Library edition of this title; confirm the publisher and cover against your copy.",
        credits: authors,
        ...(publisherMatch === undefined ? {} : { publisherMatch }),
        rank: (publisherMatch ? 2 : publisherMatch === false ? 0 : 1) * 2,
      });
    }
    if (found.size) break;
  }
  return [...found.values()]
    .sort((a, b) => b.rank - a.rank)
    .map(({ rank: _rank, ...candidate }) => candidate);
}

/** Optional, user-reviewed third source. Google search totals are never series volume counts. */
export async function googleBooksMetadata(
  db: Store,
  input: z.infer<typeof lookupSchema>,
  options: { googleBooksKey?: string; contact?: string; fetcher?: Fetcher } = {},
): Promise<MetadataCandidate[]> {
  if (!options.googleBooksKey?.trim())
    throw new ApiError(422, "Google Books is not configured. Add GOOGLE_BOOKS_API_KEY to the server's .dev.vars, then restart the app. Setup: docs/GOOGLE_BOOKS.md.");
  const isbn = input.query.replace(/[\s-]/g, "");
  const byIsbn = /^(\d{13}|\d{9}[\dXx])$/.test(isbn);
  const query = byIsbn ? `isbn:${isbn}` : `intitle:${clean(input.query)}${input.artist ? ` inauthor:${clean(input.artist)}` : ""}${input.medium !== "book" ? ` ${input.volume}` : ""}`;
  const params = new URLSearchParams({ q: query, langRestrict: lang[input.language], printType: "books", maxResults: "12" });
  const payload = record(await providerJson(db, "googlebooks", `https://www.googleapis.com/books/v1/volumes?${params}`, {
    ...options, retry: input.retry,
  }));
  const candidates: MetadataCandidate[] = [];
  for (const item of arr(payload.items)) {
    const id = str(item.id);
    if (!/^[A-Za-z0-9_-]{1,100}$/.test(id)) continue;
    const info = record(item.volumeInfo);
    const title = str(info.title), subtitle = str(info.subtitle);
    const fullTitle = [title, subtitle].filter(Boolean).join(": ");
    if (!title) continue;
    const languageMatch = info.language === lang[input.language];
    const authors = strings(info.authors).slice(0, 30);
    const authorMatch = creditsCompatible(authors, input.artist ? [input.artist] : []);
    const publisher = str(info.publisher);
    const titles = [input.query, ...input.aliases];
    const volume = input.medium === "book" ? null : editionVolume(fullTitle, titles, input.medium);
    const sameTitle = input.medium === "book" && titles.some(name => {
      const prefix = words(name), tokens = words(fullTitle);
      return prefix.length > 0 && prefix.every((word, i) => tokens[i] === word) && !tokens.slice(prefix.length).some(word => derivative.has(word));
    });
    const titleMatch = byIsbn || (input.medium === "book" ? sameTitle : volume === String(Number(input.volume)));
    const publisherMatch = input.publisher && publisher ? samePublisher(input.publisher, [publisher], input.medium) : undefined;
    // A Google volume can describe a digital edition. Neither its ISBN nor its
    // title establishes the physical format, so art always starts representative.
    let image: string | null = null;
    const images = record(info.imageLinks);
    const rawImage = str(images.thumbnail) || str(images.smallThumbnail);
    try {
      const url = new URL(rawImage);
      if (["books.google.com", "books.googleusercontent.com"].includes(url.hostname) && ["http:", "https:"].includes(url.protocol) && !url.username && !url.password && !url.port) {
        url.protocol = "https:";
        url.searchParams.delete("key");
        image = url.href;
      }
    } catch { /* Missing images do not prevent useful metadata suggestions. */ }
    const sourceUrl = `https://books.google.com/books?id=${encodeURIComponent(id)}`;
    const identifiers = arr(info.industryIdentifiers).filter(value => ["ISBN_10", "ISBN_13"].includes(str(value.type))).map(value => str(value.identifier)).filter(Boolean);
    const isbnMatch = !byIsbn || identifiers.some(value => value.replace(/[\s-]/g, "").toUpperCase() === isbn.toUpperCase());
    const applicable = languageMatch && authorMatch && titleMatch && isbnMatch;
    const warning = [
      !applicable ? "This result does not match the requested title/volume, language, author or ISBN. It cannot be applied to this copy." : "",
      "Google Books metadata; physical format and edition need review. No acquisition data is changed.",
      publisherMatch === false ? "Publisher differs from your copy." : "",
      item.saleInfo && record(item.saleInfo).isEbook === true ? "Google identifies this listing as an eBook." : "",
      str(info.publishedDate) ? `Catalog publication date: ${str(info.publishedDate)} (not your acquisition date).` : "",
    ].filter(Boolean).join(" ");
    candidates.push({
      id, provider: "googlebooks", title: fullTitle,
      subtitle: [authors.join(" · "), publisher, identifiers.join(" / ")].filter(Boolean).join(" · "),
      sourceUrl, detail: false, warning, credits: authors, applicable,
      ...(publisherMatch === undefined ? {} : { publisherMatch }),
      patch: {
        ...(input.medium === "book" ? { title } : {}),
        ...(authors.length ? { authors } : {}),
        ...(publisher ? { publisher } : {}),
        ...(image ? { artwork: { ...art(image, "googlebooks", id, "representative", input.language), attribution: "Google Books · representative cover; physical edition unverified" } } : {}),
      },
    });
  }
  return candidates;
}
