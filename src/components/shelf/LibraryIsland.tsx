import { useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";
import {
  ArrowDownUp,
  ArrowRight,
  BookOpen,
  Grid2X2,
  History,
  LibraryBig,
  Moon,
  Plus,
  RefreshCw,
  Search,
  SlidersHorizontal,
  Sun,
  X,
  ChartNoAxesColumnIncreasing,
} from "lucide-react";
import type {
  LibraryData,
  BrowseState,
  LibraryEntry,
} from "../../domain/library.ts";
import {
  browseEntries,
  browseParams,
  matchingCopies,
  cdShelf,
  bookShelf,
  parseBrowseState,
} from "../../domain/library.ts";
import { librarySchema } from "../../domain/library-schema.ts";
import { MediaArtwork, Spine } from "../covers/MediaArtwork.tsx";
import { Drawer } from "../ui/Drawer.tsx";
import { BrandLockup } from "../brand/BrandMark.tsx";
import { brand } from "../../config/brand.ts";
import { EntryDetails } from "../details/EntryDetails.tsx";
import { ItemEditor } from "../manage/ItemEditor.tsx";
import { TransferPanel } from "../manage/TransferPanel.tsx";
import type { ItemInput } from "../../domain/item.ts";

type Panel = "filters" | "stats" | "timeline" | "add" | "transfer" | null;
// Entrance delays stop growing after the first rows so long shelves settle quickly.
const stagger = (index: number) =>
  ({ "--stagger": Math.min(index, 12) }) as CSSProperties;
function EntryCard({
  entry,
  index,
  onOpen,
}: {
  entry: LibraryEntry;
  index: number;
  onOpen: () => void;
}) {
  const series = entry.kind !== "cd";
  const sample =
    entry.kind === "cd" && entry.copies.every((copy) => copy.isSample);
  const lightNovel =
    entry.kind === "manga" &&
    entry.copies.some((copy) => copy.medium === "light_novel");
  return (
    <article
      className={`entry-card ${series ? `${entry.kind}-card` : "cd-card"}`}
      data-entry-kind={entry.kind}
      style={stagger(index)}
    >
      <button
        type="button"
        className="entry-open"
        onClick={onOpen}
        aria-label={`Open ${entry.title}`}
      >
        <div className="card-stage">
          <MediaArtwork entry={entry} />
          <span className="card-open-mark">
            <ArrowRight size={17} />
          </span>
          {sample && <span className="sample-ribbon">SAMPLE CD</span>}
        </div>
        <div className="card-caption">
          <h2>{entry.title}</h2>
          <p className="card-credit">
            {(entry.kind === "cd" ? entry.artists : entry.authors).join(
              " · ",
            ) || (series ? "Author unknown" : "Artist unresolved")}
          </p>
          <div className="card-metadata">
            {(series || !sample) && (
              <p className="card-count mono">
                {entry.copies.length}{" "}
                {entry.kind === "manga"
                  ? entry.copies.length === 1
                    ? "volume"
                    : "volumes"
                  : entry.kind === "book"
                    ? entry.copies.length === 1
                      ? "book"
                      : "books"
                    : "owned"}
              </p>
            )}
            {series && (
              <div className="card-languages">
                {lightNovel && (
                  <span className="badge-medium" title="Includes light novels">
                    LN
                  </span>
                )}
                {[...new Set(entry.copies.map((copy) => copy.language))].map(
                  (language) => (
                    <span key={language}>{language}</span>
                  ),
                )}
              </div>
            )}
          </div>
        </div>
      </button>
    </article>
  );
}
function ShelfSkeleton() {
  return (
    <div
      className="cover-grid shelf-skeleton"
      role="status"
      aria-label="Refreshing collection"
    >
      {Array.from({ length: 12 }, (_, index) => (
        <div key={index} className="skeleton-card">
          <div />
          <span />
          <span />
        </div>
      ))}
      <span className="sr-only">Refreshing your collection…</span>
    </div>
  );
}
export function LibraryIsland({
  initialData,
  initialState,
}: {
  initialData: LibraryData;
  initialState: BrowseState;
}) {
  const [data, setData] = useState(initialData);
  const [state, setState] = useState(initialState);
  const [panel, setPanel] = useState<Panel>(null);
  const [theme, setTheme] = useState("light");
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [ready, setReady] = useState(false);
  const [editing, setEditing] = useState<{
    id?: string;
    seed?: Partial<ItemInput>;
  } | null>(null);
  const entries = useMemo(
    () => browseEntries(data.entries, state),
    [data, state],
  );
  const cdSpines = useMemo(() => cdShelf(entries, state), [entries, state]);
  const bookSpines = useMemo(() => bookShelf(entries, state), [entries, state]);
  const selected = data.entries.find((entry) => entry.id === state.item);
  const manga = data.entries.filter((entry) => entry.kind === "manga");
  const books = data.entries.filter((entry) => entry.kind === "book");
  const cds = data.entries.filter((entry) => entry.kind === "cd");
  // Manga totals include light novels; books are counted separately.
  const copies = manga.flatMap((entry) => entry.copies);
  const bookCopies = books.flatMap((entry) => entry.copies);
  const lightNovels = copies.filter(
    (copy) => copy.medium === "light_novel",
  ).length;
  const personalCds = cds
    .flatMap((entry) => entry.copies)
    .filter((copy) => !copy.isSample).length;
  const sampleCds = cds
    .flatMap((entry) => entry.copies)
    .filter((copy) => copy.isSample).length;
  const publishers = [
    ...new Set([
      ...copies.map((copy) => copy.publisher),
      ...bookCopies.map((copy) => copy.publisher),
      ...cds.flatMap((entry) => entry.labels),
    ]),
  ].sort();
  const memories = [
    ...new Set([
      ...copies.flatMap((copy) => copy.tags),
      ...bookCopies.flatMap((copy) => copy.tags),
      ...cds.flatMap((entry) =>
        entry.copies.flatMap((copy) => copy.tags ?? []),
      ),
    ]),
  ]
    .filter(
      (tag) => !["Box Set", "Omnibus", "Collector's Edition"].includes(tag),
    )
    .sort();
  const years = [
    ...new Set(
      data.entries.flatMap((entry) =>
        entry.copies.map((copy) => copy.acquiredOn?.slice(0, 4) ?? "unknown"),
      ),
    ),
  ]
    .sort()
    .reverse();
  const formats = [
    ...new Set([
      ...[...copies, ...bookCopies].flatMap((copy) => [
        copy.format,
        copy.editionTitle,
      ]),
      ...cds.flatMap((entry) => [...entry.formats, entry.editionTitle ?? ""]),
    ]),
  ]
    .filter(Boolean)
    .sort();
  const activeFilters = [
    state.type,
    state.language,
    state.publisher,
    state.memory,
    state.year,
    state.format,
  ].filter(Boolean).length;
  useEffect(() => {
    setReady(true);
    setTheme(document.documentElement.dataset.theme ?? "light");
    const pop = () => {
      setState(parseBrowseState(new URLSearchParams(window.location.search)));
      setPanel(null);
      setEditing(null);
    };
    window.addEventListener("popstate", pop);
    return () => window.removeEventListener("popstate", pop);
  }, []);
  function navigate(update: Partial<BrowseState>, replace = false) {
    const next = { ...state, ...update };
    setState(next);
    const query = browseParams(next).toString();
    window.history[replace ? "replaceState" : "pushState"](
      {},
      "",
      `${window.location.pathname}${query ? `?${query}` : ""}`,
    );
  }
  function toggleTheme() {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem("strawby-theme", next);
    } catch {
      /* Browsing works without storage. */
    }
  }
  function openEntry(entry: LibraryEntry) {
    setPanel(null);
    navigate({ item: entry.id });
  }
  function showPanel(next: Panel) {
    setEditing(null);
    if (state.item) navigate({ item: "" });
    setPanel(next);
  }
  function resetFilters() {
    navigate({
      type: "",
      query: "",
      language: "",
      publisher: "",
      memory: "",
      year: "",
      format: "",
    });
  }
  function editCopy(id: string) {
    navigate({ item: "" });
    setPanel(null);
    setEditing({ id });
  }
  async function addCopy(entry: LibraryEntry) {
    try {
      const response = await fetch(
        `/api/items/${encodeURIComponent(entry.copies[0]!.id)}`,
        { cache: "no-store" },
      );
      if (!response.ok)
        throw new Error("Could not load the copy. Refresh and try again.");
      const { item } = (await response.json()) as { item: ItemInput };
      navigate({ item: "" });
      setPanel(null);
      setEditing({
        seed: {
          ...item,
          acquiredOn: null,
          notes: null,
          tags: [],
          tagsMode: "auto",
          isSample: false,
        },
      });
    } catch (error) {
      setError((error as Error).message);
    }
  }
  async function mutationFinished() {
    const response = await fetch("/api/library", { cache: "no-store" });
    if (!response.ok)
      throw new Error(
        "Changes were saved, but refresh failed. Reload the page to see them.",
      );
    setData(librarySchema.parse(await response.json()));
    setEditing(null);
    setPanel(null);
    navigate({
      item: "",
      type: "",
      query: "",
      language: "",
      publisher: "",
      memory: "",
      year: "",
      format: "",
      media: "all",
    });
  }
  async function refresh() {
    setRefreshing(true);
    setError("");
    try {
      const response = await fetch("/api/library", {
        signal: AbortSignal.timeout(15_000),
        cache: "no-store",
      });
      if (!response.ok) throw new Error("refresh failed");
      const next = librarySchema.parse(await response.json());
      setData(next);
      if (state.item && !next.entries.some((entry) => entry.id === state.item))
        navigate({ item: "" });
    } catch {
      setError(
        "The collection could not be refreshed. Displaying previously loaded data.",
      );
    } finally {
      setRefreshing(false);
    }
  }
  const ownedDates = copies
    .map((copy) => copy.acquiredOn)
    .filter((date): date is string => date !== null);
  return (
    <div className="library-app" data-hydrated={ready ? "true" : "false"}>
      <header className="site-header">
        <div className="header-inner">
          <BrandLockup name={brand.project} />
          <nav className="desktop-nav" aria-label="Main navigation">
            <button
              type="button"
              className="nav-current"
              onClick={() => {
                setPanel(null);
                navigate({ item: "" });
              }}
              aria-current="page"
            >
              Shelf
            </button>
            <button type="button" onClick={() => showPanel("timeline")}>
              Haul timeline{" "}
              <span className="soon-dot" aria-label="Coming soon" />
            </button>
            <button type="button" onClick={() => showPanel("stats")}>
              Collection stats
            </button>
          </nav>
          <div className="header-actions">
            <button
              type="button"
              className="icon-button theme-toggle"
              aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
              onClick={toggleTheme}
            >
              {theme === "dark" ? <Sun size={19} /> : <Moon size={19} />}
            </button>
            <button
              type="button"
              className="button button-primary desktop-add"
              onClick={() => showPanel("add")}
            >
              <Plus size={17} />
              Add to collection
            </button>
          </div>
        </div>
      </header>
      <main id="main" className="library-main">
        <section id="shelf" aria-labelledby="shelf-title">
          <div className="collection-heading">
            <h1 id="shelf-title">Collection</h1>
            <div className="collection-inventory">
              {(
                [
                  [copies.length, "manga volume", true],
                  [manga.length, "series", true],
                  [lightNovels, "light novel", lightNovels > 0],
                  [bookCopies.length, "book", true],
                  [personalCds, "CD", true],
                  [sampleCds, "sample CD", true],
                ] as const
              )
                .filter(([, , shown]) => shown)
                .map(([count, noun]) => (
                  <span key={noun}>
                    <strong>{count}</strong>{" "}
                    {count === 1 || noun === "series" ? noun : `${noun}s`}
                  </span>
                ))}
            </div>
          </div>
          <button
            type="button"
            className="text-button transfer-link"
            onClick={() => showPanel("transfer")}
          >
            Import & export
          </button>
          <div className="shelf-toolbar">
            <div
              className="media-switcher"
              role="group"
              aria-label="Media type"
            >
              {(
                [
                  ["all", "All media", data.entries.length],
                  ["manga", "Manga", manga.length],
                  ["book", "Books", books.length],
                  ["cd", "CDs", cds.length],
                ] as const
              ).map(([value, label, count]) => (
                <button
                  type="button"
                  key={value}
                  aria-pressed={state.media === value}
                  onClick={() => navigate({ media: value })}
                >
                  {value === "all" ? (
                    // Phones show "All" so four tabs fit; the name stays "All media".
                    <span>
                      All<span className="max-[650px]:sr-only"> media</span>
                    </span>
                  ) : (
                    label
                  )}
                  <span>{count}</span>
                </button>
              ))}
            </div>
            <div className="view-controls" role="group" aria-label="Shelf view">
              <button
                type="button"
                className="icon-button"
                aria-label="Cover grid view"
                aria-pressed={state.view === "grid"}
                onClick={() => navigate({ view: "grid" })}
              >
                <Grid2X2 size={18} />
              </button>
              <button
                type="button"
                className="icon-button"
                aria-label="Virtual shelf view"
                aria-pressed={state.view === "spines"}
                onClick={() => navigate({ view: "spines" })}
              >
                <LibraryBig size={20} />
              </button>
            </div>
          </div>
          <div className="search-toolbar">
            <div className="search-field">
              <Search size={17} />
              <label className="sr-only" htmlFor="library-search">
                Search your collection
              </label>
              <input
                id="library-search"
                type="search"
                placeholder="Search titles, authors, notes…"
                value={state.query}
                onChange={(event) =>
                  navigate({ query: event.target.value }, true)
                }
              />
              {state.query && (
                <button
                  type="button"
                  aria-label="Clear search"
                  onClick={() => navigate({ query: "" }, true)}
                >
                  <X size={15} />
                </button>
              )}
            </div>
            <button
              type="button"
              className="button filter-button"
              onClick={() => showPanel("filters")}
            >
              <SlidersHorizontal size={16} />
              Filters
              {activeFilters > 0 && (
                <span className="filter-count">{activeFilters}</span>
              )}
            </button>
            <label className="sort-control">
              <ArrowDownUp size={14} />
              <span className="sr-only">Sort collection</span>
              <select
                value={state.sort}
                onChange={(event) =>
                  navigate({ sort: event.target.value as BrowseState["sort"] })
                }
              >
                <option value="title">Title, A–Z</option>
                <option value="recent">Recently acquired</option>
              </select>
            </label>
            <button
              type="button"
              className="icon-button refresh-button"
              aria-label="Refresh collection"
              disabled={refreshing}
              onClick={refresh}
            >
              <RefreshCw
                size={17}
                className={refreshing ? "is-refreshing" : ""}
              />
            </button>
          </div>
          <div className="memory-row" aria-label="Quick filters">
            {memories.slice(0, 5).map((memory) => (
              <button
                type="button"
                key={memory}
                className="memory-chip"
                aria-pressed={state.memory === memory}
                onClick={() =>
                  navigate({ memory: state.memory === memory ? "" : memory })
                }
              >
                {memory}
              </button>
            ))}
          </div>
          <div className="results-meta">
            <p role="status" aria-live="polite">
              {entries.length} {entries.length === 1 ? "title" : "titles"}
              {state.query ? ` matching “${state.query}”` : ""}
              {activeFilters > 0
                ? ` · ${activeFilters} ${activeFilters === 1 ? "filter" : "filters"} applied`
                : ""}
            </p>
            {(state.query || activeFilters > 0) && (
              <button
                type="button"
                className="text-button"
                onClick={resetFilters}
              >
                Clear search & filters <X size={12} />
              </button>
            )}
          </div>
          {error && (
            <div className="error-notice" role="alert">
              <p>{error}</p>
              <button type="button" className="text-button" onClick={refresh}>
                Try again <RefreshCw size={14} />
              </button>
            </div>
          )}
          <div aria-busy={refreshing}>
            {refreshing ? (
              <ShelfSkeleton />
            ) : entries.length === 0 ? (
              <div className="empty-shelf">
                <BookOpen size={35} />
                <h2>
                  {data.entries.length
                    ? "No matching titles"
                    : "Collection is empty"}
                </h2>
                <p>
                  {data.entries.length
                    ? "Change your search or clear the filters."
                    : "Import your collection using the setup instructions."}
                </p>
                {data.entries.length > 0 ? (
                  <button
                    type="button"
                    className="button"
                    onClick={resetFilters}
                  >
                    Show the collection <ArrowRight size={16} />
                  </button>
                ) : (
                  <a href="/foundation" className="button">
                    Collection setup <ArrowRight size={16} />
                  </a>
                )}
              </div>
            ) : state.view === "grid" ? (
              // Keyed by media so each switch replays the entrance.
              <div className="cover-grid shelf-view" key={state.media}>
                {entries.map((entry, index) => (
                  <EntryCard
                    key={entry.id}
                    entry={entry}
                    index={index}
                    onOpen={() => openEntry(entry)}
                  />
                ))}
              </div>
            ) : (
              <div className="spine-collection shelf-view" key={state.media}>
                {entries
                  .filter((entry) => entry.kind === "manga")
                  .map((entry, index) => {
                    const visible = matchingCopies(entry, state);
                    return (
                      <section
                        key={entry.id}
                        className="spine-shelf"
                        style={stagger(index)}
                        aria-label={entry.title}
                      >
                        <div className="spine-shelf-heading">
                          <button
                            type="button"
                            onClick={() => openEntry(entry)}
                          >
                            {entry.title}
                            <ArrowRight size={14} />
                          </button>
                          <span className="mono">
                            {visible.length}
                            {visible.length < entry.copies.length
                              ? ` OF ${entry.copies.length}`
                              : ""}{" "}
                            {entry.kind === "manga" ? "VOL." : "CD"}
                          </span>
                        </div>
                        <div
                          className="spine-row"
                          tabIndex={0}
                          role="group"
                          aria-label={`${entry.title}: scroll to browse individual copies`}
                        >
                          {visible.map((copy) => (
                            <Spine
                              key={copy.id}
                              entry={entry}
                              copy={copy}
                              onOpen={() => openEntry(entry)}
                            />
                          ))}
                        </div>
                      </section>
                    );
                  })}
                {bookSpines.length > 0 && (
                  <section className="spine-shelf" aria-label="Books by author">
                    <div className="spine-shelf-heading">
                      <h2>Books · by author</h2>
                      <span className="mono">
                        {bookSpines.length}{" "}
                        {bookSpines.length === 1 ? "BOOK" : "BOOKS"}
                      </span>
                    </div>
                    <div
                      className="spine-row"
                      tabIndex={0}
                      role="group"
                      aria-label="Books, alphabetical by author: scroll to browse"
                    >
                      {bookSpines.map(({ entry, copy }) => (
                        <Spine
                          key={copy.id}
                          entry={entry}
                          copy={copy}
                          onOpen={() => openEntry(entry)}
                        />
                      ))}
                    </div>
                  </section>
                )}
                {cdSpines.length > 0 && (
                  <section className="spine-shelf" aria-label="CDs by artist">
                    <div className="spine-shelf-heading">
                      <h2>CDs · by artist</h2>
                      <span className="mono">{cdSpines.length} CD</span>
                    </div>
                    <div
                      className="spine-row"
                      tabIndex={0}
                      role="group"
                      aria-label="CDs, alphabetical by artist: scroll to browse"
                    >
                      {cdSpines.map(({ entry, copy }) => (
                        <Spine
                          key={copy.id}
                          entry={entry}
                          copy={copy}
                          onOpen={() => openEntry(entry)}
                        />
                      ))}
                    </div>
                  </section>
                )}
              </div>
            )}
          </div>
        </section>
        <footer className="site-footer">
          <a href="/foundation">
            Collection record <ArrowRight size={12} />
          </a>
        </footer>
      </main>
      <nav className="mobile-nav" aria-label="Mobile navigation">
        <button
          type="button"
          aria-label="Shelf"
          aria-current={!panel ? "page" : undefined}
          onClick={() => {
            setPanel(null);
            navigate({ item: "" });
            document.getElementById("shelf")?.scrollIntoView();
          }}
        >
          <BookOpen size={21} />
          <span>Shelf</span>
        </button>
        <button
          type="button"
          aria-label="Search & Filter"
          aria-pressed={panel === "filters"}
          onClick={() => showPanel("filters")}
        >
          <Search size={21} />
          <span>Search</span>
        </button>
        <button
          type="button"
          aria-label="Haul Timeline"
          aria-pressed={panel === "timeline"}
          onClick={() => showPanel("timeline")}
        >
          <History size={21} />
          <span>Timeline</span>
        </button>
        <button
          type="button"
          aria-label="Stats"
          aria-pressed={panel === "stats"}
          onClick={() => showPanel("stats")}
        >
          <ChartNoAxesColumnIncreasing size={21} />
          <span>Stats</span>
        </button>
        <button
          type="button"
          className="mobile-add"
          aria-label="Add"
          aria-pressed={panel === "add"}
          onClick={() => showPanel("add")}
        >
          <span className="mobile-add-icon">
            <Plus size={21} />
          </span>
          <span>Add</span>
        </button>
      </nav>
      {selected && (
        <Drawer
          key={selected.id}
          title={selected.title}
          onClose={() => navigate({ item: "" })}
        >
          <EntryDetails
            entry={selected}
            onEdit={editCopy}
            onAdd={() => void addCopy(selected)}
          />
        </Drawer>
      )}
      {state.item && !selected && (
        <Drawer title="Item not found" onClose={() => navigate({ item: "" })}>
          <p>That item could not be found in the current collection.</p>
          <button
            type="button"
            className="button"
            onClick={() => navigate({ item: "" })}
          >
            Back to the shelf
          </button>
        </Drawer>
      )}
      {panel === "filters" && (
        <Drawer title="Search & filter" onClose={() => setPanel(null)}>
          <label className="filter-field">
            Search the collection
            <input
              type="search"
              value={state.query}
              placeholder="Title, author, publisher, notes…"
              onChange={(event) =>
                navigate({ query: event.target.value }, true)
              }
            />
          </label>
          <label className="filter-field">
            Manga type
            <select
              value={state.type ?? ""}
              onChange={(event) =>
                navigate({ type: event.target.value as BrowseState["type"] })
              }
            >
              <option value="">Manga and light novels</option>
              <option value="manga">Manga only</option>
              <option value="light_novel">Light novels only</option>
            </select>
          </label>
          <label className="filter-field">
            Language
            <select
              value={state.language}
              onChange={(event) => navigate({ language: event.target.value })}
            >
              <option value="">All languages</option>
              <option value="EN">English · EN</option>
              <option value="JP">Japanese · JP</option>
              <option value="KR">Korean · KR</option>
            </select>
          </label>
          <label className="filter-field">
            Publisher or label
            <select
              value={state.publisher}
              onChange={(event) => navigate({ publisher: event.target.value })}
            >
              <option value="">All publishers and labels</option>
              {publishers.map((value) => (
                <option key={value}>{value}</option>
              ))}
            </select>
          </label>
          <label className="filter-field">
            Acquisition year
            <select
              value={state.year ?? ""}
              onChange={(event) => navigate({ year: event.target.value })}
            >
              <option value="">All years</option>
              {years.map((year) => (
                <option key={year} value={year}>
                  {year === "unknown" ? "Unknown date" : year}
                </option>
              ))}
            </select>
          </label>
          <label className="filter-field">
            Edition or format
            <select
              value={state.format ?? ""}
              onChange={(event) => navigate({ format: event.target.value })}
            >
              <option value="">All editions and formats</option>
              {formats.map((format) => (
                <option key={format}>{format}</option>
              ))}
            </select>
          </label>
          <label className="filter-field">
            Memory
            <select
              value={state.memory}
              onChange={(event) => navigate({ memory: event.target.value })}
            >
              <option value="">All memories</option>
              {memories.map((value) => (
                <option key={value}>{value}</option>
              ))}
            </select>
          </label>
          <div className="filter-actions">
            <button
              type="button"
              className="text-button"
              onClick={resetFilters}
            >
              Reset filters
            </button>
            <button
              type="button"
              className="button button-primary"
              onClick={() => setPanel(null)}
            >
              Show {entries.length} {entries.length === 1 ? "title" : "titles"}
              <ArrowRight size={16} />
            </button>
          </div>
        </Drawer>
      )}
      {panel === "stats" && (
        <Drawer title="Collection stats" onClose={() => setPanel(null)}>
          <div className="stats-grid">
            {[
              [copies.length, "Manga copies"],
              [manga.length, "Unique series"],
              [lightNovels, "Light novels"],
              [bookCopies.length, "Books"],
              [new Set(ownedDates).size, "Acquisition dates"],
              [copies.filter((copy) => copy.notes).length, "Acquisition notes"],
            ].map(([value, label]) => (
              <div key={label}>
                <strong>{value}</strong>
                <span>{label}</span>
              </div>
            ))}
          </div>
          <p className="panel-intro">
            {sampleCds} sample CDs excluded from totals.
          </p>
          <h3 className="stats-heading">Languages</h3>
          <div className="stats-languages">
            {(["EN", "JP", "KR"] as const).map((language) => (
              <div key={language}>
                <span>{language}</span>
                <strong className="mono">
                  {copies.filter((copy) => copy.language === language).length}
                </strong>
              </div>
            ))}
          </div>
          <h3 className="stats-heading">Publishers</h3>
          <ul className="publisher-stats">
            {publishers
              .map((publisher) => ({
                publisher,
                count: copies.filter((copy) => copy.publisher === publisher)
                  .length,
              }))
              .filter(({ count }) => count > 0)
              .sort((a, b) => b.count - a.count)
              .map(({ publisher, count }) => (
                <li key={publisher}>
                  <span>{publisher}</span>
                  <span className="stat-bar">
                    <i
                      style={{
                        width: `${copies.length ? (count / copies.length) * 100 : 0}%`,
                      }}
                    />
                  </span>
                  <strong className="mono">{count}</strong>
                </li>
              ))}
          </ul>
          <a className="text-button" href="/foundation">
            Collection record <ArrowRight size={15} />
          </a>
        </Drawer>
      )}
      {(panel === "add" || editing) && (
        <Drawer
          title={editing?.id ? "Edit copy" : "Add to collection"}
          onClose={() => {
            setEditing(null);
            setPanel(null);
          }}
          wide
        >
          <ItemEditor
            key={editing?.id ?? "new"}
            id={editing?.id}
            seed={editing?.seed}
            entries={data.entries}
            onSaved={mutationFinished}
            onClose={() => {
              setEditing(null);
              setPanel(null);
            }}
          />
        </Drawer>
      )}
      {panel === "transfer" && (
        <Drawer title="Import & export" onClose={() => setPanel(null)} wide>
          <TransferPanel
            onChanged={async () => {
              const response = await fetch("/api/library", {
                cache: "no-store",
              });
              if (!response.ok)
                throw new Error("Reload to see the imported collection.");
              setData(librarySchema.parse(await response.json()));
            }}
          />
        </Drawer>
      )}
      {panel === "timeline" && (
        <Drawer title="Haul timeline" onClose={() => setPanel(null)}>
          <div className="coming-soon">
            <span>
              <History size={34} />
            </span>
            <p>The haul timeline is not available yet.</p>
            <button
              type="button"
              className="button button-primary"
              onClick={() => setPanel(null)}
            >
              Back to the shelf <ArrowRight size={16} />
            </button>
          </div>
        </Drawer>
      )}
    </div>
  );
}
