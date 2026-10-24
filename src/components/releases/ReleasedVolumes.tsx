import { useEffect, useMemo, useRef, useState } from "react";
import type { MangaSeries } from "../../domain/library.ts";
import { compareReleases, releaseCatalogSchema, releaseScope } from "../../domain/releases.ts";
import type { ReleaseCatalog } from "../../domain/releases.ts";
import { request } from "../manage/client.ts";

export function ReleasedVolumes({entry, canLookup = false}: {entry: MangaSeries; canLookup?: boolean}) {
  const editions = [...new Map(entry.copies.map(copy => [copy.editionRunId, copy])).values()];
  const [editionId, setEditionId] = useState(editions[0]?.editionRunId ?? "");
  const scope = releaseScope(entry, editionId);
  const copy = scope.copy;
  const [catalog, setCatalog] = useState<ReleaseCatalog | null>(null);
  const [query, setQuery] = useState(copy?.editionTitle.replace(/\s*\((?:EN|JP|KR)\)\s*$/i, "") ?? entry.title);
  const [provider, setProvider] = useState("auto");
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const sequence = useRef(0);
  const identity = JSON.stringify([entry.title, entry.authors, entry.aliases, copy?.editionRunId, copy?.editionTitle, copy?.language, copy?.languageBasis, copy?.publisher, copy?.format, copy?.medium, scope.reason]);
  useEffect(() => {
    const current = ++sequence.current;
    setCatalog(null); setError(""); setBusy(false); setLoading(true);
    setQuery(copy?.editionTitle.replace(/\s*\((?:EN|JP|KR)\)\s*$/i, "") ?? entry.title);
    if (scope.reason || !copy) { setLoading(false); return; }
    request<{catalog: ReleaseCatalog | null}>(`/api/releases?editionRunId=${encodeURIComponent(editionId)}`)
      .then(data => {
        if (sequence.current !== current) return;
        const saved = data.catalog ? releaseCatalogSchema.parse(data.catalog) : null;
        setCatalog(saved);
        if (saved) setQuery(saved.query);
      })
      .catch(error => { if (sequence.current === current) setError((error as Error).message); })
      .finally(() => { if (sequence.current === current) setLoading(false); });
    return () => { sequence.current++; };
  }, [identity, editionId]);
  const comparison = useMemo(() => catalog ? compareReleases(entry.copies.filter(copy => copy.editionRunId === editionId), catalog) : null, [entry, catalog, editionId]);
  async function lookup(continuation = false) {
    const current = ++sequence.current;
    setBusy(true); setError("");
    try {
      const data = await request<{catalog: ReleaseCatalog}>("/api/releases", "POST", {editionRunId: editionId, query, provider, continuation, retry: !continuation});
      if (sequence.current === current) setCatalog(releaseCatalogSchema.parse(data.catalog));
    } catch (error) { if (sequence.current === current) setError((error as Error).message); }
    finally { if (sequence.current === current) setBusy(false); }
  }
  const stale = catalog && Date.now() - Date.parse(catalog.checkedAt) > 7 * 86400000;
  const currentCatalog = catalog?.editionRunId === editionId ? catalog : null;
  return <section className="released-volumes" aria-label="Released and missing volumes">
    <div className="release-heading">
      <h3>Missing volumes {currentCatalog && comparison && <span className="release-count" aria-label={`${comparison.missing.length} missing volumes found`}>{comparison.missing.length}</span>}</h3>
      {canLookup && !scope.reason && currentCatalog && <button type="button" className="text-button" disabled={loading || busy || !query.trim()} onClick={() => void lookup()}>{busy ? "Checking…" : "Refresh"}</button>}
    </div>
    <div className="release-context">
      <span>{copy?.language}{copy?.languageBasis === "assumed" ? " (assumed)" : ""} · {copy?.publisher}</span>
      {currentCatalog?.provider === "googlebooks" && <a href="https://books.google.com" target="_blank" rel="noreferrer" aria-label="Google Books" title="Google Books"><img src="/images/google-g.png" alt="Google" width="20" height="20" /></a>}
    </div>
    {scope.reason ? <p className="release-notice">{scope.reason}</p> : <>
      {loading && <p role="status" className="release-status">Loading missing volumes…</p>}
      {busy && <p role="status" className="release-status">Checking releases…</p>}
      {error && <p role="alert" className="form-error">{error}</p>}
      {currentCatalog && comparison ? <div className="release-comparison">
        {comparison.missing.length ? <ul className="missing-release-list">{comparison.missing.map(volume => <li key={volume.number}><a href={volume.sourceUrl} target="_blank" rel="noreferrer">Vol. {volume.number}{volume.digital && <span>Digital listing</span>}</a></li>)}</ul> : <p className="release-status">{comparison.released.length ? "No missing volumes found in this lookup." : "No matching releases found. Try the lookup options."}</p>}
        {currentCatalog.nextOffset !== null && <div className="release-more"><span>Partial results</span>{canLookup && <button type="button" className="text-button" disabled={busy || loading} onClick={() => void lookup(true)}>Check more releases</button>}</div>}
      </div> : !loading && (canLookup ? <button type="button" className="button release-find" disabled={busy || !query.trim()} onClick={() => void lookup()}>{busy ? "Checking…" : "Find missing volumes"}</button> : <p className="release-status">No saved release lookup for this edition yet.</p>)}
    </>}
    <details className="release-options">
      <summary>Options & sources</summary>
      <label className="filter-field">Release edition<select value={editionId} onChange={event => setEditionId(event.target.value)}>{editions.map(copy => <option key={copy.editionRunId} value={copy.editionRunId}>{copy.language} · {copy.publisher} · {copy.format}{copy.medium === "light_novel" ? " · Light novel" : ""}</option>)}</select></label>
      {canLookup && !scope.reason && <>
        {copy?.languageBasis === "assumed" && <p className="release-notice">Edition language is assumed. Confirm it against your copy in Edit.</p>}
        <label className="filter-field">Release lookup title<input list={`release-titles-${editionId}`} value={query} maxLength={200} onChange={event => setQuery(event.target.value)} /><datalist id={`release-titles-${editionId}`}>{[...new Set([entry.title, ...entry.aliases])].map(title => <option key={title} value={title} />)}</datalist></label>
        <label className="filter-field">Release catalog source<select value={provider} onChange={event => setProvider(event.target.value)}><option value="auto">Google Books → Open Library</option><option value="googlebooks">Google Books</option><option value="openlibrary">Open Library</option></select></label>
        <button type="button" className="button" disabled={loading || busy || !query.trim()} onClick={() => void lookup()}>{busy ? "Checking…" : "Search released volumes"}</button>
      </>}
      {currentCatalog && comparison && <>
        <p className="release-stamp">{currentCatalog.provider === "googlebooks" ? "Google Books" : "Open Library"} · checked <time dateTime={currentCatalog.checkedAt}>{currentCatalog.checkedAt.slice(0, 10)}</time>{stale ? " · Update recommended" : ""}</p>
        <p className="release-query">{comparison.released.length} releases found · {comparison.owned.length} owned · Lookup: {currentCatalog.query}</p>
        <ul className="release-evidence">{comparison.released.map(volume => <li key={volume.number}><a href={volume.sourceUrl} target="_blank" rel="noreferrer">Vol. {volume.number} · {volume.title}<small>{volume.publishedOn.slice(0, volume.datePrecision === "year" ? 4 : volume.datePrecision === "month" ? 7 : 10)}{volume.digital ? " · Digital listing" : ""}</small></a><span>{comparison.owned.some(owned => owned.number === volume.number) ? "Owned" : "Missing"}</span></li>)}</ul>
        {currentCatalog.warnings.map((warning, index) => <p className="release-notice" key={index}>{warning}</p>)}
      </>}
      <p className="release-limit">Based on dated catalog listings for this edition. Catalogs may omit volumes; digital listings do not confirm a physical release.</p>
    </details>
  </section>;
}
