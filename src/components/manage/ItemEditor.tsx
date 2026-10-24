import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { itemSchema, memoryTags } from "../../domain/item.ts";
import { parseIsbn } from "../../domain/isbn.ts";
import type { ItemInput } from "../../domain/item.ts";
import type { Medium } from "../../domain/types.ts";
import type { LibraryEntry } from "../../domain/library.ts";
import type {
  MetadataCandidate,
  MetadataResult,
} from "../../domain/metadata.ts";
import { request } from "./client.ts";

export function ItemEditor({
  id,
  entries,
  seed,
  onSaved,
  onClose,
}: {
  id?: string;
  entries: LibraryEntry[];
  seed?: Partial<ItemInput>;
  onSaved: () => Promise<void>;
  onClose: () => void;
}) {
  const [item, setItem] = useState<ItemInput>(() =>
    itemSchema.parse({ kind: "manga", title: "New item", ...seed }),
  );
  const [title, setTitle] = useState(seed?.title ?? "");
  const [isbnText, setIsbnText] = useState(seed?.isbn13 ?? "");
  const [version, setVersion] = useState(0),
    [loading, setLoading] = useState(Boolean(id));
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false),
    [metadataBusy, setMetadataBusy] = useState(false);
  const [query, setQuery] = useState(seed?.title ?? ""),
    [artistQuery, setArtistQuery] = useState("");
  const [provider, setProvider] = useState("auto"),
    [result, setResult] = useState<MetadataResult | null>(null);
  const requestId = useRef(crypto.randomUUID()),
    mounted = useRef(true),
    lookupSequence = useRef(0);
  const [autoSuggest, setAutoSuggest] = useState(false);
  const update = (patch: Partial<ItemInput>) =>
    setItem((current) => ({ ...current, ...patch }));
  useEffect(() => {
    mounted.current = true;
    if (id)
      request<{ item: ItemInput; version: number }>(
        `/api/items/${encodeURIComponent(id)}`,
      )
        .then((data) => {
          if (!mounted.current) return;
          setItem(data.item);
          setTitle(data.item.title);
          setIsbnText(data.item.isbn13 ?? "");
          setQuery(data.item.title);
          setArtistQuery(data.item.artists.join(" "));
          setVersion(data.version);
        })
        .catch((error) => {
          if (mounted.current) setError(error.message);
        })
        .finally(() => {
          if (mounted.current) setLoading(false);
        });
    return () => {
      mounted.current = false;
      lookupSequence.current++;
    };
  }, [id]);
  useEffect(() => {
    if (!autoSuggest || query.trim().length < 3) return;
    const timer = setTimeout(() => {
      void lookup();
    }, 1200);
    return () => clearTimeout(timer);
  }, [query, artistQuery, autoSuggest]);
  async function lookup(candidate?: MetadataCandidate, retry = false) {
    const sequence = ++lookupSequence.current;
    setMetadataBusy(true);
    setError("");
    try {
      const next = await request<MetadataResult>("/api/metadata", "POST", {
        kind: item.kind,
        medium: item.medium,
        query: candidate?.title ?? (query || title),
        artist: item.kind === "cd" ? artistQuery : item.authors.join(" "),
        aliases: item.aliases,
        language: item.language,
        volume: item.volume,
        publisher: item.publisher,
        provider: candidate?.provider ?? provider,
        ...(candidate ? { id: candidate.id } : {}),
        retry,
      });
      if (mounted.current && sequence === lookupSequence.current) {
        // Selecting a series supplies credits/aliases while preserving the owner's title.
        if (candidate?.provider === "mangadex") update(candidate.patch);
        setResult(next);
      }
    } catch (error) {
      if (mounted.current && sequence === lookupSequence.current)
        setError((error as Error).message);
    } finally {
      if (mounted.current && sequence === lookupSequence.current)
        setMetadataBusy(false);
    }
  }
  function applyCandidate(candidate: MetadataCandidate) {
    if (candidate.applicable === false) return;
    if (candidate.detail) {
      void lookup(candidate);
      return;
    }
    update(candidate.patch);
    if (candidate.patch.title) setTitle(candidate.patch.title);
    setNotice(
      "Selected metadata applied to this form. Review it and save to update the collection.",
    );
    setResult(null);
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    setNotice("");
    let isbn13: string | null = null;
    if (item.kind === "manga" && isbnText.trim()) {
      const isbn = parseIsbn(isbnText);
      if (!isbn.ok) {
        setError(`ISBN: ${isbn.message}`);
        return;
      }
      isbn13 = isbn.isbn13;
    }
    const parsed = itemSchema.safeParse({
      ...item,
      title,
      isbn13,
      // Scan provenance describes the scanned ISBN only.
      catalogSource: isbn13 && isbn13 === item.isbn13 ? item.catalogSource : null,
    });
    if (!parsed.success) {
      setError(
        parsed.error.issues
          .map((i) => `${i.path.join(".")}: ${i.message}`)
          .join(" "),
      );
      return;
    }
    setBusy(true);
    try {
      const saved = await request<{ id: string }>(
        id ? `/api/items/${encodeURIComponent(id)}` : "/api/items",
        id ? "PUT" : "POST",
        {
          item: parsed.data,
          ...(id ? { version } : { requestId: requestId.current }),
        },
      );
      if (parsed.data.artwork) {
        try {
          await request("/api/artwork", "POST", { itemId: saved.id });
        } catch {
          /* Collection save is durable; source artwork remains visible and retryable. */
        }
      }
      await onSaved();
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function remove() {
    setBusy(true);
    setError("");
    try {
      await request(`/api/items/${encodeURIComponent(id!)}`, "DELETE", {
        version,
        confirmed: true,
      });
      await onSaved();
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (loading) return <p role="status">Loading copy…</p>;
  if (id && !version)
    return (
      <div>
        <p role="alert">{error}</p>
        <button className="button" onClick={onClose}>
          Close
        </button>
      </div>
    );
  const list = (value: string) => (value === "" ? [] : value.split(" | "));
  return (
    <form className="item-editor" onSubmit={submit}>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="form-notice" role="status">
          {notice}
        </p>
      )}
      <fieldset disabled={busy || confirmDelete}>
        {(!id || item.kind === "manga") && (
          <label className="filter-field">
            Media type
            <select
              aria-label="Copy media type"
              value={item.kind === "cd" ? "cd" : item.medium}
              onChange={(e) => {
                const value = e.target.value as Medium | "cd";
                const kind = value === "cd" ? "cd" : "manga";
                const category = (medium: Medium) =>
                  medium === "book" ? "book" : "manga";
                update({
                  kind,
                  ...(value === "cd" ? {} : { medium: value }),
                  // Changing an existing copy's type keeps its series.
                  ...(id &&
                  value !== "cd" &&
                  category(value) === category(item.medium)
                    ? {}
                    : { seriesId: undefined }),
                  media:
                    kind === "cd"
                      ? [{ position: 1, format: "CD", title: "" }]
                      : [],
                  tracks: [],
                });
                setProvider("auto");
                setResult(null);
                setMetadataBusy(false);
                lookupSequence.current++;
              }}
            >
              <option value="manga">Manga</option>
              <option value="light_novel">Light novel</option>
              <option value="book">Book (not manga)</option>
              {!id && <option value="cd">CD</option>}
            </select>
            {id && item.kind === "manga" && (
              <small>
                The type applies to every copy in this edition. Automatic
                artwork matched for the previous type is cleared.
              </small>
            )}
          </label>
        )}
        {item.kind === "manga" && (
          <label className="filter-field">
            Series
            <select
              value={item.seriesId ?? ""}
              onChange={(e) => {
                const entry = entries.find(
                  (entry) => entry.id === e.target.value,
                );
                if (entry && entry.kind !== "cd") {
                  update({
                    seriesId: entry.id,
                    authors: entry.authors,
                    aliases: entry.aliases,
                    editionTitle: entry.title,
                  });
                  setTitle(entry.title);
                  setQuery(entry.title);
                } else update({ seriesId: undefined });
              }}
            >
              <option value="">
                {item.medium === "book" ? "New book or series" : "New series"}
              </option>
              {entries
                .filter(
                  (e) => e.kind === (item.medium === "book" ? "book" : "manga"),
                )
                .map((e) => (
                  <option value={e.id} key={e.id}>
                    {e.title}
                  </option>
                ))}
            </select>
          </label>
        )}
        <label className="filter-field">
          {item.kind === "cd"
            ? "Album title"
            : item.medium === "book"
              ? "Title"
              : "Series title"}
          <input
            required
            maxLength={300}
            value={title}
            onChange={(e) => {
              setTitle(e.target.value);
              setQuery(e.target.value);
            }}
          />
        </label>
        <label className="filter-field">
          {item.kind === "manga" ? "Authors" : "Artists"}
          <input
            aria-label={item.kind === "manga" ? "Authors" : "Artists"}
            value={(item.kind === "manga" ? item.authors : item.artists).join(
              " | ",
            )}
            onChange={(e) =>
              update(
                item.kind === "manga"
                  ? { authors: list(e.target.value) }
                  : { artists: list(e.target.value) },
              )
            }
          />
          <small>Separate multiple names with “ | ”.</small>
        </label>
        {item.kind === "manga" && item.seriesId && (
          <p className="field-help">
            Series title and author changes apply to every volume in this
            series.
          </p>
        )}
        <label className="filter-field">
          Edition name
          <input
            value={item.editionTitle}
            maxLength={300}
            onChange={(e) => update({ editionTitle: e.target.value })}
          />
        </label>
        {item.kind === "manga" ? (
          <>
            <div className="form-grid">
              <label className="filter-field">
                {item.medium === "book" ? "Number in series" : "Volume"}
                <input
                  required
                  maxLength={40}
                  value={item.volume}
                  onChange={(e) => update({ volume: e.target.value })}
                />
              </label>
              <label className="filter-field">
                Edition language
                <select
                  value={item.language}
                  onChange={(e) =>
                    update({
                      language: e.target.value as ItemInput["language"],
                      languageBasis: "confirmed",
                    })
                  }
                >
                  <option value="EN">English</option>
                  <option value="JP">Japanese</option>
                  <option value="KR">Korean</option>
                </select>
              </label>
            </div>
            <label className="filter-field">
              Publisher
              <input
                value={item.publisher}
                maxLength={300}
                onChange={(e) => update({ publisher: e.target.value })}
              />
            </label>
            <label className="filter-field">
              ISBN
              <input
                aria-label="ISBN"
                value={isbnText}
                maxLength={20}
                autoComplete="off"
                spellCheck={false}
                onChange={(e) => setIsbnText(e.target.value)}
              />
              <small>
                Optional. ISBN-10 is converted to ISBN-13. Every copy of this
                volume edition shares it.
              </small>
            </label>
            <label className="filter-field">
              Edition format
              <select
                value={item.format}
                onChange={(e) =>
                  update({ format: e.target.value as ItemInput["format"] })
                }
              >
                {[
                  "standard",
                  "omnibus",
                  "collectors",
                  "artbook",
                  "anthology",
                  "unknown",
                ].map((value) => (
                  <option key={value}>{value}</option>
                ))}
              </select>
            </label>
            <label className="filter-field">
              Numbering
              <select
                value={item.numberingBasis}
                onChange={(e) =>
                  update({
                    numberingBasis: e.target
                      .value as ItemInput["numberingBasis"],
                  })
                }
              >
                <option value="printed">Printed volume numbers</option>
                <option value="source_record">Source record labels</option>
                <option value="unknown">Unknown</option>
              </select>
            </label>
            <label className="filter-field">
              Alternate titles
              <input
                value={item.aliases.join(" | ")}
                onChange={(e) => update({ aliases: list(e.target.value) })}
              />
              <small>Separate alternate titles with “ | ”.</small>
            </label>
          </>
        ) : (
          <>
            <label className="filter-field">
              Release date
              <input
                placeholder="YYYY, YYYY-MM or YYYY-MM-DD"
                value={item.releaseDate ?? ""}
                onChange={(e) =>
                  update({ releaseDate: e.target.value || null })
                }
              />
            </label>
            <div className="editor-section">
              <h3>Labels & catalog numbers</h3>
              {item.labels.map((label, index) => (
                <div className="form-row" key={index}>
                  <label className="filter-field">
                    Label {index + 1}
                    <input
                      required
                      value={label.name}
                      onChange={(e) =>
                        update({
                          labels: item.labels.map((l, i) =>
                            i === index ? { ...l, name: e.target.value } : l,
                          ),
                        })
                      }
                    />
                  </label>
                  <label className="filter-field">
                    Catalog number {index + 1}
                    <input
                      value={label.catalogNumber}
                      onChange={(e) =>
                        update({
                          labels: item.labels.map((l, i) =>
                            i === index
                              ? { ...l, catalogNumber: e.target.value }
                              : l,
                          ),
                        })
                      }
                    />
                  </label>
                  <button
                    type="button"
                    className="text-button"
                    aria-label={`Remove label ${index + 1}`}
                    onClick={() =>
                      update({
                        labels: item.labels.filter((_, i) => i !== index),
                      })
                    }
                  >
                    Remove
                  </button>
                </div>
              ))}
              <button
                type="button"
                className="button"
                onClick={() =>
                  update({
                    labels: [...item.labels, { name: "", catalogNumber: "" }],
                  })
                }
              >
                Add label
              </button>
            </div>
            <div className="editor-section">
              <h3>Discs & tracks</h3>
              {item.media.map((medium, index) => (
                <div className="disc-editor" key={medium.position}>
                  <div className="form-row">
                    <label className="filter-field">
                      Disc {medium.position} format
                      <select
                        value={medium.format}
                        onChange={(e) =>
                          update({
                            media: item.media.map((m, i) =>
                              i === index
                                ? {
                                    ...m,
                                    format: e.target.value as typeof m.format,
                                  }
                                : m,
                            ),
                          })
                        }
                      >
                        {["CD", "Blu-ray", "DVD", "other"].map((value) => (
                          <option key={value}>{value}</option>
                        ))}
                      </select>
                    </label>
                    <button
                      type="button"
                      className="text-button"
                      onClick={() =>
                        update({
                          media: item.media.filter((_, i) => i !== index),
                          tracks: item.tracks.filter(
                            (t) => t.medium !== medium.position,
                          ),
                        })
                      }
                    >
                      Remove disc {medium.position}
                    </button>
                  </div>
                  {item.tracks
                    .filter((t) => t.medium === medium.position)
                    .map((track) => (
                      <div
                        className="form-row track-editor"
                        key={track.position}
                      >
                        <label className="filter-field">
                          Track {medium.position}.{track.position}
                          <input
                            required
                            value={track.title}
                            onChange={(e) =>
                              update({
                                tracks: item.tracks.map((t) =>
                                  t === track
                                    ? { ...t, title: e.target.value }
                                    : t,
                                ),
                              })
                            }
                          />
                        </label>
                        <label className="filter-field duration-field">
                          Seconds
                          <input
                            type="number"
                            min="0"
                            max="86400"
                            step="0.001"
                            value={
                              track.durationMs === null
                                ? ""
                                : track.durationMs / 1000
                            }
                            onChange={(e) =>
                              update({
                                tracks: item.tracks.map((t) =>
                                  t === track
                                    ? {
                                        ...t,
                                        durationMs:
                                          e.target.value === ""
                                            ? null
                                            : Math.round(
                                                Number(e.target.value) * 1000,
                                              ),
                                      }
                                    : t,
                                ),
                              })
                            }
                          />
                        </label>
                        <button
                          type="button"
                          className="text-button"
                          aria-label={`Remove track ${medium.position}.${track.position}`}
                          onClick={() =>
                            update({
                              tracks: item.tracks.filter((t) => t !== track),
                            })
                          }
                        >
                          Remove
                        </button>
                      </div>
                    ))}
                  <button
                    type="button"
                    className="button"
                    onClick={() =>
                      update({
                        tracks: [
                          ...item.tracks,
                          {
                            medium: medium.position,
                            position:
                              Math.max(
                                0,
                                ...item.tracks
                                  .filter((t) => t.medium === medium.position)
                                  .map((t) => t.position),
                              ) + 1,
                            title: "",
                            durationMs: null,
                          },
                        ],
                      })
                    }
                  >
                    Add track to disc {medium.position}
                  </button>
                </div>
              ))}
              <button
                type="button"
                className="button"
                onClick={() =>
                  update({
                    media: [
                      ...item.media,
                      {
                        position:
                          Math.max(0, ...item.media.map((m) => m.position)) + 1,
                        format: "CD",
                        title: "",
                      },
                    ],
                  })
                }
              >
                Add disc
              </button>
            </div>
          </>
        )}
        <details className="editor-section metadata-editor">
          <summary>Find metadata & artwork</summary>
          <label className="filter-field">
            Lookup title
            <input value={query} onChange={(e) => setQuery(e.target.value)} />
          </label>
          {item.kind === "cd" && (
            <label className="filter-field">
              Lookup artist
              <input
                value={artistQuery}
                onChange={(e) => setArtistQuery(e.target.value)}
              />
            </label>
          )}
          <label className="filter-field">
            Metadata source
            <select
              value={provider}
              onChange={(e) => {
                setProvider(e.target.value);
                setResult(null);
              }}
            >
              <option value="auto">Automatic fallback</option>
              {(item.kind === "cd"
                ? ["musicbrainz", "itunes"]
                : item.medium === "manga"
                  ? ["mangadex", "googlebooks", "openlibrary"]
                  : ["googlebooks", "openlibrary"]
              ).map((p) => (
                <option key={p} value={p}>{p === "googlebooks" ? "Google Books" : p}</option>
              ))}
            </select>
          </label>
          {provider === "googlebooks" && <p className="google-books-credit"><a href="https://books.google.com" target="_blank" rel="noreferrer" aria-label="Google Books" title="Google Books"><img src="/images/google-g.png" alt="Google" width="20" height="20" /></a></p>}
          <label className="check-label">
            <input
              type="checkbox"
              checked={autoSuggest}
              onChange={(e) => setAutoSuggest(e.target.checked)}
            />
            Suggest metadata as I type
          </label>
          <div className="form-actions">
            <button
              type="button"
              className="button"
              disabled={metadataBusy || !(query || title).trim()}
              onClick={() => void lookup()}
            >
              {provider === "googlebooks" ? "Search Books" : "Find metadata"}
            </button>
            <button
              type="button"
              className="text-button"
              disabled={metadataBusy || !(query || title).trim()}
              onClick={() => void lookup(undefined, true)}
            >
              {provider === "googlebooks" ? "Search Books again" : "Retry unresolved lookup"}
            </button>
          </div>
          {metadataBusy && <p role="status">Looking up metadata…</p>}
          {result && (
            <div className="metadata-results" aria-live="polite">
              {result.candidates.some(candidate => candidate.provider === "googlebooks") && <div className="google-books-credit"><p>Google Books search results</p><a href="https://books.google.com" target="_blank" rel="noreferrer" aria-label="Google Books" title="Google Books"><img src="/images/google-g.png" alt="Google" width="20" height="20" /></a></div>}
              {result.warnings.map((warning, i) => (
                <p key={i}>{warning}</p>
              ))}
              {result.candidates.map((candidate, i) => (
                <article key={`${candidate.provider}-${candidate.id}-${i}`}>
                  <strong>{candidate.title}</strong>
                  <p>{candidate.subtitle}</p>
                  <p className="field-help">{candidate.warning}</p>
                  <a
                    href={candidate.sourceUrl}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {candidate.provider === "googlebooks" ? "View on Google Books" : "View source"}
                  </a>
                  <button
                    type="button"
                    className="button"
                    disabled={metadataBusy || candidate.applicable === false}
                    onClick={() => applyCandidate(candidate)}
                  >
                    {candidate.detail
                      ? "Review this match"
                      : "Use these details"}
                  </button>
                </article>
              ))}
            </div>
          )}
        </details>
        <label className="filter-field">
          Artwork URL
          <input
            type="url"
            placeholder="https://…"
            value={item.artwork?.url ?? ""}
            onChange={(e) =>
              update({
                artwork: e.target.value
                  ? {
                      url: e.target.value,
                      provider: "manual",
                      sourceId: "",
                      scope: "representative",
                      attribution: "Owner-selected artwork",
                      language: null,
                    }
                  : null,
              })
            }
          />
        </label>
        {item.artwork && (
          <>
            <label className="filter-field">
              Artwork match
              <select
                value={item.artwork.scope}
                onChange={(e) =>
                  update({
                    artwork: {
                      ...item.artwork!,
                      scope: e.target.value as "edition" | "representative",
                    },
                  })
                }
              >
                <option value="representative">Representative fallback</option>
                <option value="edition">Confirmed physical edition</option>
              </select>
            </label>
            {id && (
              <button
                className="text-button"
                type="button"
                onClick={async () => {
                  try {
                    const result = await request<{ message: string }>(
                      "/api/artwork",
                      "POST",
                      { itemId: id },
                    );
                    setNotice(result.message);
                  } catch (error) {
                    setError((error as Error).message);
                  }
                }}
              >
                Retry saved artwork cache
              </button>
            )}
          </>
        )}
        <label className="filter-field">
          Acquisition date
          <input
            aria-label="Acquisition date"
            type="date"
            value={item.acquiredOn ?? ""}
            onChange={(e) => update({ acquiredOn: e.target.value || null })}
          />
          <small>Leave blank if unknown.</small>
        </label>
        <label className="filter-field">
          Notes
          <textarea
            rows={3}
            maxLength={10000}
            value={item.notes ?? ""}
            onChange={(e) => update({ notes: e.target.value || null })}
          />
        </label>
        <label className="check-label">
          <input
            type="checkbox"
            checked={item.tagsMode === "auto"}
            onChange={(e) =>
              update({ tagsMode: e.target.checked ? "auto" : "manual" })
            }
          />
          Classify memory tags from notes
        </label>
        {item.tagsMode === "auto" && (
          <p className="field-help">
            Derived tags:{" "}
            {memoryTags(item.notes, item.editionTitle || title).join(", ") ||
              "None"}
          </p>
        )}
        <label className="filter-field">
          Memory tags
          <input
            aria-label="Memory tags"
            value={item.tags.join(" | ")}
            onChange={(e) => update({ tags: list(e.target.value) })}
          />
          <small>
            Separate tags with “ | ”. Turn off classification to remove or
            replace derived tags.
          </small>
        </label>
        {item.isSample && (
          <label className="check-label">
            <input
              type="checkbox"
              checked={item.isSample}
              onChange={(e) => update({ isSample: e.target.checked })}
            />
            Sample copy · excluded from personal totals
          </label>
        )}
        <div className="form-actions">
          <button type="submit" className="button button-primary">
            {busy ? "Saving…" : id ? "Save changes" : "Add copy"}
          </button>
          <button type="button" className="button" onClick={onClose}>
            Cancel
          </button>
          {id && (
            <button
              type="button"
              className="text-button danger-text"
              onClick={() => setConfirmDelete(true)}
            >
              Delete copy
            </button>
          )}
        </div>
      </fieldset>
      {confirmDelete && (
        <div className="delete-confirmation" role="alert">
          <p>
            Delete this physical copy of <strong>{title}</strong>? Its
            acquisition date, notes and tags will be removed. Other copies
            remain in your collection.
          </p>
          <button
            className="button danger-button"
            type="button"
            disabled={busy}
            onClick={() => void remove()}
          >
            Confirm delete
          </button>
          <button
            className="button"
            type="button"
            disabled={busy}
            onClick={() => setConfirmDelete(false)}
          >
            Keep copy
          </button>
        </div>
      )}
    </form>
  );
}
