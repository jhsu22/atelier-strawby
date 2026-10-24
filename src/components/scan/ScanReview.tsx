import { useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import { CircleCheck, Copy, PencilLine, ScanBarcode, TriangleAlert } from "lucide-react";
import { itemSchema } from "../../domain/item.ts";
import type { ItemInput } from "../../domain/item.ts";
import { formatIsbn } from "../../domain/isbn.ts";
import { draftFromScan, ownedCopies, ownedRun, ownerMatch, preselectedMatch } from "../../domain/scan.ts";
import type { FieldSource, OwnedSeries, ScanLookupResult } from "../../domain/scan.ts";
import { MEDIUM_LABELS, MEDIUMS } from "../../domain/types.ts";
import type { Medium } from "../../domain/types.ts";
import { request } from "../manage/client.ts";

const sourceLabels: Record<FieldSource, string> = {
  collection: "From your collection",
  provider: "From the catalog",
  "isbn-prefix": "Assumed from ISBN",
  scan: "Scanned",
  missing: "Needs your input",
};
const providerName = (provider: string) => (provider === "googlebooks" ? "Google Books" : "Open Library");
const today = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
};
const list = (value: string) => value.split("|").map((part) => part.trim()).filter(Boolean);

function Source({ value }: { value: FieldSource | undefined }) {
  if (!value) return null;
  return <span className={`field-source field-source-${value}`}>{sourceLabels[value]}</span>;
}

/**
 * Editable confirmation. Nothing is saved until the owner presses save; the
 * catalog record and owned series are choices, not conclusions.
 */
type Choice = { kind: "match"; index: number } | { kind: "owned"; id: string } | { kind: "new" };

