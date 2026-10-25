import { useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import { CircleCheck, Layers3, ScanBarcode, Store, TriangleAlert, X } from "lucide-react";
import { HAUL_MAX_COPIES, volumeRange } from "../../domain/haul.ts";
import type { ItemInput } from "../../domain/item.ts";
import { draftFromScan, ownedCopies, ownedRun, preselectedMatch, scanLookupResultSchema } from "../../domain/scan.ts";
import type { OwnedSeries } from "../../domain/scan.ts";
import { MEDIUM_LABELS, MEDIUMS } from "../../domain/types.ts";
import type { Medium } from "../../domain/types.ts";
import { request } from "../manage/client.ts";
import { BarcodeScanner } from "../scan/BarcodeScanner.tsx";
import { cameraMessages } from "../scan/camera.ts";

type Language = "EN" | "JP" | "KR";
type Draft = Partial<ItemInput> & { title: string; volume: string };
interface Row {
  key: string;
  item: Draft;
  /** A scanned row is still being looked up, or needs a title or volume typed in. */
  status: "ready" | "looking" | "needs";
  isbn?: string;
  /** Copies of this volume already on the shelf: buying it again is a duplicate. */
  owned: number;
  message?: string;
}
const today = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
};
const NEW_SERIES = "__new__";
let rowCount = 0;
const rowKey = () => `row-${++rowCount}`;

/** The owned edition runs of one series, for picking where a range belongs. */
function runsOf(series: OwnedSeries) {
  const runs = new Map<string, OwnedSeries["copies"][number]>();
  for (const copy of series.copies) if (!runs.has(copy.editionRunId)) runs.set(copy.editionRunId, copy);
  return [...runs.values()];
}
const runLabel = (copy: OwnedSeries["copies"][number]) =>
  [copy.language, copy.editionTitle, copy.publisher, copy.format !== "standard" ? copy.format : ""].filter(Boolean).join(" · ");

/**
 * Log several copies acquired together: a shared date, store and note, with
 * volumes added as a range or by scanning a stack. One save is atomic.
 */
