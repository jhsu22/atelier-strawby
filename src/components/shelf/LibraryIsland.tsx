import { useEffect, useMemo, useState } from "react";
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
  parseBrowseState,
} from "../../domain/library.ts";
import { librarySchema } from "../../domain/library-schema.ts";
import { MediaArtwork, Spine } from "../covers/MediaArtwork.tsx";
import { Drawer } from "../ui/Drawer.tsx";
import { EntryDetails } from "../details/EntryDetails.tsx";

type Panel = "filters" | "stats" | "timeline" | "add" | null;
function StrawberryMark() {
  return (
    <svg viewBox="0 0 40 44" fill="none" aria-hidden="true">
      <path
        d="M8 13C1 20 10 35 18 40c2 1 3 1 5-1 10-8 16-22 8-27-6-4-9 1-12 1-4 0-6-4-11 0Z"
        fill="currentColor"
      />
      <path
        d="m20 14-6-8 7 2 5-6 1 8 8 1-9 4"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <path
        d="m12 21 1 2m10-5-1 2m6 6-1 2m-9 1 1 2m0-9-1 2m4 10-1 2"
        stroke="var(--page)"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}
function EntryCard({
  entry,
  onOpen,
}: {
  entry: LibraryEntry;
  onOpen: () => void;
}) {
  const manga = entry.kind === "manga";
  const sample = !manga && entry.copies.every((copy) => copy.isSample);
  return (
    <article
      className={`entry-card ${manga ? "manga-card" : "cd-card"}`}
      data-entry-kind={entry.kind}
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
            {(manga ? entry.authors : entry.artists).join(" · ") ||
              (manga ? "Author unknown" : "Artist unresolved")}
          </p>
          <div className="card-metadata">
            {(manga || !sample) && (
              <p className="card-count mono">
                {entry.copies.length}{" "}
                {manga
                  ? entry.copies.length === 1
                    ? "volume"
                    : "volumes"
                  : "owned"}
              </p>
            )}
            {manga && (
              <div className="card-languages">
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
  const entries = useMemo(
    () => browseEntries(data.entries, state),
    [data, state],
  );
  const selected = data.entries.find((entry) => entry.id === state.item);
  const manga = data.entries.filter((entry) => entry.kind === "manga");
  const cds = data.entries.filter((entry) => entry.kind === "cd");
  const copies = manga.flatMap((entry) => entry.copies);
  const sampleCds = cds
    .flatMap((entry) => entry.copies)
    .filter((copy) => copy.isSample).length;
  const publishers = [...new Set(copies.map((copy) => copy.publisher))].sort();
  const memories = [...new Set(copies.flatMap((copy) => copy.tags))]
    .filter(
      (tag) => !["Box Set", "Omnibus", "Collector's Edition"].includes(tag),
    )
    .sort();
  const activeFilters = [state.language, state.publisher, state.memory].filter(
    Boolean,
  ).length;
  useEffect(() => {
    setReady(true);
    setTheme(document.documentElement.dataset.theme ?? "light");
    const pop = () => {
      setState(parseBrowseState(new URLSearchParams(window.location.search)));
      setPanel(null);
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
    if (state.item) navigate({ item: "" });
    setPanel(next);
  }
  function resetFilters() {
    navigate({ query: "", language: "", publisher: "", memory: "" });
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
          <a
            href="/"
            className="brand-lockup"
            aria-label="Atelier Strawby home"
          >
            <span className="brand-mark">
              <StrawberryMark />
            </span>
            <span>Atelier Strawby</span>
          </a>
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
              <span>
                <strong>{copies.length}</strong> manga volumes
              </span>
              <span>
                <strong>{manga.length}</strong> series
              </span>
              <span>
                <strong>{sampleCds}</strong> sample CDs
              </span>
            </div>
          </div>
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
                  ["cd", "CDs", cds.length],
                ] as const
              ).map(([value, label, count]) => (
                <button
                  type="button"
                  key={value}
                  aria-pressed={state.media === value}
                  onClick={() => navigate({ media: value })}
                >
                  {label}
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
              <div className="cover-grid">
                {entries.map((entry) => (
                  <EntryCard
                    key={entry.id}
                    entry={entry}
                    onOpen={() => openEntry(entry)}
                  />
                ))}
              </div>
            ) : (
              <div className="spine-collection">
                {entries.map((entry) => {
                  const visible = matchingCopies(entry, state);
                  return (
                    <section
                      key={entry.id}
                      className="spine-shelf"
                      aria-label={entry.title}
                    >
                      <div className="spine-shelf-heading">
                        <button type="button" onClick={() => openEntry(entry)}>
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
          <EntryDetails entry={selected} />
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
            Publisher
            <select
              value={state.publisher}
              onChange={(event) => navigate({ publisher: event.target.value })}
            >
              <option value="">All publishers</option>
              {publishers.map((value) => (
                <option key={value}>{value}</option>
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
      {(panel === "timeline" || panel === "add") && (
        <Drawer
          title={panel === "add" ? "Add to collection" : "Haul timeline"}
          onClose={() => setPanel(null)}
        >
          <div className="coming-soon">
            <span>
              {panel === "add" ? <Plus size={34} /> : <History size={34} />}
            </span>
            <p>
              {panel === "add"
                ? "Adding and editing items is not available yet."
                : "The haul timeline is not available yet."}
            </p>
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
