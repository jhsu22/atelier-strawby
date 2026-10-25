import { useEffect, useMemo, useRef, useState } from "react";
import type { RefObject } from "react";
import { Check, Disc3, ImageOff, Library, Search } from "lucide-react";
import { CLEANUP_KINDS, CLEANUP_LABELS, cleanupQueue, isCoverTask } from "../../domain/cleanup.ts";
import type { CleanupKind, CleanupRequest, CleanupTask, CoverCandidates, CoverTask, DateTask, EditionTask } from "../../domain/cleanup.ts";
import type { LibraryEntry, MangaCopy } from "../../domain/library.ts";
import { calendarLabel } from "../../domain/collection-insights.ts";
import { request } from "../manage/client.ts";

const LANGUAGES = [
  ["EN", "English"],
  ["JP", "Japanese"],
  ["KR", "Korean"],
] as const;
const FORMATS = [
  ["standard", "Standard volumes"],
  ["omnibus", "Omnibus"],
  ["collectors", "Collector’s edition"],
  ["artbook", "Art book"],
  ["anthology", "Anthology"],
] as const;
const NUMBERING: Record<string, string> = {
  printed: "printed on the books",
  source_record: "taken from the imported record",
  unknown: "unknown",
};
const today = () => new Date().toLocaleDateString("en-CA");
const plural = (count: number, noun: string, many = `${noun}s`) => `${count} ${count === 1 ? noun : many}`;

/**
 * Owner-only: walks the stats caveats one card at a time. Every answer saves
 * at once; the shelf reloads and the next card takes its place.
 */