export function ScanReview({
  result,
  series,
  onSaved,
  onRescan,
  onEditFully,
}: {
  result: ScanLookupResult;
  /** Owned volume series on the shelf, for picking by hand and live duplicate checks. */
  series: OwnedSeries[];
  onSaved: (saved: { id: string; title: string; volume: string }) => Promise<void>;
  onRescan: () => void;
  onEditFully: (seed: Partial<ItemInput>) => void;
}) {
  const verified = result.editions.filter((edition) => edition.isbnVerified);
  const [editionIndex, setEditionIndex] = useState(verified.length ? 0 : -1);
  const [choice, setChoice] = useState<Choice>(preselectedMatch(result) ? { kind: "match", index: 0 } : { kind: "new" });
  const edition = verified[editionIndex] ?? null;
  const picked = choice.kind === "owned" ? series.find((entry) => entry.id === choice.id) : undefined;
  const match = useMemo(
    () =>
      choice.kind === "match"
        ? (result.matches[choice.index] ?? null)
        : picked
          ? ownerMatch(picked, edition?.language ?? result.languageHint ?? "EN", edition?.volume ?? "", edition?.format)
          : null,
    [choice, picked, result, edition],
  );
  const draft = useMemo(() => draftFromScan(result, edition, match), [result, edition, match]);
  const [fields, setFields] = useState(draft.item);
  const key = `${editionIndex}:${choice.kind}:${choice.kind === "match" ? choice.index : choice.kind === "owned" ? choice.id : ""}`;
  const [draftKey, setDraftKey] = useState(key);
  const shelfSeries = series.find((entry) => entry.id === fields.seriesId);
  const changedSeries = match ? fields.title !== match.seriesTitle : false;
  // Re-checked as the owner corrects the volume or language: the shelf is the
  // source of truth for owned copies, the lookup for exact-ISBN copies.
  const runId = shelfSeries && !changedSeries ? (ownedRun(shelfSeries, fields.language ?? "EN", fields.format)?.id ?? null) : null;
  const liveCopies = shelfSeries && !changedSeries ? ownedCopies(shelfSeries, runId, fields.volume) : (match?.copies ?? []);
  const owned = liveCopies.length > 0;
  const [useCover, setUseCover] = useState(Boolean(draft.item.artwork) && !owned);
  const [acquiredOn, setAcquiredOn] = useState<string | null>(today());
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [coverFailed, setCoverFailed] = useState(false);
  const [error, setError] = useState("");
  const requestId = useRef(crypto.randomUUID());
  // Choosing another record or series rebuilds catalog fields from that
  // choice; acquisition details the owner typed are kept.
  if (key !== draftKey) {
    setDraftKey(key);
    setFields(draft.item);
    setUseCover(Boolean(draft.item.artwork) && !match?.copies.length);
  }
  const update = (patch: Partial<Omit<ItemInput, "isbn13">>) => setFields((current) => ({ ...current, ...patch }));
  /** A different language of an owned series is a different edition run. */
  function changeLanguage(language: ItemInput["language"]) {
    const run = shelfSeries && !changedSeries ? ownedRun(shelfSeries, language, fields.format) : null;
    update(
      run
        ? { ...run.run, medium: run.medium }
        : {
            language,
            languageBasis: "confirmed",
            editionTitle: edition?.seriesTitle || fields.title,
            publisher: edition?.publisher ?? "",
            numberingBasis: "printed",
          },
    );
  }
  const exact = result.duplicate.level === "exact-isbn" ? result.duplicate.copies : [];
  const duplicateCopies = [...exact, ...liveCopies.filter((copy) => !exact.some((entry) => entry.id === copy.id))];
  const duplicate = duplicateCopies.length > 0;

  const values = () => ({
    ...fields,
    // A changed title no longer describes the matched series.
    ...(changedSeries ? { seriesId: undefined } : {}),
    artwork: useCover ? (fields.artwork ?? null) : null,
    catalogSource: edition ? { provider: edition.provider, sourceId: edition.sourceId, sourceUrl: edition.sourceUrl } : null,
    acquiredOn,
    notes: notes.trim() || null,
  });
  function item(): ItemInput | null {
    const parsed = itemSchema.safeParse(values());
    if (!parsed.success) {
      setError(parsed.error.issues.map((issue) => `${issue.path.join(".") || "Form"}: ${issue.message}`).join(" "));
      return null;
    }
    return parsed.data;
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    const value = item();
    if (!value) return;
    setBusy(true);
    try {
      const saved = await request<{ id: string }>("/api/items", "POST", { item: value, requestId: requestId.current });
      if (value.artwork)
        await request("/api/artwork", "POST", { itemId: saved.id }).catch(() => undefined);
      await onSaved({ id: saved.id, title: value.title, volume: value.volume });
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const cover = useCover && !coverFailed ? fields.artwork?.url : undefined;
  // Missing-field notes and badges clear as soon as the owner fills the field.
  const checks = [
    ...result.warnings,
    ...(fields.title.trim() ? [] : draft.fieldFlags.title ? [draft.fieldFlags.title] : []),
    ...(fields.volume.trim() ? [] : draft.fieldFlags.volume ? [draft.fieldFlags.volume] : []),
    ...draft.flags,
  ];
  const sourceOf = (field: "title" | "volume" | "publisher" | "authors", filled: boolean) =>
    draft.sources[field] === "missing" && filled ? undefined : draft.sources[field];
  return (
    <form className="scan-review" onSubmit={submit} aria-label="Review scanned copy">
      <header className="scan-summary">
        <div className="scan-cover" aria-hidden="true">
          {cover ? <img src={cover} alt="" referrerPolicy="no-referrer" onError={() => setCoverFailed(true)} /> : <ScanBarcode size={28} />}
        </div>
        <div>
          <p className="scan-isbn">
            ISBN {formatIsbn(result.isbn13)}
            {result.isbn10 && <span> · ISBN-10 {result.isbn10}</span>}
          </p>
          <h3>{fields.title || "Untitled volume"}</h3>
          <p className="scan-volume">{fields.volume ? `Volume ${fields.volume}` : "Volume unknown"} · {fields.language}</p>
          <p className="field-help">
            {result.local
              ? "Recognized from your collection; no catalog request was needed."
              : edition
                ? `Catalog details from ${providerName(edition.provider)}.`
                : "No catalog record lists this ISBN. Enter the details from the book."}
          </p>
        </div>
      </header>

      {duplicate && (
        <div className="scan-duplicate" role="status">
          <Copy size={18} aria-hidden="true" />
          <p>
            <strong>
              {result.duplicate.level === "exact-isbn"
                ? `You already own this exact edition (${duplicateCopies.length} ${duplicateCopies.length === 1 ? "copy" : "copies"}).`
                : `You already own volume ${fields.volume} of this edition.`}
            </strong>{" "}
            {duplicateCopies.some((copy) => copy.acquiredOn) &&
              `Acquired ${duplicateCopies.map((copy) => copy.acquiredOn).filter(Boolean).join(", ")}. `}
            Saving adds another physical copy; nothing is replaced.
          </p>
        </div>
      )}

      {checks.length > 0 && (
        <ul className="scan-flags" aria-label="Check before saving">
          {checks.map((flag) => (
            <li key={flag}>
              <TriangleAlert size={15} aria-hidden="true" />
              {flag}
            </li>
          ))}
        </ul>
      )}

      <fieldset className="scan-choices">
          <legend>Which series is this?</legend>
          {result.matches.map((candidate, index) => (
            <label key={`${candidate.seriesId}-${index}`} className="scan-choice">
              <input type="radio" name="scan-match" checked={choice.kind === "match" && choice.index === index} onChange={() => setChoice({ kind: "match", index })} />
              <span>
                <strong>{candidate.seriesTitle}</strong>
                <small>
                  {candidate.run ? `${candidate.run.language} · ${candidate.run.publisher || candidate.run.editionTitle}` : "New edition of this series"}
                  {" · "}
                  {candidate.score >= 0.8 ? "Strong match" : "Possible match"}
                </small>
                <small className="scan-reason">{candidate.reasons.join(" ")}</small>
              </span>
            </label>
          ))}
          {series.length > 0 && (
            <div className="scan-choice">
              <input
                type="radio"
                name="scan-match"
                aria-label="A series I own"
                checked={choice.kind === "owned"}
                onChange={() => series[0] && setChoice({ kind: "owned", id: picked?.id ?? series[0].id })}
              />
              <span>
                <label htmlFor="scan-owned-series">
                  <strong>{result.matches.length ? "Another series I own" : "A series I own"}</strong>
                </label>
                <select
                  id="scan-owned-series"
                  value={choice.kind === "owned" ? choice.id : ""}
                  onChange={(e) => setChoice(e.target.value ? { kind: "owned", id: e.target.value } : { kind: "new" })}
                >
                  <option value="">Choose a series…</option>
                  {series.map((entry) => (
                    <option key={entry.id} value={entry.id}>
                      {entry.title}
                    </option>
                  ))}
                </select>
              </span>
            </div>
          )}
          <label className="scan-choice">
            <input type="radio" name="scan-match" checked={choice.kind === "new"} onChange={() => setChoice({ kind: "new" })} />
            <span>
              <strong>A series I don’t own yet</strong>
              <small>Creates a new series from these details</small>
            </span>
          </label>
        </fieldset>

      {verified.length > 1 && (
        <fieldset className="scan-choices">
          <legend>Catalog record</legend>
          {verified.map((candidate, index) => (
            <label key={`${candidate.provider}-${candidate.sourceId}`} className="scan-choice">
              <input type="radio" name="scan-edition" checked={editionIndex === index} onChange={() => setEditionIndex(index)} />
              <span>
                <strong>{providerName(candidate.provider)}</strong>
                <small>
                  {candidate.title}
                  {candidate.publisher && ` · ${candidate.publisher}`}
                </small>
              </span>
            </label>
          ))}
        </fieldset>
      )}

      <fieldset disabled={busy} className="scan-fields">
        <label className="filter-field">
          <span className="field-label">
            Series title <Source value={changedSeries ? undefined : sourceOf("title", Boolean(fields.title.trim()))} />
          </span>
          <input required maxLength={300} value={fields.title} onChange={(e) => update({ title: e.target.value })} />
          {changedSeries && <small>Editing the title saves this copy as a new series.</small>}
        </label>
        <div className="form-grid">
          <label className="filter-field">
            <span className="field-label">
              Volume <Source value={sourceOf("volume", Boolean(fields.volume.trim()))} />
            </span>
            <input required maxLength={40} inputMode="decimal" value={fields.volume} onChange={(e) => update({ volume: e.target.value, numberingBasis: "printed" })} />
          </label>
          <label className="filter-field">
            <span className="field-label">
              Language <Source value={draft.sources.language} />
            </span>
            <select
              value={fields.language}
              onChange={(e) => changeLanguage(e.target.value as ItemInput["language"])}
            >
              <option value="EN">English</option>
              <option value="JP">Japanese</option>
              <option value="KR">Korean</option>
            </select>
          </label>
        </div>
        <label className="filter-field">
          <span className="field-label">
            Publisher <Source value={sourceOf("publisher", Boolean(fields.publisher?.trim()))} />
          </span>
          <input maxLength={300} value={fields.publisher ?? ""} onChange={(e) => update({ publisher: e.target.value })} />
        </label>
        <label className="filter-field">
          <span className="field-label">
            Authors <Source value={sourceOf("authors", Boolean(fields.authors?.length))} />
          </span>
          <input value={(fields.authors ?? []).join(" | ")} onChange={(e) => update({ authors: list(e.target.value) })} disabled={Boolean(match && !changedSeries)} />
          <small>{match && !changedSeries ? "Series credits are kept from your collection." : "Separate multiple names with “ | ”."}</small>
        </label>
        <label className="filter-field">
          <span className="field-label">
            Type <Source value={draft.sources.medium} />
          </span>
          <select value={fields.medium} onChange={(e) => update({ medium: e.target.value as Medium })}>
            {MEDIUMS.map((medium) => (
              <option key={medium} value={medium}>
                {MEDIUM_LABELS[medium]}
              </option>
            ))}
          </select>
        </label>
        {fields.artwork && (
          <label className="check-label">
            <input type="checkbox" checked={useCover} onChange={(e) => setUseCover(e.target.checked)} />
            {owned ? "Replace this volume’s cover with the catalog cover" : "Use the catalog cover (shown above) for this volume"}
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
        </div>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="form-actions scan-actions">
          <button type="submit" className="button button-primary">
            <CircleCheck size={16} aria-hidden="true" />
            {busy ? "Saving…" : duplicate ? "Add another copy" : "Add to collection"}
          </button>
          <button type="button" className="button" onClick={onRescan}>
            <ScanBarcode size={16} aria-hidden="true" />
            Scan again
          </button>
          <button
            type="button"
            className="text-button"
            onClick={() => {
              // Unfinished drafts move to the full editor too; empty required
              // fields are left for the editor to collect.
              const { title, volume, ...rest } = values();
              onEditFully({ ...rest, ...(title.trim() ? { title } : {}), ...(volume.trim() ? { volume } : {}) });
            }}
          >
            <PencilLine size={15} aria-hidden="true" />
            Edit all fields
          </button>
        </div>
      </fieldset>
    </form>
  );
}
