import { z } from "zod";
import { digest, statement as s } from "../db/store.ts";
import type { Store } from "../db/store.ts";
import { libraryData } from "../services/library.ts";
import { providerJson } from "./http.ts";
import type { Fetcher } from "./http.ts";
import { creditsCompatible, editionVolume, samePublisher } from "./providers.ts";
import { ApiError } from "../http/api.ts";
import { publicationDate, releaseCatalogSchema, releaseScope } from "../../domain/releases.ts";
import type { ReleaseCatalog, ReleasedVolume } from "../../domain/releases.ts";
import type { MangaCopy, MangaSeries } from "../../domain/library.ts";

const object = z.record(z.unknown());
const record = (value: unknown) => object.parse(value ?? {});
const rows = (value: unknown) => z.array(object).parse(value ?? []);
const names = (value: unknown) => typeof value === "string" ? [value] : z.array(z.string()).parse(value ?? []);
const text = (value: unknown) => typeof value === "string" ? value : "";
const clean = (value: string) => value.replace(/[():"[\]{}^~*?!+\-/&|]/g, " ");
const language = {EN: "en", JP: "ja", KR: "ko"};
const olLanguage = {EN: "eng", JP: "jpn", KR: "kor"};
const MAX_PAGES = 4;
const MAX_RESULTS = 2000;
export const releaseLookupSchema = z.object({
  editionRunId: z.string().min(1).max(100),
  query: z.string().trim().min(1).max(200).optional(),
  provider: z.enum(["auto", "googlebooks", "openlibrary"]).default("auto"),
  continuation: z.boolean().default(false),
  retry: z.boolean().default(false),
});
interface Options { googleBooksKey?: string; contact?: string; fetcher?: Fetcher; today?: string }

async function context(db: Store, editionRunId: string) {
  const data = await libraryData(sql => db.all(sql));
  const entry = data.entries.find((entry): entry is MangaSeries => entry.kind === "manga" && entry.copies.some(copy => copy.editionRunId === editionRunId));
  if (!entry) throw new ApiError(404, "No collected manga or light novel edition matches this lookup.");
  const scope = releaseScope(entry, editionRunId);
  if (!scope.copy || scope.reason) throw new ApiError(422, scope.reason ?? "Edition metadata is incomplete.");
  const copy = scope.copy;
  const identity = [entry.title, entry.aliases, entry.authors, copy.editionRunId, copy.editionTitle, copy.language, copy.languageBasis, copy.publisher, copy.format, copy.medium];
  return { entry, copy, key: `release-catalog-v1:${await digest(JSON.stringify(identity))}` };
}
async function saved(db: Store, key: string) {
  const row = (await db.all("SELECT payload_json FROM metadata_cache WHERE cache_key=? AND status='ready'", [key]))[0];
  if (!row?.payload_json) return null;
  return releaseCatalogSchema.parse(JSON.parse(String(row.payload_json)));
}
export async function readReleaseCatalog(db: Store, editionRunId: string) {
  const {key} = await context(db, editionRunId);
  return saved(db, key);
}
/** Numbering must describe this physical edition, never the component volumes in an omnibus. */
export function releaseNumber(title: string, titles: string[], copy: Pick<MangaCopy, "format" | "medium">) {
  const special = /\b(?:omnibus|collectors?|deluxe|perfect edition|\d+\s*[- ]in[- ]\s*\d+)\b/i;
  if (copy.format === "standard" && special.test(title)) return null;
  if (copy.format === "omnibus" && !/\bomnibus\b|\d+\s*[- ]in[- ]\s*\d+/i.test(title)) return null;
  if (copy.format === "collectors" && !/\bcollectors?\b|\bdeluxe\b|\bperfect edition\b/i.test(title.replace(/[’']/g, ""))) return null;
  if (!["standard", "collectors", "omnibus"].includes(copy.format)) return null;
  if (copy.medium === "light_novel" && !/\b(?:light novel|novel|part\s+\d+)\b/i.test(title)) return null;
  const normalized = (value: string) => value.replace(/\b\d+\s*[- ]in[- ]\s*\d+\s*(?:edition)?\b/gi, " ").replace(/\b(?:omnibus|collectors?['’]?s?\s+edition|deluxe(?:\s+edition)?|perfect edition)\b/gi, " ");
  const label = editionVolume(normalized(title), titles.map(normalized), copy.medium === "light_novel" ? "light_novel" : "manga");
  const number = Number(label);
  return label !== null && Number.isSafeInteger(number) && number > 0 ? number : null;
}
function matchVolume(raw: {title: string; publishers: string[]; languages: string[]; authors: string[]; date: string; sourceUrl: string; digital: boolean | null}, entry: MangaSeries, copy: MangaCopy, query: string, provider: ReleaseCatalog["provider"], today: string): ReleasedVolume | null {
  const titles = [...new Set([query, entry.title, copy.editionTitle.replace(/\s*\((?:EN|JP|KR)\)\s*$/i, ""), ...entry.aliases])];
  const number = releaseNumber(raw.title, titles, copy);
  const date = publicationDate(raw.date);
  if (!number || !date || date.date > today || !raw.languages.includes(provider === "googlebooks" ? language[copy.language] : olLanguage[copy.language]) || !samePublisher(copy.publisher, raw.publishers, copy.medium) || !raw.authors.length || !entry.authors.length || !creditsCompatible(raw.authors, entry.authors)) return null;
  return {number, title: raw.title.slice(0, 1000), sourceUrl: raw.sourceUrl, publishedOn: date.date, datePrecision: date.precision, provider, digital: raw.digital};
}

/** Lookup all available pages in bounded chunks. Completeness of a catalog is never assumed. */
export async function lookupReleasedVolumes(db: Store, raw: unknown, options: Options = {}): Promise<ReleaseCatalog> {
  const input = releaseLookupSchema.parse(raw);
  const {entry, copy, key} = await context(db, input.editionRunId);
  const previous = input.continuation ? await saved(db, key) : null;
  if (input.continuation && (!previous || previous.nextOffset === null)) throw new ApiError(409, "No catalog lookup is waiting for more pages. Start a new lookup.");
  const query = previous?.query ?? input.query ?? copy.editionTitle.replace(/\s*\((?:EN|JP|KR)\)\s*$/i, "");
  const today = options.today ?? new Date().toISOString().slice(0, 10);
  let provider = previous?.provider ?? (input.provider === "auto" ? options.googleBooksKey?.trim() ? "googlebooks" : "openlibrary" : input.provider);
  if (provider === "googlebooks" && !options.googleBooksKey?.trim()) throw new ApiError(422, "Configure GOOGLE_BOOKS_API_KEY to search Google Books, or choose Open Library.");
  const warnings = (previous?.warnings ?? []).filter(warning => !warning.startsWith("Catalog page issue:") && !warning.startsWith("The scan is partial."));
  if (!previous && input.provider === "auto" && !options.googleBooksKey?.trim()) warnings.push("Google Books is not configured; using Open Library.");
  const scan = async (source: ReleaseCatalog["provider"]): Promise<ReleaseCatalog> => {
    let offset: number | null = previous?.nextOffset ?? 0;
    let scanned = previous?.scanned ?? 0, excluded = previous?.excluded ?? 0;
    const volumes = [...(previous?.volumes ?? [])];
    const seen = new Set(volumes.map(volume => volume.sourceUrl));
    let lastPageSignature = previous?.lastPageSignature ?? null;
    for (let page = 0; page < MAX_PAGES && offset !== null; page++) {
      const start: number = offset;
      const size = source === "googlebooks" ? 40 : 100;
      let payload: Record<string, unknown>;
      try {
        if (source === "googlebooks") {
          const params = new URLSearchParams({q: `intitle:${clean(query)}`, langRestrict: language[copy.language], printType: "books", showPreorders: "false", maxResults: String(size), startIndex: String(start)});
          payload = record(await providerJson(db, source, `https://www.googleapis.com/books/v1/volumes?${params}`, {...options, retry: input.retry}));
        } else {
          const params = new URLSearchParams({q: `title:(${clean(query)}) language:${olLanguage[copy.language]}`, fields: "key,title,author_name,editions,editions.key,editions.title,editions.publisher,editions.language,editions.publish_date", limit: String(size), offset: String(start)});
          payload = record(await providerJson(db, source, `https://openlibrary.org/search.json?${params}`, {...options, retry: input.retry}));
        }
      } catch (error) {
        if (!volumes.length && scanned === 0) throw error;
        warnings.push(`Catalog page issue: ${error instanceof ApiError ? error.message : "A catalog page could not be read."}`);
        warnings.push("The scan is partial. Previously retrieved releases are kept; load more to retry this page.");
        break;
      }
      const items = rows(source === "googlebooks" ? payload.items : payload.docs);
      const signature = await digest(JSON.stringify(items.map(item => item.id ?? item.key)));
      if (items.length && signature === lastPageSignature) {
        warnings.push("The provider repeated a page. The scan stopped to avoid repeated requests; catalog coverage may be incomplete.");
        offset = null;
        break;
      }
      lastPageSignature = signature;
      for (const item of items) {
        scanned++;
        const info = source === "googlebooks" ? record(item.volumeInfo) : rows(record(item.editions).docs)[0];
        const id = text(source === "googlebooks" ? item.id : info?.key);
        if (!info || (source === "googlebooks" ? !/^[\w-]{1,100}$/.test(id) : !/^\/books\/OL\d+M$/.test(id))) { excluded++; continue; }
        const volume = matchVolume({
          title: source === "googlebooks" ? [text(info.title), text(info.subtitle)].filter(Boolean).join(": ") : text(info.title),
          publishers: source === "googlebooks" ? [text(info.publisher)] : names(info.publisher),
          languages: source === "googlebooks" ? [text(info.language)] : names(info.language),
          authors: source === "googlebooks" ? names(info.authors) : names(item.author_name),
          date: source === "googlebooks" ? text(info.publishedDate) : names(info.publish_date)[0] ?? "",
          sourceUrl: source === "googlebooks" ? `https://books.google.com/books?id=${encodeURIComponent(id)}` : `https://openlibrary.org${id}`,
          digital: source === "googlebooks" && typeof record(item.saleInfo).isEbook === "boolean" ? Boolean(record(item.saleInfo).isEbook) : null,
        }, entry, copy, query, source, today);
        if (!volume) { excluded++; continue; }
        if (!seen.has(volume.sourceUrl)) { seen.add(volume.sourceUrl); volumes.push(volume); }
      }
      const total = Number(source === "googlebooks" ? payload.totalItems : payload.numFound);
      // Provider totals are hints for paging only, never a volume count.
      offset = items.length === 0 || (Number.isFinite(total) && start + items.length >= total) || (items.length < size && !Number.isFinite(total)) ? null : start + items.length;
      if (offset !== null && offset >= MAX_RESULTS) { warnings.push("The catalog scan reached 2,000 listings. Narrow the lookup title; more releases may exist."); offset = null; }
    }
    return {editionRunId: copy.editionRunId, query, provider: source, checkedAt: new Date().toISOString(), volumes, scanned, excluded, nextOffset: offset, lastPageSignature, warnings: [...new Set(warnings)]};
  };
  let result: ReleaseCatalog;
  try { result = await scan(provider); }
  catch (error) {
    if (previous || input.provider !== "auto" || provider !== "googlebooks") throw error;
    warnings.push(error instanceof ApiError ? error.message : "Google Books is unavailable.");
    warnings.push("Using Open Library as a fallback.");
    provider = "openlibrary";
    result = await scan(provider);
  }
  if (!previous && input.provider === "auto" && result.provider === "googlebooks" && !result.volumes.length && result.nextOffset === null) {
    warnings.push("No compatible released numbers found on Google Books; checked Open Library next.");
    result = await scan("openlibrary");
  }
  if (result.provider === "openlibrary") result.warnings.push("Open Library search exposes a selected edition per work, so other matching editions may be absent.");
  result.warnings = [...new Set(result.warnings)];
  const parsed = releaseCatalogSchema.parse(result);
  await db.batch([s(`INSERT INTO metadata_cache(cache_key,provider,adapter_version,payload_json,status,fetched_at,expires_at) VALUES (?,'release-catalog','1',?,'ready',?,?)
    ON CONFLICT(cache_key) DO UPDATE SET payload_json=excluded.payload_json,status='ready',fetched_at=excluded.fetched_at,expires_at=excluded.expires_at`, key, JSON.stringify(parsed), parsed.checkedAt, new Date(Date.now() + 7 * 86400000).toISOString())]);
  return parsed;
}
