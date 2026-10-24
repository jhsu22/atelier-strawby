import { useState } from "react";
import { BookOpen, CalendarDays, Disc3, Heart, Layers3 } from "lucide-react";
import type {
  LibraryEntry,
  MangaSeries,
  BookSeries,
  CdAlbum,
} from "../../domain/library.ts";
import { seriesGaps } from "../../domain/library.ts";
import { MediaArtwork } from "../covers/MediaArtwork.tsx";

export function DateLabel({ value }: { value: string | null }) {
  return value ? (
    <time dateTime={value}>{value}</time>
  ) : (
    <span>Acquisition date unknown</span>
  );
}
function MangaDetails({
  entry,
  onEdit,
}: {
  entry: MangaSeries | BookSeries;
  onEdit?: (id: string) => void;
}) {
  const book = entry.kind === "book";
  // A standalone book has no meaningful volume number to show or gap-check.
  const numbered = !book || entry.copies.some((copy) => copy.volume !== "1");
  const [showGaps, setShowGaps] = useState(false);
  const [language, setLanguage] = useState("all");
  const languages = [...new Set(entry.copies.map((copy) => copy.language))];
  const copies = entry.copies
    .filter((copy) => language === "all" || copy.language === language)
    .sort(
      (a, b) =>
        a.language.localeCompare(b.language) ||
        a.editionTitle.localeCompare(b.editionTitle) ||
        (a.volumeSort ?? Number.MAX_SAFE_INTEGER) -
          (b.volumeSort ?? Number.MAX_SAFE_INTEGER) ||
        a.id.localeCompare(b.id),
    );
  return (
    <>
      <div className="detail-intro">
        <MediaArtwork entry={entry} compact />
        <div>
          <p className="detail-credit">{entry.authors.join(" · ")}</p>
          <p className="detail-publishers">
            {[...new Set(entry.copies.map((copy) => copy.publisher))].join(
              " · ",
            )}
          </p>
          <p className="detail-owned">
            <BookOpen size={16} /> {entry.copies.length} owned{" "}
            {entry.copies.length === 1 ? "copy" : "copies"}
          </p>
          <div className="language-badges">
            {languages.map((value) => (
              <span key={value} className="badge badge-language">
                {value}
              </span>
            ))}
          </div>
        </div>
      </div>
      <div className="section-heading detail-section-heading">
        <h3>
          {book ? (numbered ? "Books in this series" : "Copies") : "Volumes"}
        </h3>
      </div>
      <div className="detail-controls">
        {languages.length > 1 && (
          <label className="select-label">
            Language
            <select
              value={language}
              onChange={(event) => setLanguage(event.target.value)}
            >
              <option value="all">All languages</option>
              {languages.map((value) => (
                <option key={value}>{value}</option>
              ))}
            </select>
          </label>
        )}
        {numbered && (
          <label className="switch-label">
            <input
              type="checkbox"
              checked={showGaps}
              onChange={(event) => setShowGaps(event.target.checked)}
            />
            <span className="switch-track" aria-hidden="true" />
            Find missing volumes
          </label>
        )}
      </div>
      {showGaps && (
        <div className="gap-report" role="status">
          {seriesGaps(entry)
            .filter(
              (group) => language === "all" || group.language === language,
            )
            .map((group) => (
              <p key={group.editionRunId}>
                <strong>
                  {group.language} · {group.publisher}
                </strong>
                <br />
                {group.uncertain
                  ? "Numbering or omnibus packaging needs confirmation before gaps can be calculated."
                  : group.missing.length
                    ? `Missing between owned volumes: ${group.missing.join(", ")}.`
                    : "No gaps between your owned volumes."}
              </p>
            ))}
          <small>
            Compared within each edition and language. Future volumes are not
            inferred.
          </small>
        </div>
      )}
      <ol className="volume-list">
        {copies.map((copy) => (
          <li key={copy.id} data-item-id={copy.id}>
            {copy.artwork && (
              <div className="copy-artwork">
                <MediaArtwork entry={{ ...entry, copies: [copy] }} compact />
                <small>
                  {copy.artwork.scope === "edition"
                    ? "Edition artwork"
                    : "Representative fallback"}
                </small>
              </div>
            )}
            {numbered && (
              <div className="volume-number">
                <span>{book ? "NO." : "VOL."}</span>
                <strong>{copy.volume.padStart(2, "0")}</strong>
              </div>
            )}
            <div className="volume-info">
              <div className="volume-heading">
                <strong>{copy.editionTitle}</strong>
                {copy.medium === "light_novel" && (
                  <span className="badge badge-medium">Light novel</span>
                )}
                <span className="badge badge-language">{copy.language}</span>
              </div>
              <p className="volume-edition">
                {copy.publisher} ·{" "}
                {copy.format === "unknown"
                  ? "Format unconfirmed"
                  : copy.format === "collectors"
                    ? "Collector’s edition"
                    : copy.format}
              </p>
              <p className="volume-date mono">
                <CalendarDays size={12} />
                <DateLabel value={copy.acquiredOn} />
              </p>
              {copy.notes && (
                <p className="volume-note">
                  <Heart size={12} aria-hidden="true" />
                  <span>{copy.notes}</span>
                </p>
              )}
              {copy.tags.length > 0 && (
                <div className="item-tags">
                  {copy.tags.map((tag) => (
                    <span key={tag}>{tag}</span>
                  ))}
                </div>
              )}
              {copy.languageBasis === "assumed" && (
                <span className="language-provenance">Language assumed</span>
              )}
              {onEdit && (
                <button
                  type="button"
                  className="text-button"
                  onClick={() => onEdit(copy.id)}
                >
                  {numbered
                    ? `Edit ${book ? "book" : "volume"} ${copy.volume} · ${copy.language}`
                    : `Edit copy · ${copy.language}`}
                </button>
              )}
            </div>
          </li>
        ))}
      </ol>
    </>
  );
}
function CdDetails({
  entry,
  onEdit,
}: {
  entry: CdAlbum;
  onEdit?: (id: string) => void;
}) {
  const [openCase, setOpenCase] = useState(false);
  const sample = entry.copies.every((copy) => copy.isSample);
  return (
    <>
      {sample && (
        <p className="sample-notice">
          <Disc3 size={17} />
          <span>Sample CD · excluded from collection totals.</span>
        </p>
      )}
      <button
        type="button"
        className={`case-presentation ${openCase ? "case-is-open" : ""}`}
        aria-pressed={openCase}
        aria-label={openCase ? "Close jewel case" : "Open jewel case"}
        onClick={() => setOpenCase((value) => !value)}
      >
        <span className="case-interior">
          <span className="case-disc" />
        </span>
        <span className="case-lid">
          <MediaArtwork entry={entry} />
        </span>
      </button>
      <p className="detail-credit cd-credit">
        {entry.artists.join(" · ") || "Artist credits unresolved"}
      </p>
      <dl className="release-metadata">
        <div>
          <dt>Release year</dt>
          <dd>{entry.releaseDate?.slice(0, 4) ?? "Unknown"}</dd>
        </div>
        <div>
          <dt>Format</dt>
          <dd>{entry.formats.join(" + ") || "Unresolved"}</dd>
        </div>
        <div>
          <dt>Label</dt>
          <dd>{entry.labels.join(" · ") || "Unknown"}</dd>
        </div>
        <div>
          <dt>Catalog no.</dt>
          <dd className="mono">
            {entry.catalogNumbers.join(" / ") || "Unknown"}
          </dd>
        </div>
      </dl>
      <div className="section-heading detail-section-heading">
        <h3>Tracklist</h3>
        <Layers3 size={17} />
      </div>
      {entry.tracks.length ? (
        <ol className="tracklist">
          {entry.tracks.map((track) => (
            <li key={`${track.medium}:${track.position}`}>
              <span className="mono">
                {track.medium}.{String(track.position).padStart(2, "0")}
              </span>
              <span>{track.title}</span>
              <span className="mono">
                {track.durationMs === null
                  ? "—"
                  : `${Math.floor(track.durationMs / 60000)}:${String(Math.floor(track.durationMs / 1000) % 60).padStart(2, "0")}`}
              </span>
            </li>
          ))}
        </ol>
      ) : (
        <div className="quiet-state">
          <Disc3 size={26} />
          <p>Tracklist unavailable.</p>
        </div>
      )}
      <div className="section-heading detail-section-heading">
        <h3>Acquisition & notes</h3>
        <Heart size={17} />
      </div>
      {entry.copies.map((copy) => (
        <div key={copy.id} className="acquisition-note">
          <p className="mono">
            <DateLabel value={copy.acquiredOn} />
          </p>
          <p>{copy.notes || "No acquisition note recorded."}</p>
          {!!copy.tags?.length && <p>{copy.tags.join(" · ")}</p>}
          {onEdit && (
            <button
              type="button"
              className="text-button"
              onClick={() => onEdit(copy.id)}
            >
              Edit CD copy
            </button>
          )}
        </div>
      ))}
    </>
  );
}
export function EntryDetails({
  entry,
  onEdit,
  onAdd,
}: {
  entry: LibraryEntry;
  onEdit?: (id: string) => void;
  onAdd?: () => void;
}) {
  const artwork =
    entry.kind === "cd"
      ? entry.artwork
      : entry.copies.find((copy) => copy.artwork)?.artwork;
  return (
    <>
      {artwork && (
        <p className="artwork-attribution">
          {artwork.scope === "edition"
            ? "Selected edition artwork"
            : "Representative artwork fallback"}{" "}
          · {artwork.attribution}{" "}
          <a href={artwork.sourceUrl} target="_blank" rel="noreferrer">
            Source
          </a>
        </p>
      )}
      {entry.kind === "cd" ? (
        <CdDetails entry={entry} onEdit={onEdit} />
      ) : (
        <MangaDetails entry={entry} onEdit={onEdit} />
      )}
      {onAdd && (
        <button type="button" className="button detail-add" onClick={onAdd}>
          Add another copy
        </button>
      )}
    </>
  );
}
