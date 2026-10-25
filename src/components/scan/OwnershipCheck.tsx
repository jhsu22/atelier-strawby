import { useMemo } from "react";
import { ArrowUpRight, CircleCheck, CircleHelp, PackagePlus, ScanBarcode, Sparkles } from "lucide-react";
import { formatIsbn } from "../../domain/isbn.ts";
import { answeredOffline, ownershipAnswer } from "../../domain/scan.ts";
import type { OwnedSeries, OwnershipRun, ScanLookupResult } from "../../domain/scan.ts";

const edition = (run: OwnershipRun) => [run.language, run.publisher || run.editionTitle].filter(Boolean).join(" · ");
const vol = (volume: string | null) => (volume ? `vol. ${volume}` : "this volume");

/**
 * Read-only answer for a scanned book: nothing is saved unless the owner
 * chooses to add it, which continues into the normal review screen.
 */
export function OwnershipCheck({
  result,
  series,
  onAdd,
  onRescan,
  onOpen,
}: {
  result: ScanLookupResult;
  series: OwnedSeries[];
  onAdd: () => void;
  onRescan: () => void;
  onOpen: (seriesId: string) => void;
}) {
  const answer = useMemo(() => ownershipAnswer(result, series), [result, series]);
  const { verdict, run, title } = answer;
  const offline = answeredOffline(result);
  const dates = answer.copies.map((copy) => copy.acquiredOn).filter(Boolean);
  const heading =
    verdict === "owned"
      ? answer.confident ? "Yes, you own this." : "You probably own this."
      : verdict === "series"
        ? answer.confident ? "Not this one, but you collect it." : "Possibly a series you collect."
        : offline ? "Not found on this device." : title ? "Not in your collection." : "No match in your collection.";
  const Icon = verdict === "owned" ? CircleCheck : verdict === "series" ? Sparkles : CircleHelp;
  return (
    <section className="ownership-check" aria-label="Do I own this?">
      <div className="ownership-verdict" data-verdict={verdict} role="status">
        <Icon size={24} aria-hidden="true" />
        <div>
          <p className="scan-isbn">ISBN {formatIsbn(result.isbn13)}</p>
          <h3>{heading}</h3>
          {title && (
            <p className="ownership-title">
              <strong>{title}</strong>
              {answer.volume && `, vol. ${answer.volume}`} · {answer.language}
            </p>
          )}
        </div>
      </div>

      <ul className="ownership-facts">
        {verdict === "owned" && (
          <li>
            {answer.copies.length === 1 ? "One copy" : `${answer.copies.length} copies`} on your shelf
            {dates.length ? `, acquired ${dates.join(", ")}` : ""}. Buying it again would be a duplicate.
          </li>
        )}
        {verdict === "series" && run && (
          <li>
            You own <strong>vols. {run.volumes}</strong> of this edition ({edition(run)}), but not {vol(answer.volume)}.
          </li>
        )}
        {verdict === "series" && !run && (
          <li>You own this series, but not its {answer.language} edition.</li>
        )}
        {run && run.next && run.next !== answer.volume && (verdict === "series" || verdict === "owned") && (
          <li>The lowest volume you're missing in this edition is <strong>vol. {run.next}</strong>.</li>
        )}
        {answer.otherRuns.map((other) => (
          <li key={other.id}>
            Also owned: vols. {other.volumes} in {edition(other)}.
          </li>
        ))}
        {verdict === "new" && offline && (
          <li>No copy in the shelf saved on this device records this ISBN. Copies added without an ISBN can’t be matched offline, so search the shelf by title before you buy.</li>
        )}
        {verdict === "new" && !offline && !title && (
          <li>No copy records this ISBN, and no catalog recognized it, so it couldn't be matched to a series by title. Check the shelf by title if you're unsure.</li>
        )}
        {verdict === "new" && title && (
          <li>Nothing on your shelf records this ISBN or matches this series title.</li>
        )}
        {!answer.confident && verdict !== "new" && (
          <li className="ownership-caution">This is a possible match, not a certain one. Compare the cover. {answer.reasons.join(" ")}</li>
        )}
        {result.warnings.map((warning) => (
          <li key={warning} className="ownership-caution">{warning}</li>
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
            {verdict === "owned" ? "Add another copy" : "Add this copy"}
          </button>
        )}
        {answer.seriesId && (
          <button type="button" className="text-button" onClick={() => onOpen(answer.seriesId!)}>
            Open series <ArrowUpRight size={14} aria-hidden="true" />
          </button>
        )}
      </div>
    </section>
  );
}
