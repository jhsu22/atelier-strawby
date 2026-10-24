import type { Language, LanguageBasis, Medium } from "./types.ts";

export interface Artwork {
  url: string;
  scope: "edition" | "representative";
  attribution: string;
  provider: string;
  sourceUrl: string;
}

export interface MangaCopy {
  version?: number;
  artwork?: Artwork | null;
  id: string;
  editionRunId: string;
  editionTitle: string;
  publisher: string;
  language: Language;
  languageBasis: LanguageBasis;
  volume: string;
  volumeSort: number | null;
  numberingBasis: "printed" | "source_record" | "unknown";
  medium: Medium;
  format: string;
  acquiredOn: string | null;
  notes: string | null;
  tags: string[];
}
/** A series of volume-shaped copies: manga (incl. light novels) or books. */
export interface SeriesEntry {
  kind: "manga" | "book";
  id: string;
  title: string;
  authors: string[];
  aliases: string[];
  copies: MangaCopy[];
}
export interface CdCopy {
  version?: number;
  tags?: string[];
  id: string;
  acquiredOn: string | null;
  notes: string | null;
  isSample: boolean;
}
export interface CdTrack {
  medium: number;
  position: number;
  title: string;
  durationMs: number | null;
}
export interface CdAlbum {
  artwork?: Artwork | null;
  editionTitle?: string;
  kind: "cd";
  id: string;
  title: string;
  artists: string[];
  releaseId: string;
  releaseDate: string | null;
  formats: string[];
  labels: string[];
  catalogNumbers: string[];
  tracks: CdTrack[];
  copies: CdCopy[];
}
export interface MangaSeries extends SeriesEntry {
  kind: "manga";
}
export interface BookSeries extends SeriesEntry {
  kind: "book";
}
export type LibraryEntry = MangaSeries | BookSeries | CdAlbum;
export interface LibraryData {
  entries: LibraryEntry[];
}
export interface BrowseState {
  /** Manga vs light novel within volume-shaped entries; "" shows both. */
  type?: "" | "manga" | "light_novel";
  section: "shelf" | "timeline" | "stats";
  year?: string;
  format?: string;
  media: "all" | "manga" | "book" | "cd";
  view: "grid" | "spines";
  query: string;
  language: string;
  publisher: string;
  memory: string;
  sort: "title" | "recent";
  item: string;
}
export const defaultBrowseState: BrowseState = {
  section: "shelf",
  type: "",
  year: "",
  format: "",
  media: "all",
  view: "grid",
  query: "",
  language: "",
  publisher: "",
  memory: "",
  sort: "title",
  item: "",
};
export function parseBrowseState(params: URLSearchParams): BrowseState {
  return {
    section: params.get("section") === "timeline" || params.get("section") === "stats" ? params.get("section") as "timeline" | "stats" : "shelf",
    type:
      params.get("type") === "manga" || params.get("type") === "light_novel"
        ? (params.get("type") as "manga" | "light_novel")
        : "",
    year: /^(\d{4}|unknown)$/.test(params.get("year") ?? "")
      ? params.get("year")!
      : "",
    format: (params.get("format") ?? "").slice(0, 100),
    media:
      (["manga", "book", "cd"] as const).find(
        (media) => media === params.get("media"),
      ) ?? "all",
    view: params.get("view") === "spines" ? "spines" : "grid",
    query: (params.get("q") ?? "").slice(0, 200),
    language: ["EN", "JP", "KR"].includes(params.get("language") ?? "")
      ? params.get("language")!
      : "",
    publisher: (params.get("publisher") ?? "").slice(0, 200),
    memory: (params.get("memory") ?? "").slice(0, 100),
    sort: params.get("sort") === "recent" ? "recent" : "title",
    item: (params.get("item") ?? "").slice(0, 100),
  };
}
export function browseParams(state: BrowseState): URLSearchParams {
  const params = new URLSearchParams();
  if (state.section !== "shelf") params.set("section", state.section);
  if (state.media !== "all") params.set("media", state.media);
  if (state.view !== "grid") params.set("view", state.view);
  if (state.query) params.set("q", state.query);
  if (state.type) params.set("type", state.type);
  if (state.year) params.set("year", state.year);
  if (state.format) params.set("format", state.format);
  for (const field of ["language", "publisher", "memory", "item"] as const)
    if (state[field]) params.set(field, state[field]);
  if (state.sort !== "title") params.set("sort", state.sort);
  return params;
}
const searchText = (value: string) =>
  value.normalize("NFKD").replace(/\p{M}/gu, "").toLocaleLowerCase();
