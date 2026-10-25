import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { CircleCheck, Copy, Disc3, PencilLine, ScanBarcode, TriangleAlert } from "lucide-react";
import { itemSchema } from "../../domain/item.ts";
import type { ItemInput } from "../../domain/item.ts";
import { formatBarcode } from "../../domain/barcode.ts";
import type { CdLookupResult, CdRelease } from "../../domain/cd-scan.ts";
import type { MetadataResult } from "../../domain/metadata.ts";
import { request } from "../manage/client.ts";

const today = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
};
const list = (value: string) => value.split("|").map((part) => part.trim()).filter(Boolean);
const plural = (count: number, noun: string, many = `${noun}s`) => `${count} ${count === 1 ? noun : many}`;
/** The editor collects a missing title itself; an empty one would not parse. */
const seed = ({ title, ...rest }: Partial<ItemInput>): Partial<ItemInput> => ({ ...rest, ...(title?.trim() ? { title } : {}) });
const describe = (release: CdRelease) =>
  [
    release.date,
    release.country,
    release.formats.join(" + "),
    release.labels.map((label) => [label.name, label.catalogNumber].filter(Boolean).join(" ")).join(", "),
    release.disambiguation,
  ]
    .filter(Boolean)
    .join(" · ");

/**
 * Confirms a scanned CD. Choosing a MusicBrainz release fills its tracklist,
 * discs, labels and catalog numbers; nothing is saved until the owner saves.
 */
