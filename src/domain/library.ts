import type { Language, LanguageBasis } from "./types.ts";

export interface MangaCopy {
  id: string;
  editionRunId: string;
  editionTitle: string;
  publisher: string;
  language: Language;
  languageBasis: LanguageBasis;
  volume: string;
  volumeSort: number | null;
  numberingBasis: "printed" | "source_record" | "unknown";
  format: string;
  acquiredOn: string | null;
  notes: string | null;
  tags: string[];
}
export interface MangaSeries {
  kind: "manga";
  id: string;
  title: string;
  authors: string[];
  aliases: string[];
  copies: MangaCopy[];
}
export interface CdCopy {
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
export type LibraryEntry = MangaSeries | CdAlbum;
export interface LibraryData {
  entries: LibraryEntry[];
}
export interface BrowseState {
  media: "all" | "manga" | "cd";
  view: "grid" | "spines";
  query: string;
  language: string;
  publisher: string;
  memory: string;
  sort: "title" | "recent";
  item: string;
}
export const defaultBrowseState: BrowseState = {
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
    media:
      params.get("media") === "manga"
        ? "manga"
        : params.get("media") === "cd"
          ? "cd"
          : "all",
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
  if (state.media !== "all") params.set("media", state.media);
  if (state.view !== "grid") params.set("view", state.view);
  if (state.query) params.set("q", state.query);
  for (const field of ["language", "publisher", "memory", "item"] as const)
    if (state[field]) params.set(field, state[field]);
  if (state.sort !== "title") params.set("sort", state.sort);
  return params;
}
const searchText = (value: string) =>
  value.normalize("NFKD").replace(/\p{M}/gu, "").toLocaleLowerCase();
export function matchingCopies(
  entry: LibraryEntry,
  state: BrowseState,
): (MangaCopy | CdCopy)[] {
  const terms = searchText(state.query.trim()).split(/\s+/).filter(Boolean);
  if (state.media !== "all" && state.media !== entry.kind) return [];
  if (entry.kind === "manga") {
    const common = [entry.title, ...entry.authors, ...entry.aliases].join(" ");
    return entry.copies.filter((copy) => {
      if (state.language && state.language !== copy.language) return false;
      if (state.publisher && state.publisher !== copy.publisher) return false;
      if (state.memory && !copy.tags.includes(state.memory)) return false;
      const haystack = searchText(
        [common, copy.editionTitle, copy.publisher, copy.notes ?? ""].join(" "),
      );
      return terms.every((term) => haystack.includes(term));
    });
  }
  if (state.language || state.publisher || state.memory) return [];
  const common = [
    entry.title,
    ...entry.artists,
    ...entry.labels,
    ...entry.catalogNumbers,
  ].join(" ");
  return entry.copies.filter((copy) => {
    const haystack = searchText(`${common} ${copy.notes ?? ""}`);
    return terms.every((term) => haystack.includes(term));
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
  editionRunId: string;
  title: string;
  language: Language;
  publisher: string;
  missing: string[];
  uncertain: boolean;
}
export function seriesGaps(series: MangaSeries): GapGroup[] {
  const groups = new Map<string, MangaCopy[]>();
  for (const copy of series.copies) {
    const group = groups.get(copy.editionRunId) ?? [];
    group.push(copy);
    groups.set(copy.editionRunId, group);
  }
  return [...groups.entries()].map(([editionRunId, copies]) => {
    const first = copies[0]!;
    const uncertain = copies.some(
      (copy) => copy.numberingBasis !== "printed" || !/^\d+$/.test(copy.volume),
    );
    const numbers = [
      ...new Set(copies.map((copy) => Number(copy.volume))),
    ].sort((a, b) => a - b);
    const missing: string[] = [];
    if (!uncertain)
      for (let index = 1; index < numbers.length; index++) {
        const start = numbers[index - 1]! + 1,
          end = numbers[index]! - 1;
        if (end >= start)
          missing.push(start === end ? String(start) : `${start}–${end}`);
      }
    return {
      editionRunId,
      title: first.editionTitle,
      language: first.language,
      publisher: first.publisher,
      missing,
      uncertain,
    };
  });
}
