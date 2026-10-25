import { useMemo } from "react";
import { ArrowUpRight, CircleCheck, CircleHelp, PackagePlus, ScanBarcode, Sparkles } from "lucide-react";
import { formatBarcode } from "../../domain/barcode.ts";
import { cdAnsweredOffline, cdOwnershipAnswer } from "../../domain/cd-scan.ts";
import type { CdLookupResult } from "../../domain/cd-scan.ts";

const plural = (count: number, noun: string, many = `${noun}s`) => `${count} ${count === 1 ? noun : many}`;

/** Read-only answer for a scanned CD; adding continues into the CD review. */
export function CdOwnershipCheck({
  result,
  onAdd,
  onRescan,
  onOpen,
}: {
  result: CdLookupResult;
  onAdd: () => void;
  onRescan: () => void;
  onOpen: (entryId: string) => void;
}) {
  const answer = useMemo(() => cdOwnershipAnswer(result), [result]);
  const offline = cdAnsweredOffline(result);
  const dates = answer.copies.map((copy) => copy.acquiredOn).filter(Boolean);
  const heading =
    answer.verdict === "owned"
      ? "Yes, you own this CD."
      : answer.verdict === "album"
        ? "Not this pressing, but you own the album."
        : offline
          ? "Not found on this device."
          : answer.title
            ? "Not in your collection."
            : "No match in your collection.";
  const Icon = answer.verdict === "owned" ? CircleCheck : answer.verdict === "album" ? Sparkles : CircleHelp;
  return (
    <section className="ownership-check" aria-label="Do I own this?">
      <div className="ownership-verdict" data-verdict={answer.verdict === "album" ? "series" : answer.verdict} role="status">
        <Icon size={24} aria-hidden="true" />
        <div>
          <p className="scan-isbn">BARCODE {formatBarcode(result.barcode)}</p>
          <h3>{heading}</h3>
          {answer.title && (
            <p className="ownership-title">
              <strong>{answer.title}</strong>
              {answer.artists.length > 0 && ` · ${answer.artists.join(" · ")}`}
            </p>
          )}
        </div>
      </div>
      <ul className="ownership-facts">
        {answer.verdict === "owned" && (
          <li>
            {answer.copies.length === 1 ? "One copy" : `${answer.copies.length} copies`} on your shelf
            {dates.length ? `, acquired ${dates.join(", ")}` : ""}. Buying it again would be a duplicate.
          </li>
        )}
        {answer.albums.map((album) => (
          <li key={album.entryId}>
            You own {plural(album.copies, "copy", "copies")} of another edition of <strong>{album.title}</strong>. Compare the label and catalog number before buying.
          </li>
        ))}
        {answer.verdict === "new" && offline && (
          <li>No CD in the shelf saved on this device records this barcode. CDs saved without a barcode can’t be matched offline, so search the shelf by title before you buy.</li>
        )}
        {answer.verdict === "new" && !offline && answer.title && <li>No CD on your shelf records this barcode or matches this album.</li>}
        {answer.verdict === "new" && !offline && !answer.title && (
          <li>No CD records this barcode, and MusicBrainz doesn’t list it, so it couldn’t be matched by title. Search the shelf if you’re unsure.</li>
        )}
        {result.warnings.map((warning) => (
          <li key={warning} className="ownership-caution">
            {warning}
          </li>
        ))}
      </ul>
      <p className="field-help">Nothing was saved. Checking never changes your collection.</p>
      <div className="form-actions scan-actions">
        <button type="button" className="button button-primary" onClick={onRescan}>
          <ScanBarcode size={16} aria-hidden="true" />
          Check another
        </button>
        {!offline && (
          <button type="button" className="button" onClick={onAdd}>
            <PackagePlus size={16} aria-hidden="true" />
            {answer.verdict === "owned" ? "Add another copy" : "Add this CD"}
          </button>
        )}
        {answer.entryId && (
          <button type="button" className="text-button" onClick={() => onOpen(answer.entryId!)}>
            Open album <ArrowUpRight size={14} aria-hidden="true" />
          </button>
        )}
      </div>
    </section>
  );
}