export function CdScanReview({
  result,
  onSaved,
  onRescan,
  onRelease,
  onEditFully,
}: {
  result: CdLookupResult;
  onSaved: (saved: { id: string; title: string }) => Promise<void>;
  onRescan: () => void;
  /** Ask MusicBrainz after the shelf answered on its own. */
  onRelease: () => void;
  onEditFully: (seed: Partial<ItemInput>) => void;
}) {
  // Several pressings can share a barcode; only a single one is preselected.
  const [index, setIndex] = useState(result.releases.length === 1 ? 0 : -1);
  const release = result.releases[index] ?? null;
  const [patch, setPatch] = useState<Partial<ItemInput> | null>(null);
  const [loading, setLoading] = useState(false);
  const [title, setTitle] = useState("");
  const [artists, setArtists] = useState("");
  const [editionTitle, setEditionTitle] = useState("");
  const [useCover, setUseCover] = useState(true);
  const [acquiredOn, setAcquiredOn] = useState<string | null>(today());
  const [notes, setNotes] = useState("");
  const [notesPrivate, setNotesPrivate] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [warning, setWarning] = useState("");
  const [coverFailed, setCoverFailed] = useState(false);
  const requestId = useRef(crypto.randomUUID());
  useEffect(() => {
    if (!release) return;
    let current = true;
    // The search result is a usable draft until the full release arrives.
    const fallback: Partial<ItemInput> = {
      title: release.title,
      artists: release.artists,
      releaseDate: /^\d{4}(-\d{2}(-\d{2})?)?$/.test(release.date) ? release.date : null,
      editionTitle: [release.disambiguation, release.country].filter(Boolean).join(" · "),
      labels: release.labels.filter((label) => label.name),
    };
    setPatch(fallback);
    setTitle(release.title);
    setArtists(release.artists.join(" | "));
    setEditionTitle(fallback.editionTitle ?? "");
    setWarning("");
    setCoverFailed(false);
    setLoading(true);
    request<MetadataResult>("/api/metadata", "POST", { kind: "cd", provider: "musicbrainz", query: release.title, id: release.id })
      .then((data) => {
        const full = data.candidates[0]?.patch;
        if (!current) return;
        if (full) setPatch({ ...fallback, ...full });
        else setWarning("MusicBrainz didn’t return this release’s tracklist. You can add it in the editor.");
        if (data.warnings.length) setWarning(data.warnings.join(" "));
      })
      .catch((failure: Error) => {
        if (current) setWarning(`${failure.message} The tracklist wasn’t loaded; you can add it in the editor.`);
      })
      .finally(() => {
        if (current) setLoading(false);
      });
    return () => {
      current = false;
    };
  }, [release?.id]);

  const owned = result.owned.length > 0;
  const tracks = patch?.tracks ?? [];
  const media = patch?.media ?? [];
  const labels = patch?.labels ?? [];
  const artwork = patch?.artwork ?? null;
  const values = (): Partial<ItemInput> => ({
    ...(patch ?? {}),
    kind: "cd",
    title: title.trim(),
    artists: list(artists),
    editionTitle,
    barcode: result.barcode,
    artwork: useCover ? artwork : null,
    acquiredOn,
    notes: notes.trim() || null,
    notesPrivate,
  });
  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    const parsed = itemSchema.safeParse(values());
    if (!parsed.success) {
      setError(parsed.error.issues.map((issue) => `${issue.path.join(".") || "Form"}: ${issue.message}`).join(" "));
      return;
    }
    setBusy(true);
    try {
      const saved = await request<{ id: string }>("/api/items", "POST", { item: parsed.data, requestId: requestId.current });
      if (parsed.data.artwork) await request("/api/artwork", "POST", { itemId: saved.id }).catch(() => undefined);
      await onSaved({ id: saved.id, title: parsed.data.title });
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const cover = useCover && !coverFailed ? artwork?.url : undefined;
  return (
    <form className="scan-review" onSubmit={submit} aria-label="Review scanned CD">
      <header className="scan-summary">
        <div className="scan-cover cleanup-cd" aria-hidden="true">
          {cover ? <img src={cover} alt="" referrerPolicy="no-referrer" onError={() => setCoverFailed(true)} /> : <Disc3 size={28} />}
        </div>
        <div>
          <p className="scan-isbn">BARCODE {formatBarcode(result.barcode)}</p>
          <h3>{title || release?.title || (owned ? result.owned[0]!.title : "Unknown CD")}</h3>
          {release && <p className="scan-volume">{release.artists.join(" · ") || "Artist unknown"}</p>}
          <p className="field-help">
            {result.local
              ? "Recognized from your collection; MusicBrainz wasn’t asked."
              : result.releases.length
                ? "Release details from MusicBrainz."
                : "No MusicBrainz release lists this barcode. Enter the details from the CD."}
          </p>
        </div>
      </header>

      {owned && (
        <div className="scan-duplicate" role="status">
          <Copy size={18} aria-hidden="true" />
          <p>
            <strong>You already own this CD ({plural(result.owned.length, "copy", "copies")} with this barcode).</strong>{" "}
            Saving adds another physical copy; nothing is replaced.
          </p>
        </div>
      )}
      {!owned && result.albums.length > 0 && (
        <p className="field-help" role="status">
          You own another edition of this album: {result.albums.map((album) => `${album.title} (${plural(album.copies, "copy", "copies")})`).join(", ")}.
        </p>
      )}
      {(warning || result.warnings.length > 0) && (
        <ul className="scan-flags" aria-label="Check before saving">
          {[...result.warnings, ...(warning ? [warning] : [])].map((flag) => (
            <li key={flag}>
              <TriangleAlert size={15} aria-hidden="true" />
              {flag}
            </li>
          ))}
        </ul>
      )}

      {result.releases.length > 1 && (
        <fieldset className="scan-choices">
          <legend>Which pressing is yours?</legend>
          <p className="field-help">{result.releases.length} MusicBrainz releases share this barcode. Compare the label, catalog number and country with your CD.</p>
          {result.releases.map((entry, position) => (
            <label key={entry.id} className="scan-choice">
              <input type="radio" name="cd-release" checked={index === position} onChange={() => setIndex(position)} />
              <span>
                <strong>{entry.title}</strong>
                <small>{[entry.artists.join(" · "), describe(entry)].filter(Boolean).join(" · ")}</small>
              </span>
            </label>
          ))}
        </fieldset>
      )}

      {release ? (
        <fieldset className="scan-fields" disabled={busy}>
          <dl className="cd-release-facts">
            <div>
              <dt>Label & catalog number</dt>
              <dd>{labels.map((label) => [label.name, label.catalogNumber].filter(Boolean).join(" · ")).join("; ") || "Not listed"}</dd>
            </div>
            <div>
              <dt>Released</dt>
              <dd>{patch?.releaseDate || release.date || "Not listed"}</dd>
            </div>
            <div>
              <dt>Discs</dt>
              <dd>{media.length ? media.map((medium) => medium.format).join(" + ") : release.formats.join(" + ") || "Not listed"}</dd>
            </div>
          </dl>
          {loading ? (
            <p className="field-help" role="status">
              Loading the tracklist…
            </p>
          ) : (
            tracks.length > 0 && (
              <details className="cd-tracklist">
                <summary>
                  {plural(tracks.length, "track")}
                  {media.length > 1 ? ` on ${media.length} discs` : ""}
                </summary>
                <ol>
                  {tracks.map((track) => (
                    <li key={`${track.medium}-${track.position}`}>
                      {media.length > 1 && <span className="mono">{track.medium}.</span>}
                      {track.title}
                    </li>
                  ))}
                </ol>
              </details>
            )
          )}
          <label className="filter-field">
            Title
            <input required value={title} onChange={(e) => setTitle(e.target.value)} />
          </label>
          <label className="filter-field">
            Artists
            <input value={artists} onChange={(e) => setArtists(e.target.value)} />
            <small>Separate multiple names with “ | ”.</small>
          </label>
          <label className="filter-field">
            Edition
            <input value={editionTitle} onChange={(e) => setEditionTitle(e.target.value)} />
          </label>
          {artwork && (
            <label className="check-label">
              <input type="checkbox" checked={useCover} onChange={(e) => setUseCover(e.target.checked)} />
              Use the Cover Art Archive cover (shown above)
            </label>
          )}
          <div className="scan-acquisition">
            <label className="filter-field">
              Acquisition date
              <input type="date" aria-label="Acquisition date" value={acquiredOn ?? ""} onChange={(e) => setAcquiredOn(e.target.value || null)} />
              <small>Defaults to today. Clear it if you don’t know.</small>
            </label>
            <label className="filter-field">
              Notes
              <textarea rows={2} maxLength={10000} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Where you found it, who it was from…" />
            </label>
            <label className="check-label">
              <input type="checkbox" checked={notesPrivate} onChange={(e) => setNotesPrivate(e.target.checked)} />
              Keep this note private · hidden on the public shelf
            </label>
          </div>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <div className="form-actions scan-actions">
            <button type="submit" className="button button-primary" disabled={loading}>
              <CircleCheck size={16} aria-hidden="true" />
              {busy ? "Saving…" : owned ? "Add another copy" : "Add to collection"}
            </button>
            <button type="button" className="button" onClick={onRescan}>
              <ScanBarcode size={16} aria-hidden="true" />
              Scan again
            </button>
            <button type="button" className="text-button" onClick={() => onEditFully(seed(values()))}>
              <PencilLine size={15} aria-hidden="true" />
              Edit all fields
            </button>
          </div>
        </fieldset>
      ) : (
        <div className="form-actions scan-actions">
          {result.local && (
            <button type="button" className="button button-primary" onClick={onRelease}>
              <Disc3 size={16} aria-hidden="true" />
              Get release details
            </button>
          )}
          {!result.local && !result.releases.length && (
            <button type="button" className="button button-primary" onClick={() => onEditFully(seed({ kind: "cd", barcode: result.barcode, title: owned ? result.owned[0]!.title : "", acquiredOn: today() }))}>
              <PencilLine size={16} aria-hidden="true" />
              Enter details
            </button>
          )}
          <button type="button" className="button" onClick={onRescan}>
            <ScanBarcode size={16} aria-hidden="true" />
            Scan again
          </button>
        </div>
      )}
    </form>
  );
}