export function CleanupQueue({
  entries,
  onChanged,
  onEdit,
  initial,
}: {
  entries: LibraryEntry[];
  onChanged: () => Promise<void>;
  onEdit: (copyId: string) => void;
  initial?: CleanupKind;
}) {
  const queue = useMemo(() => cleanupQueue(entries), [entries]);
  const [kind, setKind] = useState<CleanupKind>(() => initial ?? CLEANUP_KINDS.find((value) => queue[value].length) ?? "language");
  const [skipped, setSkipped] = useState<Set<string>>(() => new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const tasks = queue[kind];
  const open = tasks.filter((task) => !skipped.has(task.key));
  const task = open[0];
  const heading = useRef<HTMLHeadingElement>(null);
  const shown = useRef(task?.key);
  // Keyboard and screen reader users land on each new card.
  useEffect(() => {
    if (task && shown.current !== task.key && shown.current !== undefined) heading.current?.focus();
    shown.current = task?.key;
  }, [task?.key]);
  function choose(next: CleanupKind) {
    setKind(next);
    setError("");
    setStatus("");
  }
  async function save(body: CleanupRequest, done: string) {
    setBusy(true);
    setError("");
    try {
      await request("/api/cleanup", "POST", body);
      await onChanged();
      setStatus(`${done} ${plural(Math.max(0, open.length - 1), "card")} left here.`);
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const skip = () => {
    if (!task) return;
    setSkipped((current) => new Set(current).add(task.key));
    setError("");
    setStatus("Skipped. It will be back the next time you open the queue.");
  };
  return (
    <div className="cleanup-queue">
      <p className="field-help">
        Details the stats can’t vouch for yet. Each answer saves straight away and applies to every copy it covers.
      </p>
      <div className="cleanup-kinds" role="group" aria-label="What to review">
        {CLEANUP_KINDS.map((value) => (
          <button key={value} type="button" aria-pressed={kind === value} onClick={() => choose(value)}>
            <span>{CLEANUP_LABELS[value].title}</span>
            <strong className="mono">{queue[value].length}</strong>
          </button>
        ))}
      </div>
      <p className="field-help">{CLEANUP_LABELS[kind].help}</p>
      <p className="sr-only" role="status">
        {status}
      </p>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {task ? (
        <article className="cleanup-card" aria-labelledby="cleanup-card-title" data-cleanup-kind={kind}>
          <p className="scan-isbn">
            {CLEANUP_LABELS[kind].title.toUpperCase()} · {tasks.length - open.length + 1} OF {tasks.length}
          </p>
          <Card key={task.key} task={task} busy={busy} heading={heading} save={save} onEdit={onEdit} />
          <div className="form-actions cleanup-skip">
            <button type="button" className="text-button" onClick={skip} disabled={busy}>
              Skip for now
            </button>
            <button type="button" className="text-button" onClick={() => onEdit(firstCopy(task))} disabled={busy}>
              Open in editor
            </button>
          </div>
        </article>
      ) : (
        <div className="cleanup-done">
          <Check size={22} aria-hidden="true" />
          <p>{tasks.length ? `Only skipped cards are left here (${tasks.length}).` : "Nothing left to review here."}</p>
          {!!tasks.length && (
            <button type="button" className="button" onClick={() => setSkipped(new Set())}>
              Review skipped cards
            </button>
          )}
        </div>
      )}
    </div>
  );
}
const firstCopy = (task: CleanupTask) =>
  task.kind === "date" ? task.items[0]!.copy.id : isCoverTask(task) ? task.copy.id : task.copies[0]!.id;
const version = (copy: { version?: number }) => copy.version ?? 1;

type Save = (body: CleanupRequest, done: string) => Promise<void>;
interface CardProps {
  task: CleanupTask;
  busy: boolean;
  heading: RefObject<HTMLHeadingElement | null>;
  save: Save;
  onEdit: (copyId: string) => void;
}
function Card(props: CardProps) {
  const { task } = props;
  if (task.kind === "date") return <DateCard {...props} task={task} />;
  if (isCoverTask(task)) return <CoverCard {...props} task={task} />;
  return <EditionCard {...props} task={task} />;
}

function Summary({
  heading,
  title,
  lines,
  cover,
  cd = false,
  thumbnail = true,
}: {
  heading: CardProps["heading"];
  title: string;
  lines: string[];
  cover?: string | undefined;
  cd?: boolean;
  /** Off when the card shows the cover itself. */
  thumbnail?: boolean;
}) {
  const [failed, setFailed] = useState(false);
  return (
    <header className="scan-summary">
      {thumbnail && (
        <div className={`scan-cover ${cd ? "cleanup-cd" : ""}`} aria-hidden="true">
          {cover && !failed ? (
            <img src={cover} alt="" referrerPolicy="no-referrer" onError={() => setFailed(true)} />
          ) : cd ? (
            <Disc3 size={26} />
          ) : (
            <Library size={26} />
          )}
        </div>
      )}
      <div>
        <h3 id="cleanup-card-title" ref={heading} tabIndex={-1}>
          {title}
        </h3>
        {lines.filter(Boolean).map((line) => (
          <p key={line} className="scan-volume">
            {line}
          </p>
        ))}
      </div>
    </header>
  );
}

function EditionCard({ task, busy, heading, save }: CardProps & { task: EditionTask }) {
  const copy = task.copies[0]!;
  const seen = {
    language: copy.language,
    languageBasis: copy.languageBasis,
    format: copy.format as "standard",
    numberingBasis: copy.numberingBasis,
  };
  const [format, setFormat] = useState(copy.format === "unknown" ? "standard" : copy.format);
  const [printed, setPrinted] = useState(true);
  const lines = [
    copy.editionTitle !== task.entry.title ? copy.editionTitle : "",
    [copy.publisher || "Publisher unknown", plural(task.copies.length, "copy", "copies"), task.volumes && `Vol. ${task.volumes}`]
      .filter(Boolean)
      .join(" · "),
  ];
  const cover = task.copies.find((entry) => entry.artwork)?.artwork?.url;
  if (task.kind === "language")
    return (
      <>
        <Summary heading={heading} title={task.entry.title} lines={lines} cover={cover} />
        <fieldset className="cleanup-choice">
          <legend>Which language is this edition printed in?</legend>
          <p className="field-help">
            Recorded as {LANGUAGES.find(([code]) => code === copy.language)![1]}, but assumed. Your answer confirms it for{" "}
            {task.copies.length === 1 ? "this copy" : `all ${task.copies.length} copies`}.
          </p>
          <div className="form-actions">
            {LANGUAGES.map(([code, name]) => (
              <button
                key={code}
                type="button"
                className={`button ${code === copy.language ? "button-primary" : ""}`}
                disabled={busy}
                onClick={() =>
                  void save({ action: "edition", runId: task.runId, seen, language: code }, `Confirmed as ${name}.`)
                }
              >
                {name}
              </button>
            ))}
          </div>
        </fieldset>
      </>
    );
  return (
    <>
      <Summary heading={heading} title={task.entry.title} lines={lines} cover={cover} />
      <fieldset className="cleanup-choice">
        <legend>How is this edition published?</legend>
        <p className="field-help">
          Recorded: {copy.format === "unknown" ? "format unknown" : (FORMATS.find(([value]) => value === copy.format)?.[1] ?? copy.format)}
          {" · "}numbering {NUMBERING[copy.numberingBasis]}.
        </p>
        <label className="filter-field">
          Format
          <select aria-label="Format" value={format} onChange={(event) => setFormat(event.target.value)} disabled={busy}>
            {FORMATS.map(([value, name]) => (
              <option key={value} value={value}>
                {name}
              </option>
            ))}
          </select>
        </label>
        {copy.numberingBasis !== "printed" && (
          <label className="check-label">
            <input type="checkbox" checked={printed} onChange={(event) => setPrinted(event.target.checked)} disabled={busy} />
            The volume numbers I recorded are printed on the books
          </label>
        )}
        <div className="form-actions">
          <button
            type="button"
            className="button button-primary"
            disabled={busy || (format === copy.format && (copy.numberingBasis === "printed" || !printed))}
            onClick={() =>
              void save(
                {
                  action: "edition",
                  runId: task.runId,
                  seen,
                  ...(format !== copy.format ? { format: format as "standard" } : {}),
                  ...(copy.numberingBasis !== "printed" && printed ? { numberingBasis: "printed" as const } : {}),
                },
                "Edition confirmed.",
              )
            }
          >
            Confirm
          </button>
        </div>
      </fieldset>
    </>
  );
}

function DateCard({ task, busy, heading, save }: CardProps & { task: DateTask }) {
  const [date, setDate] = useState("");
  const { entry, copy } = task.items[0]!;
  const valid = /^\d{4}-\d{2}-\d{2}$/.test(date) && date <= today();
  const describe = (item: DateTask["items"][number]) =>
    item.entry.kind === "cd"
      ? `${item.entry.title} · CD`
      : `${item.entry.title} · ${(item.copy as MangaCopy).volume ? `Vol. ${(item.copy as MangaCopy).volume}` : (item.copy as MangaCopy).bookTitle || "Book"} · ${(item.copy as MangaCopy).language}`;
  const lines = task.haul
    ? [`Logged haul · ${plural(task.items.length, "copy", "copies")}${task.haul.store ? ` · ${task.haul.store}` : ""}`]
    : [describe(task.items[0]!).slice(entry.title.length + 3), copy.notes ? `“${copy.notes}”` : ""];
  return (
    <>
      <Summary
        heading={heading}
        title={task.haul ? task.items.map(describe).slice(0, 3).join("; ") + (task.items.length > 3 ? "…" : "") : entry.title}
        lines={lines}
        cover={entry.kind === "cd" ? (entry.artwork?.url ?? undefined) : ((copy as MangaCopy).artwork?.url ?? undefined)}
        cd={entry.kind === "cd"}
      />
      <fieldset className="cleanup-choice">
        <legend>When did you get {task.haul ? "this haul" : "it"}?</legend>
        {task.haul && <p className="field-help">A logged haul shares one date, so this sets it for every copy in the haul.</p>}
        <label className="filter-field">
          Acquisition date
          <input type="date" aria-label="Acquisition date" value={date} max={today()} onChange={(event) => setDate(event.target.value)} disabled={busy} />
        </label>
        <div className="form-actions">
          <button
            type="button"
            className="button button-primary"
            disabled={busy || !valid}
            onClick={() =>
              void save({ action: "date", copyId: copy.id, version: version(copy), acquiredOn: date }, `Saved ${calendarLabel(date)}.`)
            }
          >
            Save date
          </button>
          <button
            type="button"
            className="button"
            disabled={busy}
            onClick={() => void save({ action: "date", copyId: copy.id, version: version(copy), acquiredOn: null }, "Marked as unknown.")}
          >
            I don’t know
          </button>
        </div>
        <p className="field-help">“I don’t know” takes it out of this queue. Stats still count it as undated.</p>
      </fieldset>
    </>
  );
}

function CoverCard({ task, busy, heading, save }: CardProps & { task: CoverTask }) {
  const cd = task.entry.kind === "cd";
  const copy = task.copy as MangaCopy;
  const lines = cd
    ? [task.entry.kind === "cd" ? task.entry.artists.join(" · ") || "Artist unresolved" : "", "CD"]
    : [
        [copy.volume ? `Vol. ${copy.volume}` : copy.bookTitle, copy.language, copy.publisher || "Publisher unknown"].filter(Boolean).join(" · "),
        task.copies > 1 ? `${task.copies} copies share this cover` : "",
      ];
  const done = { action: "cover" as const, copyId: task.copy.id, version: version(task.copy) };
  if (task.kind === "cover")
    return (
      <>
        <Summary heading={heading} title={task.entry.title} lines={lines} cd={cd} thumbnail={false} />
        <figure className="cleanup-artwork">
          <img src={task.artwork!.url} alt={`Cover shown for ${task.entry.title}`} referrerPolicy="no-referrer" />
          <figcaption className="field-help">{task.artwork!.attribution}</figcaption>
        </figure>
        <fieldset className="cleanup-choice">
          <legend>Is this the cover of your copy?</legend>
          <div className="form-actions">
            <button type="button" className="button button-primary" disabled={busy} onClick={() => void save({ ...done, decision: "confirm" }, "Cover confirmed.")}>
              Yes, it matches
            </button>
            <button type="button" className="button" disabled={busy} onClick={() => void save({ ...done, decision: "remove" }, "Cover removed.")}>
              No, remove it
            </button>
          </div>
          <p className="field-help">A removed cover moves this volume to “No cover”, where you can pick another.</p>
        </fieldset>
      </>
    );
  return <MissingCover task={task} busy={busy} heading={heading} save={save} lines={lines} cd={cd} />;
}

function MissingCover({
  task,
  busy,
  heading,
  save,
  lines,
  cd,
}: Omit<CardProps, "onEdit" | "task"> & { task: CoverTask; lines: string[]; cd: boolean }) {
  const [result, setResult] = useState<CoverCandidates | null>(null);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState("");
  const done = { copyId: task.copy.id, version: version(task.copy) };
  async function find(retry = false) {
    setSearching(true);
    setError("");
    try {
      setResult(await request<CoverCandidates>("/api/cleanup/covers", "POST", { copyId: task.copy.id, retry }));
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      setSearching(false);
    }
  }
  async function choose(artwork: CoverCandidates["candidates"][number]["artwork"]) {
    await save({ action: "apply-cover", ...done, artwork }, "Cover saved.");
    // Caching the image is best effort; the saved source stays usable.
    await request("/api/artwork", "POST", { itemId: task.copy.id }).catch(() => undefined);
  }
  return (
    <>
      <Summary heading={heading} title={task.entry.title} lines={lines} cd={cd} />
      <fieldset className="cleanup-choice">
        <legend>Find a cover for {cd ? "this CD" : "this volume"}</legend>
        {cd ? (
          <p className="field-help">CD covers come with the exact release. Choose it in the editor, or record that none exists.</p>
        ) : (
          <div className="form-actions">
            <button type="button" className="button button-primary" disabled={busy || searching} onClick={() => void find(Boolean(result))}>
              <Search size={16} aria-hidden="true" />
              {result ? "Search again" : "Find covers"}
            </button>
          </div>
        )}
        {searching && <p role="status">Looking for covers…</p>}
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        {result && (
          <div aria-live="polite">
            {result.warnings.map((warning) => (
              <p key={warning} className="field-help">
                {warning}
              </p>
            ))}
            {!!result.candidates.length && (
              <>
                <p className="field-help">Pick the one that matches your copy. Choosing it confirms it for this edition.</p>
                <ul className="cleanup-candidates">
                  {result.candidates.map((candidate) => (
                    <li key={candidate.artwork.url}>
                      <button type="button" disabled={busy} onClick={() => void choose(candidate.artwork)} aria-label={`Use this cover: ${candidate.label}`}>
                        <img src={candidate.artwork.url} alt="" referrerPolicy="no-referrer" loading="lazy" />
                        <span>{candidate.label}</span>
                        {candidate.exact && <small>Matches this edition</small>}
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        )}
        <div className="form-actions">
          <button type="button" className="button" disabled={busy} onClick={() => void save({ action: "cover", ...done, decision: "unavailable" }, "Recorded that no cover exists.")}>
            <ImageOff size={16} aria-hidden="true" />
            No cover exists
          </button>
        </div>
      </fieldset>
    </>
  );
}
