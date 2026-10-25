import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { Camera, CircleCheck, ImageUp, Keyboard, RotateCcw, ScanBarcode } from "lucide-react";
import { parseIsbn } from "../../domain/isbn.ts";
import { offlineLookup, scanLookupResultSchema } from "../../domain/scan.ts";
import type { OwnedSeries, ScanLookupResult, ScanLookupRequest } from "../../domain/scan.ts";
import type { ItemInput } from "../../domain/item.ts";
import { NetworkError, request } from "../manage/client.ts";
import { BarcodeScanner } from "./BarcodeScanner.tsx";
import { cameraMessages } from "./camera.ts";
import type { CameraProblem } from "./camera.ts";
import { detectInFile, loadDetector, pickIsbn } from "./detector.ts";
import { ScanReview } from "./ScanReview.tsx";
import { OwnershipCheck } from "./OwnershipCheck.tsx";

type Stage =
  | { name: "camera" }
  | { name: "idle" }
  | { name: "looking"; code: string }
  | { name: "review"; result: ScanLookupResult; key: number }
  | { name: "answer"; result: ScanLookupResult }
  | { name: "saved"; title: string; volume: string };

/** Lookup failed entirely: keep the scanned ISBN and continue by hand. */
function offlineResult(code: string, message: string): ScanLookupResult | null {
  const isbn = parseIsbn(code);
  if (!isbn.ok) return null;
  return {
    isbn13: isbn.isbn13,
    isbn10: isbn.isbn10,
    languageHint: isbn.hint,
    editions: [],
    matches: [],
    duplicate: { level: "none", copies: [] },
    local: false,
    warnings: [`${message} Your collection could not be checked for duplicates.`],
    failures: [{ provider: "strawby", status: 0 }],
  };
}