// Exact substrings win; words of four or more letters permit one edit or
// transposition. Numbers and short words remain exact to avoid volume noise.
export function fuzzyTerm(term: string, text: string): boolean {
  if (text.includes(term)) return true;
  if (term.length < 4 || !/^\p{L}+$/u.test(term)) return false;
  return text.split(/[^\p{L}\p{N}]+/u).some((word) => {
    if (Math.abs(word.length - term.length) > 1) return false;
    let i = 0,
      j = 0,
      edits = 0;
    while (i < term.length && j < word.length) {
      if (term[i] === word[j]) {
        i++;
        j++;
        continue;
      }
      if (++edits > 1) return false;
      if (term.length === word.length) {
        if (term[i] === word[j + 1] && term[i + 1] === word[j]) {
          i += 2;
          j += 2;
        } else {
          i++;
          j++;
        }
      } else if (term.length > word.length) i++;
      else j++;
    }
    return edits + Number(i < term.length || j < word.length) <= 1;
  });
}
export function matchingCopies(
  entry: LibraryEntry,
  state: BrowseState,
): (MangaCopy | CdCopy)[] {
  const terms = searchText(state.query.trim()).split(/\s+/).filter(Boolean);
  if (state.media !== "all" && state.media !== entry.kind) return [];
  if (entry.kind !== "cd") {
    const common = [entry.title, ...entry.authors, ...entry.aliases].join(" ");
    return entry.copies.filter((copy) => {
      if (state.type && state.type !== copy.medium) return false;
      if (
        state.year &&
        (copy.acquiredOn?.slice(0, 4) ?? "unknown") !== state.year
      )
        return false;
      if (
        state.format &&
        state.format !== copy.format &&
        state.format !== copy.editionTitle
      )
        return false;
      if (state.language && state.language !== copy.language) return false;
      if (state.publisher && state.publisher !== copy.publisher) return false;
      if (state.memory && !copy.tags.includes(state.memory)) return false;
      const haystack = searchText(
        [common, copy.editionTitle, copy.publisher, copy.notes ?? ""].join(" "),
      );
      return terms.every((term) => fuzzyTerm(term, haystack));
    });
  }
  if (
    state.language ||
    state.type ||
    (state.publisher && !entry.labels.includes(state.publisher))
  )
    return [];
  if (
    state.format &&
    !entry.formats.includes(state.format) &&
    state.format !== entry.editionTitle
  )
    return [];
  const common = [
    entry.title,
    ...entry.artists,
    ...entry.labels,
    ...entry.catalogNumbers,
    entry.editionTitle ?? "",
  ].join(" ");
  return entry.copies.filter((copy) => {
    if (
      state.year &&
      (copy.acquiredOn?.slice(0, 4) ?? "unknown") !== state.year
    )
      return false;
    if (state.memory && !copy.tags?.includes(state.memory)) return false;
    const haystack = searchText(`${common} ${copy.notes ?? ""}`);
    return terms.every((term) => fuzzyTerm(term, haystack));
  });
}
export function browseEntries(
  entries: LibraryEntry[],
  state: BrowseState,
): LibraryEntry[] {
  const result = entries.filter(
    (entry) => matchingCopies(entry, state).length > 0,
  );
  return result.sort((a, b) => {
    if (state.sort === "recent") {
      const latest = (entry: LibraryEntry) =>
        entry.copies
          .map((copy) => copy.acquiredOn ?? "")
          .sort()
          .at(-1) ?? "";
      const date = latest(b).localeCompare(latest(a));
      if (date) return date;
    }
    return a.title.localeCompare(b.title, "en", { numeric: true });
  });
}
export interface GapGroup {
  key: string;
  editionRunId: string;
  title: string;
  language: Language;
  publisher: string;
  format: string;
  missing: string[];
  ranges: { start: number; end: number; count: number }[];
  uncertain: boolean;
  reason: string | null;
}
/** Compare only compatible printed sequences, never infer a series' release extent. */
export function seriesGaps(series: SeriesEntry): GapGroup[] {
  const groups = new Map<string, MangaCopy[]>();
  for (const copy of series.copies) {
    // Defensive separation also protects against inconsistent imported run metadata.
    const key = JSON.stringify([copy.editionRunId, copy.editionTitle, copy.language,
      copy.publisher, copy.format, copy.medium,
      [...new Set(copy.tags.filter(tag => ["Omnibus", "Collector's Edition"].includes(tag)))].sort()]);
    const group = groups.get(key) ?? [];
    group.push(copy);
    groups.set(key, group);
  }
  return [...groups.entries()].map(([key, copies]) => {
    const first = copies[0]!;
    const incomplete = !first.editionRunId.trim() || !first.editionTitle.trim() ||
      !first.publisher.trim() || /^unknown publisher$/i.test(first.publisher) ||
      !["EN", "JP", "KR"].includes(first.language) ||
      !["standard", "collectors", "omnibus", "artbook", "anthology"].includes(first.format);
    // Numeric omnibus labels can be compared only when they explicitly represent
    // printed omnibus numbers. Source-record numbers and content ranges cannot.
    const ambiguous = copies.some(copy => copy.numberingBasis !== "printed" ||
      !/^\d+$/.test(copy.volume) ||
      (copy.format !== "omnibus" && (copy.tags.includes("Omnibus") || /omnibus/i.test(copy.notes ?? ""))) || !Number.isSafeInteger(Number(copy.volume)) || Number(copy.volume) < 1);
    const reason = incomplete ? "Edition, language, publisher or format metadata needs confirmation."
      : ambiguous ? "Numbering or omnibus packaging needs confirmation before gaps can be calculated." : null;
    const ranges: GapGroup["ranges"] = [];
    const numbers = [...new Set(copies.map(copy => Number(copy.volume)))].sort((a, b) => a - b);
    if (!reason) for (let index = 1; index < numbers.length; index++) {
      const start = numbers[index - 1]! + 1, end = numbers[index]! - 1;
      if (end >= start) ranges.push({ start, end, count: end - start + 1 });
    }
    return { key, editionRunId: first.editionRunId, title: first.editionTitle,
      language: first.language, publisher: first.publisher, format: first.format,
      ranges, missing: ranges.map(({start, end}) => start === end ? String(start) : `${start}–${end}`),
      uncertain: Boolean(reason), reason };
  });
}

