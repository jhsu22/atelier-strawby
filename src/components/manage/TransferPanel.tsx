import { useEffect, useState } from "react";
import type { ImportKind, ImportPreview } from "../../domain/transfer.ts";
import { request } from "./client.ts";
export function TransferPanel({
  onChanged,
}: {
  onChanged: () => Promise<void>;
}) {
  const [kind, setKind] = useState<ImportKind>("manga"),
    [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null),
    [includeDuplicates, setIncludeDuplicates] = useState(false);
  const [mapDate, setMapDate] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [samples, setSamples] = useState(false),
    [confirmed, setConfirmed] = useState(false);
  const [resumeToken, setResumeToken] = useState(() => {
    try {
      return localStorage.getItem("strawby-import-token") ?? "";
    } catch {
      return "";
    }
  });
  const remember = (token: string) => {
    setResumeToken(token);
    try {
      if (token) localStorage.setItem("strawby-import-token", token);
      else localStorage.removeItem("strawby-import-token");
    } catch {
      /* server keeps resumable state */
    }
  };
  useEffect(() => {
    let active = true;
    request<{ token: string; includeDuplicates: boolean } | null>(
      "/api/imports",
    )
      .then((pending) => {
        if (active && pending) {
          remember(pending.token);
          setIncludeDuplicates(pending.includeDuplicates);
        }
      })
      .catch(() => {
        /* A saved local token can still be retried. */
      });
    return () => {
      active = false;
    };
  }, []);
  async function inspect() {
    if (!file) return;
    setBusy(true);
    setError("");
    setNotice("");
    setConfirmed(false);
    try {
      if (file.size > 900000)
        throw new Error(
          "Use a file smaller than 900 KB. Split large CSV imports into smaller files.",
        );
      setPreview(
        await request<ImportPreview>("/api/imports", "POST", {
          kind,
          filename: file.name,
          text: await file.text(),
          discogsDateAddedAsAcquired: mapDate,
        }),
      );
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function commit(token: string) {
    setBusy(true);
    setError("");
    remember(token);
    try {
      for (;;) {
        const result = await request<{
          complete: boolean;
          added: number;
          total?: number;
          skipped: number;
        }>("/api/imports", "PUT", {
          token,
          includeDuplicates,
          confirmed: true,
        });
        setNotice(
          `${result.added} ${result.complete ? "copies imported" : "copies staged"}${result.total === undefined ? "" : ` of ${result.total}`}. ${result.skipped} skipped.`,
        );
        if (result.complete) break;
      }
      remember("");
      setPreview(null);
      setConfirmed(false);
      await onChanged();
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function cancel() {
    if (!resumeToken) return;
    setBusy(true);
    setError("");
    try {
      await request("/api/imports", "DELETE", {
        token: resumeToken,
        confirmed: true,
      });
      remember("");
      setPreview(null);
      setNotice(
        "Unfinished import cancelled. Existing collection copies were preserved.",
      );
      await onChanged();
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="transfer-panel">
      <h3>Export & backup</h3>
      <p>
        JSON preserves the full collection, including physical-copy IDs,
        editions, dates, notes, tracks, tags, sample flags and provenance.
        Artwork files in R2 need a separate backup.
      </p>
      <div className="form-actions">
        <a className="button" href="/api/export" download>
          Full JSON backup
        </a>
        <a
          className="button"
          href={`/api/export?kind=manga&samples=${samples}`}
          download
        >
          Manga & books CSV
        </a>
        <a
          className="button"
          href={`/api/export?kind=cd&samples=${samples}`}
          download
        >
          CD CSV
        </a>
      </div>
      <label className="check-label">
        <input
          type="checkbox"
          checked={samples}
          onChange={(e) => setSamples(e.target.checked)}
        />
        Include sample copies in CSV
      </label>
      <p className="field-help">
        CSV protects spreadsheet formula cells. Use JSON for exact restoration.
      </p>
      <h3>Import</h3>
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="form-notice">
          {notice}
        </p>
      )}
      {resumeToken && (
        <div className="resume-import">
          <p>An import can be resumed. Keep its original duplicate choice.</p>
          <label className="check-label">
            <input
              type="checkbox"
              checked={includeDuplicates}
              disabled={busy}
              onChange={(e) => setIncludeDuplicates(e.target.checked)}
            />
            Include duplicate candidates as separate copies
          </label>
          <div className="form-actions">
            <button
              className="button"
              disabled={busy}
              onClick={() => void commit(resumeToken)}
            >
              Resume import
            </button>
            <button
              className="button"
              disabled={busy}
              onClick={() => {
                if (
                  window.confirm(
                    "Cancel the unfinished import and remove its staged copies?",
                  )
                )
                  void cancel();
              }}
            >
              Cancel unfinished import
            </button>
          </div>
        </div>
      )}
      <fieldset disabled={busy || Boolean(resumeToken)}>
        <label className="filter-field">
          Import format
          <select
            value={kind}
            onChange={(e) => {
              setKind(e.target.value as ImportKind);
              setPreview(null);
            }}
          >
            <option value="manga">Manga & books CSV</option>
            <option value="cd">CD CSV</option>
            <option value="discogs">Discogs collection CSV</option>
            <option value="json">Full JSON backup</option>
          </select>
        </label>
        {kind === "discogs" && (
          <label className="check-label">
            <input
              type="checkbox"
              checked={mapDate}
              onChange={(e) => {
                setMapDate(e.target.checked);
                setPreview(null);
              }}
            />
            Use Discogs Date Added as acquisition date
          </label>
        )}
        <label className="filter-field">
          Import file
          <input
            type="file"
            accept={
              kind === "json" ? ".json,application/json" : ".csv,text/csv"
            }
            onChange={(e) => {
              setFile(e.target.files?.[0] ?? null);
              setPreview(null);
            }}
          />
        </label>
        <button
          className="button"
          disabled={!file}
          onClick={() => void inspect()}
        >
          Validate & preview
        </button>
        <details className="editor-section">
          <summary>CSV templates</summary>
          <p>
            Manga & books: Title, Volume, Author, Publisher, Date Acquired,
            Notes. Optional Medium (Manga, Light novel or Book; blank is manga),
            Language, Edition Title, Format, Canonical Title, Alternate Titles,
            Tags and Copy ID.
          </p>
          <p>
            CD: Title, Artist. Optional Label, Catalog Number, Release Date,
            Format, Edition, Date Acquired, Notes, Tags, Copy ID, Media JSON and
            Tracks JSON. Dates use YYYY-MM-DD or M/D/YYYY. Export a CSV to see a
            complete template.
          </p>
          <a href="/templates/manga.csv" download>
            Manga template
          </a>
          {" · "}
          <a href="/templates/cds.csv" download>
            CD template
          </a>
        </details>
      </fieldset>
      {preview && (
        <div className="import-preview">
          <h3>Preview</h3>
          <p>
            {preview.kind === "json"
              ? `${preview.restoredCopies} copies to restore.`
              : `${preview.total} records; ${preview.duplicates} duplicate candidates; ${preview.errors} invalid records.`}
          </p>
          {preview.warnings.map((warning, index) => (
            <p className="field-help" key={index}>
              {warning}
            </p>
          ))}
          {!!preview.rows.length && (
            <div className="preview-table">
              <table>
                <thead>
                  <tr>
                    <th>Row</th>
                    <th>Title</th>
                    <th>Volume / language</th>
                    <th>Date</th>
                    <th>Result</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.rows.map((row) => (
                    <tr key={row.number}>
                      <td>{row.number}</td>
                      <td>{row.title}</td>
                      <td>
                        {row.volume} {row.language}
                      </td>
                      <td>{row.acquiredOn ?? "Unknown"}</td>
                      <td>
                        {row.errors.join("; ") ||
                          (row.existingId
                            ? "Existing ID · skip"
                            : row.duplicate
                              ? "Duplicate candidate"
                              : "New copy")}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {!resumeToken && (
            <>
              <label className="check-label">
                <input
                  type="checkbox"
                  disabled={busy || preview.kind === "json"}
                  checked={includeDuplicates}
                  onChange={(e) => setIncludeDuplicates(e.target.checked)}
                />
                Include duplicate candidates as separate physical copies
              </label>
              <label className="check-label">
                <input
                  type="checkbox"
                  disabled={busy}
                  checked={confirmed}
                  onChange={(e) => setConfirmed(e.target.checked)}
                />
                I reviewed this preview and want to import it
              </label>
              <button
                className="button button-primary"
                disabled={busy || preview.errors > 0 || !confirmed}
                onClick={() => void commit(preview.token)}
              >
                {busy ? "Importing…" : "Commit import"}
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
