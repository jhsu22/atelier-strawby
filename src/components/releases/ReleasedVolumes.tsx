import { useEffect, useMemo, useRef, useState } from "react";
import type { MangaSeries } from "../../domain/library.ts";
import { compareReleases, releaseCatalogSchema, releaseScope } from "../../domain/releases.ts";
import type { ReleaseCatalog } from "../../domain/releases.ts";
import { request } from "../manage/client.ts";

export function ReleasedVolumes({entry}: {entry: MangaSeries}) {
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
  return <section className="released-volumes" aria-label="Released and missing volumes">
    <div className="section-heading"><h3>Released & missing volumes</h3></div>
    <p className="field-help">Compare catalogued releases with this edition of your collection, including volumes before or after your owned sequence.</p>
    <label className="filter-field">Release edition<select value={editionId} onChange={event => setEditionId(event.target.value)}>{editions.map(copy => <option key={copy.editionRunId} value={copy.editionRunId}>{copy.language} · {copy.editionTitle} · {copy.publisher} · {copy.format}{copy.medium === "light_novel" ? " · Light novel" : ""}</option>)}</select></label>
    {scope.reason ? <p className="release-notice">{scope.reason} Confirm the edition and printed numbering in Edit before looking up releases.</p> : <>
      {copy?.languageBasis === "assumed" && <p className="release-notice">This edition's language is assumed. Confirm it against your copy before relying on this comparison.</p>}
      <div className="release-lookup-fields">
        <label className="filter-field">Release lookup title<input list={`release-titles-${editionId}`} value={query} maxLength={200} onChange={event => setQuery(event.target.value)} /><datalist id={`release-titles-${editionId}`}>{[...new Set([entry.title, ...entry.aliases])].map(title => <option key={title} value={title} />)}</datalist></label>
        <label className="filter-field">Release catalog source<select value={provider} onChange={event => setProvider(event.target.value)}><option value="auto">Google Books → Open Library</option><option value="googlebooks">Google Books</option><option value="openlibrary">Open Library</option></select></label>
      </div>
      <div className="form-actions"><button type="button" className="button" disabled={loading || busy || !query.trim()} onClick={() => void lookup()}>{busy ? "Searching released volumes…" : "Search released volumes"}</button>
        {catalog?.nextOffset !== null && catalog?.nextOffset !== undefined && <button type="button" className="button" disabled={busy || loading} onClick={() => void lookup(true)}>Load more catalog results</button>}</div>
      {(provider !== "openlibrary" || catalog?.provider === "googlebooks") && <p className="google-books-credit"><a href="https://books.google.com" target="_blank" rel="noreferrer"><img src="/images/googlebooks-poweredby.png" alt="Powered by Google" width="62" height="30" /></a></p>}
      {loading && <p role="status">Loading the last release lookup…</p>}
      {busy && <p role="status">Searching catalog pages. Large series may take a little longer; your previous comparison stays visible.</p>}
      {error && <p role="alert" className="form-error">{error}</p>}
      {catalog?.editionRunId === editionId && comparison ? <div className="release-comparison">
        <p className="release-stamp">{catalog.provider === "googlebooks" ? "Google Books" : "Open Library"} · checked <time dateTime={catalog.checkedAt}>{catalog.checkedAt.slice(0, 10)}</time>{stale ? " · Update recommended" : ""}</p>
        <p className="release-query">Lookup: {catalog.query}</p>
        {catalog.nextOffset !== null && <p className="release-notice">More catalog pages are available. Load more to continue; these counts are partial.</p>}
        <div className="release-totals"><div><strong>{comparison.released.length}</strong><span>Released numbers found</span></div><div><strong>{comparison.owned.length}</strong><span>Already owned</span></div><div><strong>{comparison.missing.length}</strong><span>Missing from this edition</span></div></div>
        <h4>Missing released volumes</h4>
        {comparison.missing.length ? <ul className="missing-release-list">{comparison.missing.map(volume => <li key={volume.number}><a href={volume.sourceUrl} target="_blank" rel="noreferrer">Vol. {volume.number}<span>{volume.publishedOn.slice(0, volume.datePrecision === "year" ? 4 : volume.datePrecision === "month" ? 7 : 10)}{volume.digital ? " · Digital listing" : " · Catalog listing"}</span></a></li>)}</ul> : <p className="field-help">{comparison.released.length ? "You own every number found in this lookup. Other releases may be absent from the catalog." : "No compatible, dated releases found. Try an alternate/native title or another source; this does not mean no volumes were released."}</p>}
        <details className="release-evidence"><summary>All catalogued release numbers ({comparison.released.length})</summary><ul>{comparison.released.map(volume => <li key={volume.number}><a href={volume.sourceUrl} target="_blank" rel="noreferrer">Vol. {volume.number} · {volume.title}</a><span>{comparison.owned.some(owned => owned.number === volume.number) ? "Owned" : "Missing"}</span></li>)}</ul></details>
        {catalog.warnings.map((warning, index) => <p className="release-notice" key={index}>{warning}</p>)}
        <p className="field-help">{catalog.scanned} catalog listings checked; {catalog.excluded} excluded for incompatible or incomplete metadata, unclear numbering, or publication dates that do not establish a release yet. Reprints are deduplicated by volume number.</p>
      </div> : !loading && <p className="field-help">No lookup saved yet. Search to see released numbers and copies you do not own.</p>}
      <p className="release-limit">Counts use individually dated catalog records, never search-result totals or a guessed 1–N sequence. Catalogs may omit releases, and digital listings do not confirm a physical edition. Format and language assumptions still need review. Future or undated listings are excluded. Saved lookups survive reloads; missing numbers are recalculated from your current owned copies.</p>
    </>}
  </section>;
}