const artistOrder = new Intl.Collator("en", {
  sensitivity: "base",
  numeric: true,
});
const byCreator = (
  x: { names: string[]; title: string; order: number; id: string },
  y: { names: string[]; title: string; order: number; id: string },
) => {
  const [a, b] = [x.names[0] ?? "", y.names[0] ?? ""];
  if (!a !== !b) return a ? -1 : 1;
  return (
    artistOrder.compare(a, b) ||
    artistOrder.compare(x.title, y.title) ||
    x.order - y.order ||
    x.id.localeCompare(y.id)
  );
};
/**
 * Every visible book copy on one shelf, alphabetical by first author, then
 * title and series number. Books without a known author sort last.
 */
export function bookShelf(
  entries: LibraryEntry[],
  state: BrowseState,
): { entry: BookSeries; copy: MangaCopy }[] {
  const key = ({ entry, copy }: { entry: BookSeries; copy: MangaCopy }) => ({
    names: entry.authors,
    title: entry.title,
    order: copy.volumeSort ?? Number.MAX_SAFE_INTEGER,
    id: copy.id,
  });
  return entries
    .filter((entry): entry is BookSeries => entry.kind === "book")
    .flatMap((entry) =>
      (matchingCopies(entry, state) as MangaCopy[]).map((copy) => ({
        entry,
        copy,
      })),
    )
    .sort((a, b) => byCreator(key(a), key(b)));
}
/**
 * Every visible CD copy on one shelf, alphabetical by first credited artist,
 * then album title. CDs without a known artist sort last.
 */
export function cdShelf(
  entries: LibraryEntry[],
  state: BrowseState,
): { entry: CdAlbum; copy: CdCopy }[] {
  return entries
    .filter((entry): entry is CdAlbum => entry.kind === "cd")
    .flatMap((entry) =>
      (matchingCopies(entry, state) as CdCopy[]).map((copy) => ({
        entry,
        copy,
      })),
    )
    .sort((a, b) =>
      byCreator(
        {
          names: a.entry.artists,
          title: a.entry.title,
          order: 0,
          id: a.copy.id,
        },
        {
          names: b.entry.artists,
          title: b.entry.title,
          order: 0,
          id: b.copy.id,
        },
      ),
    );
}