export function ScanFlow({
  mode = "add",
  series,
  onSaved,
  onEditFully,
  onOpen,
  onAdding,
}: {
  /** check: answer "do I own this?" first and save nothing unless asked. */
  mode?: "add" | "check";
  series: OwnedSeries[];
  /** Refresh the shelf after a save; the scanner stays open for the next book. */
  onSaved: () => Promise<void>;
  onEditFully: (seed: Partial<ItemInput>) => void;
  onOpen?: (seriesId: string) => void;
  /** Check mode: true while a checked book is being added (the review form shows). */
  onAdding?: (adding: boolean) => void;
}) {
  const [stage, setStage] = useState<Stage>({ name: "camera" });
  const adding = mode === "check" && stage.name === "review";
  useEffect(() => onAdding?.(adding), [adding, onAdding]);
  const [problem, setProblem] = useState("");
  const [hint, setHint] = useState("");
  const [typed, setTyped] = useState("");
  const [lookupError, setLookupError] = useState<{ code: string; source: ScanLookupRequest["source"]; message: string } | null>(null);
  const reviews = useRef(0);
  const photo = useRef<HTMLInputElement>(null);

  async function lookup(code: string, source: ScanLookupRequest["source"], retry = false) {
    setProblem("");
    setHint("");
    setLookupError(null);
    setStage({ name: "looking", code });
    try {
      // A check in a store with weak signal falls back to the saved shelf rather than waiting.
      const data = await request<unknown>("/api/scan/isbn", "POST", { code, source, retry }, mode === "check" ? 10_000 : undefined);
      const parsed = scanLookupResultSchema.safeParse(data);
      if (!parsed.success) throw new Error("The lookup returned an unexpected response.");
      setStage(
        mode === "check"
          ? { name: "answer", result: parsed.data }
          : { name: "review", result: parsed.data, key: ++reviews.current },
      );
    } catch (error) {
      // With no connection (or one too weak to reach the server), a check can
      // still be answered from the saved shelf.
      const offline = mode === "check" && (error instanceof NetworkError || !navigator.onLine) ? offlineLookup(code, series) : null;
      if (offline) {
        setStage({ name: "answer", result: offline });
        return;
      }
      setLookupError({
        code,
        source,
        message: navigator.onLine ? (error as Error).message : "You’re offline. Reconnect to look up this ISBN.",
      });
      setStage({ name: "idle" });
    }
  }
  async function readPhoto(file: File | undefined) {
    if (!file) return;
    setProblem("");
    setHint("Reading the photo on this device…");
    try {
      const picked = pickIsbn(await detectInFile(file, await loadDetector()));
      setHint("");
      if (!picked) setProblem("No barcode was found in that photo. Fill the frame with the barcode, keep it sharp and avoid glare.");
      else if (!picked.ok) setProblem(picked.message);
      else await lookup(picked.isbn13, "photo");
    } catch {
      setHint("");
      setProblem("That photo could not be read. Try another photo or type the ISBN.");
    } finally {
      if (photo.current) photo.current.value = "";
    }
  }
  function submitTyped(event: FormEvent) {
    event.preventDefault();
    const parsed = parseIsbn(typed);
    if (!parsed.ok) {
      setProblem(parsed.message);
      return;
    }
    setTyped("");
    void lookup(parsed.isbn13, "manual");
  }

  const fallbacks = (
    <div className="scan-fallbacks">
      <label className="button scan-photo">
        <ImageUp size={16} aria-hidden="true" />
        Use a photo
        <input
          ref={photo}
          type="file"
          accept="image/*"
          className="sr-only"
          aria-label="Photo of a barcode"
          onChange={(event) => void readPhoto(event.target.files?.[0])}
        />
      </label>
      <form className="scan-type" onSubmit={submitTyped}>
        <label className="filter-field">
          <span className="field-label">
            <Keyboard size={15} aria-hidden="true" /> Type an ISBN
          </span>
          <span className="scan-type-row">
            <input
              value={typed}
              onChange={(event) => setTyped(event.target.value)}
              placeholder="978…"
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
              enterKeyHint="search"
              maxLength={20}
              aria-label="ISBN"
            />
            <button type="submit" className="button" disabled={!typed.trim()}>
              Look up
            </button>
          </span>
        </label>
      </form>
      <p className="field-help">Barcodes and photos are read on this device. Only the ISBN number is sent for lookup; photos are never uploaded.</p>
    </div>
  );

  if (stage.name === "answer")
    return (
      <OwnershipCheck
        result={stage.result}
        series={series}
        onRescan={() => setStage({ name: "camera" })}
        onAdd={() => setStage({ name: "review", result: stage.result, key: ++reviews.current })}
        onOpen={(id) => onOpen?.(id)}
      />
    );
  if (stage.name === "review")
    return (
      <ScanReview
        key={stage.key}
        result={stage.result}
        series={series}
        onRescan={() => setStage({ name: "camera" })}
        onEditFully={onEditFully}
        onSaved={async (saved) => {
          setStage({ name: "saved", title: saved.title, volume: saved.volume });
          await onSaved().catch(() => setProblem("Saved. Reload the page to see it on the shelf."));
        }}
      />
    );
  return (
    <div className="scan-flow">
      {stage.name === "saved" && (
        <div className="scan-saved" role="status">
          <CircleCheck size={22} aria-hidden="true" />
          <p>
            <strong>Added {stage.title}{stage.volume ? `, volume ${stage.volume}` : ""}.</strong> Scan the next book, or close when you’re done.
          </p>
        </div>
      )}
      {stage.name === "camera" ? (
        <>
        <BarcodeScanner
          onCode={(code) => void lookup(code, "camera")}
          onHint={(message) => setHint((current) => (current === message ? current : message))}
          onProblem={(reason: CameraProblem) => {
            setProblem(cameraMessages[reason]);
            setStage({ name: "idle" });
          }}
        />
        <button type="button" className="text-button scan-stop" onClick={() => { setHint(""); setStage({ name: "idle" }); }}>
          Stop camera
        </button>
        </>
      ) : stage.name === "looking" ? (
        <div className="scanner scanner-idle" aria-busy="true">
          <p className="scanner-status" role="status">
            Looking up {stage.code}…
          </p>
        </div>
      ) : (
        <div className="scanner scanner-idle">
          <button type="button" className="button button-primary" onClick={() => { setProblem(""); setStage({ name: "camera" }); }}>
            {stage.name === "saved" ? <ScanBarcode size={16} aria-hidden="true" /> : <Camera size={16} aria-hidden="true" />}
            {stage.name === "saved" ? (mode === "check" ? "Check next book" : "Scan next book") : "Open camera"}
          </button>
        </div>
      )}
      {hint && !problem && (
        <p className="scan-hint" role="status">
          {hint}
        </p>
      )}
      {problem && (
        <p className="form-error" role="alert">
          {problem}
        </p>
      )}
      {lookupError && (
        <div className="form-error" role="alert">
          <p>{lookupError.message}</p>
          <div className="form-actions">
            <button type="button" className="button" onClick={() => void lookup(lookupError.code, lookupError.source, true)}>
              <RotateCcw size={15} aria-hidden="true" /> Retry lookup
            </button>
            {offlineResult(lookupError.code, lookupError.message) && (
              <button
                type="button"
                className="text-button"
                onClick={() => {
                  const result = offlineResult(lookupError.code, "The lookup service was unavailable.");
                  setLookupError(null);
                  if (result) setStage({ name: "review", result, key: ++reviews.current });
                }}
              >
                Enter details by hand
              </button>
            )}
          </div>
        </div>
      )}
      {fallbacks}
    </div>
  );
}