export function HaulLogger({ series, onSaved }: { series: OwnedSeries[]; onSaved: () => Promise<void> }) {
  const [haulId, setHaulId] = useState(() => crypto.randomUUID());
  const [acquiredOn, setAcquiredOn] = useState<string | null>(today());
  const [store, setStore] = useState("");
  const [notes, setNotes] = useState("");
  const [keepPrivate, setKeepPrivate] = useState(true);
  const [rows, setRows] = useState<Row[]>([]);
  const [saved, setSaved] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const requestId = useRef(crypto.randomUUID());

  // Range picker
  const sorted = useMemo(() => [...series].sort((a, b) => a.title.localeCompare(b.title)), [series]);
  const [seriesId, setSeriesId] = useState(sorted[0]?.id ?? NEW_SERIES);
  const picked = sorted.find((entry) => entry.id === seriesId);
  const runs = picked ? runsOf(picked) : [];
  const [runId, setRunId] = useState("");
  const run = runs.find((copy) => copy.editionRunId === runId) ?? runs[0];
  const [fresh, setFresh] = useState({ title: "", author: "", publisher: "", language: "EN" as Language, medium: "manga" as Medium });
  const [from, setFrom] = useState("1");
  const [to, setTo] = useState("1");

  // Scanning
  const [scanning, setScanning] = useState(false);
  const [scanHint, setScanHint] = useState("");

  const limitReached = rows.length >= HAUL_MAX_COPIES;
  // The same volume listed twice is allowed (two copies) but is usually a slip.
  const listed = new Map<string, number>();
  const volumeKey = (item: Draft) => [item.seriesId ?? item.title.trim().toLowerCase(), item.language, item.format, item.volume.trim()].join("|");
  for (const row of rows) if (row.status !== "looking") listed.set(volumeKey(row.item), (listed.get(volumeKey(row.item)) ?? 0) + 1);
  const ownedOf = (entry: OwnedSeries | undefined, run: string | null, volume: string) => (entry ? ownedCopies(entry, run, volume).length : 0);

  function addRange(event: FormEvent) {
    event.preventDefault();
    setError("");
    const volumes = volumeRange(Number(from), Number(to));
    if (!volumes.length) return setError("Enter whole volume numbers, with the first no larger than the last.");
    const room = HAUL_MAX_COPIES - rows.length;
    if (volumes.length > room) return setError(`A haul saves at most ${HAUL_MAX_COPIES} copies at a time. Save these first, then add the rest to the same haul.`);
    let base: Omit<Draft, "volume">;
    if (picked && run) {
      // The chosen run itself: another run may share its language and format.
      const owned = ownedRun({ ...picked, copies: [run] }, run.language, run.format)!;
      base = { kind: "manga", seriesId: picked.id, title: picked.title, authors: picked.authors, aliases: picked.aliases, medium: owned.medium, ...owned.run };
    } else {
      if (!fresh.title.trim()) return setError("Type the series title.");
      const title = fresh.title.trim();
      base = {
        kind: "manga",
        title,
        editionTitle: title,
        authors: fresh.author.trim() ? [fresh.author.trim()] : [],
        publisher: fresh.publisher.trim(),
        language: fresh.language,
        languageBasis: "specified",
        format: "standard",
        numberingBasis: "printed",
        medium: fresh.medium,
      };
    }
    setRows((current) => [
      ...current,
      ...volumes.map((volume) => ({ key: rowKey(), item: { ...base, volume }, status: "ready" as const, owned: picked && run ? ownedOf(picked, run.editionRunId, volume) : 0 })),
    ]);
  }

  async function scanned(code: string) {
    setScanHint("");
    if (rows.length >= HAUL_MAX_COPIES) return setScanHint(`This part of the haul is full (${HAUL_MAX_COPIES} copies). Save it, then keep scanning.`);
    const key = rowKey();
    setRows((current) => [...current, { key, isbn: code, item: { kind: "manga", title: "", volume: "", isbn13: code }, status: "looking", owned: 0 }]);
    try {
      const result = scanLookupResultSchema.parse(await request<unknown>("/api/scan/isbn", "POST", { code, source: "camera" }));
      const match = preselectedMatch(result);
      const edition = result.editions.find((entry) => entry.isbnVerified) ?? null;
      const draft = draftFromScan(result, edition, match);
      const shelf = series.find((entry) => entry.id === draft.item.seriesId);
      const live = shelf ? ownedRun(shelf, draft.item.language ?? "EN", draft.item.format) : null;
      const owned = Math.max(result.duplicate.copies.length, ownedOf(shelf, live?.id ?? null, draft.item.volume));
      const needs = !draft.item.title || !draft.item.volume;
      setRows((current) => current.map((row) => row.key === key ? {
        ...row,
        item: draft.item,
        status: needs ? "needs" : "ready",
        owned,
        message: needs ? "Type the title and volume from the book." : match ? undefined : "Not matched to a series you own; it will start a new one.",
      } : row));
    } catch (failure) {
      setRows((current) => current.map((row) => row.key === key ? { ...row, status: "needs", message: `${(failure as Error).message} Type the title and volume from the book.` } : row));
    }
  }

  const editRow = (key: string, patch: Partial<Draft>) =>
    setRows((current) => current.map((row) => {
      if (row.key !== key) return row;
      const item = { ...row.item, ...patch };
      return { ...row, item, status: item.title.trim() && item.volume.trim() ? "ready" : "needs" };
    }));

  async function save() {
    setError("");
    if (!rows.length) return setError("Add at least one copy to the haul.");
    if (rows.some((row) => row.status === "looking")) return setError("Wait for the scanned books to finish looking up.");
    if (rows.some((row) => row.status === "needs")) return setError("Fill in the title and volume for every highlighted copy.");
    setBusy(true);
    try {
      await request("/api/hauls", "POST", {
        haul: { id: haulId, acquiredOn, store: store.trim() || null, notes: notes.trim() || null, private: keepPrivate, items: rows.map((row) => row.item) },
        requestId: requestId.current,
      });
      requestId.current = crypto.randomUUID();
      setSaved((count) => count + rows.length);
      setRows([]);
      await onSaved().catch(() => setError("Saved. Reload the page to see it on the shelf."));
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function startNew() {
    setHaulId(crypto.randomUUID());
    requestId.current = crypto.randomUUID();
    setSaved(0);
    setRows([]);
    setStore("");
    setNotes("");
    setAcquiredOn(today());
    setKeepPrivate(true);
    setError("");
  }

  return (
    <div className="haul-logger">
      {saved > 0 && (
        <div className="scan-saved" role="status">
          <CircleCheck size={22} aria-hidden="true" />
          <p>
            <strong>Saved {saved} {saved === 1 ? "copy" : "copies"} to this haul.</strong> Add more below to keep them together, or{" "}
            <button type="button" className="text-button" onClick={startNew}>start a new haul</button>.
          </p>
        </div>
      )}
      {/* Later parts join the same haul, so its shared details stay as first saved. */}
      <fieldset className="haul-shared" disabled={busy || saved > 0}>
        <legend>The haul</legend>
        {saved > 0 && <p className="field-help">These details are saved with the haul. Start a new haul to use different ones.</p>}
        <label className="filter-field">
          Acquisition date
          <input type="date" aria-label="Haul date" value={acquiredOn ?? ""} onChange={(e) => setAcquiredOn(e.target.value || null)} />
          <small>Shared by every copy. Clear it if you don’t know.</small>
        </label>
        <label className="filter-field">
          <span className="field-label"><Store size={15} aria-hidden="true" /> Store</span>
          <input aria-label="Store" value={store} maxLength={120} onChange={(e) => setStore(e.target.value)} placeholder="Kinokuniya, a convention, a friend…" />
        </label>
        <label className="filter-field">
          Notes
          <textarea aria-label="Haul notes" rows={2} maxLength={10000} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="What made this trip memorable" />
        </label>
        <label className="check-label">
          <input type="checkbox" checked={keepPrivate} onChange={(e) => setKeepPrivate(e.target.checked)} />
          Keep the note and store private · hidden on the public shelf
        </label>
      </fieldset>

      <form className="haul-range" onSubmit={addRange} aria-label="Add volumes by range">
        <h3><Layers3 size={16} aria-hidden="true" /> Add volumes</h3>
        <label className="filter-field">
          Series
          <select value={seriesId} onChange={(e) => { setSeriesId(e.target.value); setRunId(""); }}>
            {sorted.map((entry) => <option key={entry.id} value={entry.id}>{entry.title}</option>)}
            <option value={NEW_SERIES}>A new series…</option>
          </select>
        </label>
        {picked && runs.length > 1 && (
          <label className="filter-field">
            Edition
            <select value={run?.editionRunId ?? ""} onChange={(e) => setRunId(e.target.value)}>
              {runs.map((copy) => <option key={copy.editionRunId} value={copy.editionRunId}>{runLabel(copy)}</option>)}
            </select>
          </label>
        )}
        {picked && runs.length === 1 && run && <p className="field-help">Edition: {runLabel(run)}</p>}
        {!picked && (
          <div className="haul-new-series">
            <label className="filter-field">Series title<input value={fresh.title} onChange={(e) => setFresh({ ...fresh, title: e.target.value })} /></label>
            <label className="filter-field">Author<input value={fresh.author} onChange={(e) => setFresh({ ...fresh, author: e.target.value })} /></label>
            <label className="filter-field">Publisher<input value={fresh.publisher} onChange={(e) => setFresh({ ...fresh, publisher: e.target.value })} /></label>
            <label className="filter-field">Language
              <select value={fresh.language} onChange={(e) => setFresh({ ...fresh, language: e.target.value as Language })}>
                <option value="EN">English</option><option value="JP">Japanese</option><option value="KR">Korean</option>
              </select>
            </label>
            <label className="filter-field">Type
              <select value={fresh.medium} onChange={(e) => setFresh({ ...fresh, medium: e.target.value as Medium })}>
                {MEDIUMS.map((medium) => <option key={medium} value={medium}>{MEDIUM_LABELS[medium]}</option>)}
              </select>
            </label>
          </div>
        )}
        <div className="haul-range-row">
          <label className="filter-field">From vol.<input inputMode="numeric" aria-label="From volume" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
          <label className="filter-field">To vol.<input inputMode="numeric" aria-label="To volume" value={to} onChange={(e) => setTo(e.target.value)} /></label>
          <button type="submit" className="button" disabled={busy || limitReached}>Add to haul</button>
        </div>
      </form>

      <section className="haul-scan" aria-label="Scan a stack">
        {scanning ? (
          <>
            <BarcodeScanner
              continuous
              onCode={(code) => void scanned(code)}
              onHint={(message) => setScanHint((current) => (current === message ? current : message))}
              onProblem={(reason) => {
                setScanHint(cameraMessages[reason]);
                setScanning(false);
              }}
            />
            <button type="button" className="text-button scan-stop" onClick={() => setScanning(false)}>Stop scanning</button>
          </>
        ) : (
          <button type="button" className="button" onClick={() => { setScanHint(""); setScanning(true); }} disabled={busy || limitReached}>
            <ScanBarcode size={16} aria-hidden="true" /> Scan a stack of books
          </button>
        )}
        {scanHint && <p className="scan-hint" role="status">{scanHint}</p>}
        <p className="field-help">Hold each barcode in the frame until it’s added, then move to the next book. To log a second copy of the same book, take it away and scan it again.</p>
      </section>

      <section aria-label="Copies in this haul">
        <h3 className="haul-list-heading">{rows.length ? `${rows.length} ${rows.length === 1 ? "copy" : "copies"} to save` : "No copies added yet"}</h3>
        <ul className="haul-rows">
          {rows.map((row) => (
            <li key={row.key} className="haul-row" data-status={row.status}>
              {row.status === "looking" ? (
                <p role="status">Looking up {row.isbn}…</p>
              ) : row.status === "needs" || row.isbn ? (
                <div className="haul-row-fields">
                  <label className="filter-field">Title<input aria-label={`Title for row ${rows.indexOf(row) + 1}`} value={row.item.title} onChange={(e) => editRow(row.key, { title: e.target.value, seriesId: undefined })} /></label>
                  <label className="filter-field">Vol.<input aria-label={`Volume for row ${rows.indexOf(row) + 1}`} value={row.item.volume} onChange={(e) => editRow(row.key, { volume: e.target.value })} /></label>
                </div>
              ) : (
                <p><strong>{row.item.title}</strong>, vol. {row.item.volume}</p>
              )}
              <p className="haul-row-meta">
                {[row.item.language, row.item.publisher, row.isbn && `ISBN ${row.isbn}`].filter(Boolean).join(" · ")}
              </p>
              {row.owned > 0 && <p className="haul-row-warning"><TriangleAlert size={14} aria-hidden="true" /> Already on your shelf ({row.owned}). Saving adds another copy.</p>}
              {row.status !== "looking" && (listed.get(volumeKey(row.item)) ?? 0) > 1 && (
                <p className="haul-row-warning"><TriangleAlert size={14} aria-hidden="true" /> Listed more than once in this haul. Keep both only if you bought two copies.</p>
              )}
              {row.message && <p className="haul-row-warning"><TriangleAlert size={14} aria-hidden="true" /> {row.message}</p>}
              <button type="button" className="icon-button haul-row-remove" aria-label={`Remove ${row.item.title || row.isbn || "copy"}${row.item.volume ? ` vol. ${row.item.volume}` : ""}`} onClick={() => setRows((current) => current.filter((entry) => entry.key !== row.key))}>
                <X size={16} />
              </button>
            </li>
          ))}
        </ul>
      </section>

      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="form-actions">
        <button type="button" className="button button-primary" disabled={busy || !rows.length} onClick={() => void save()}>
          <CircleCheck size={16} aria-hidden="true" />
          {busy ? "Saving…" : `Save ${rows.length || ""} ${rows.length === 1 ? "copy" : "copies"}${saved ? " to this haul" : " as one haul"}`.replace(/\s+/g, " ")}
        </button>
      </div>
      <p className="field-help">Each save is all-or-nothing, up to {HAUL_MAX_COPIES} copies. Larger hauls save in parts that stay together on the timeline.</p>
    </div>
  );
}
