import { useEffect, useRef, useState } from "react";
import { Flashlight, FlashlightOff } from "lucide-react";
import { enhanceContrast, loadDetector, pickCode, pickIsbn } from "./detector.ts";
import type { Detector } from "./detector.ts";
import { cameraProblem } from "./camera.ts";
import type { CameraProblem } from "./camera.ts";

// Rear camera at a resolution that keeps 13-digit bars several pixels wide.
const constraints: MediaStreamConstraints = {
  audio: false,
  video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } },
};
const INTERVAL = 120;

/**
 * Live viewfinder. A code is accepted after two identical consecutive reads,
 * which filters partial-frame misreads without slowing a steady hand.
 */
/** A held book is reported once; it must leave the frame this long to count again. */
const REPEAT_AFTER_MS = 2500;

export function BarcodeScanner({
  onCode,
  onProblem,
  onHint,
  continuous = false,
  accept = "isbn",
}: {
  /** An ISBN-13, or with accept "any" a CD barcode as a 13-digit GTIN. */
  onCode: (code: string) => void;
  onProblem: (problem: CameraProblem) => void;
  onHint: (message: string) => void;
  /** Keep the camera running after each code (scanning a stack of books). */
  continuous?: boolean;
  /** "any" also reads CD barcodes; "isbn" explains that they aren't books. */
  accept?: "isbn" | "any";
}) {
  const video = useRef<HTMLVideoElement>(null);
  const [ready, setReady] = useState(false);
  const [torch, setTorch] = useState<boolean | null>(null);
  const callbacks = useRef({ onCode, onProblem, onHint });
  callbacks.current = { onCode, onProblem, onHint };
  const track = useRef<MediaStreamTrack | null>(null);

  useEffect(() => {
    let stream: MediaStream | null = null;
    let detector: Detector | null = null;
    let timer = 0;
    let stopped = false;
    let last = "";
    let reported = "";
    let reportedSeenAt = 0;
    let frame = 0;
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d", { willReadFrequently: true })!;
    const stop = () => {
      window.clearTimeout(timer);
      stream?.getTracks().forEach((entry) => entry.stop());
      stream = null;
      track.current = null;
      if (video.current) video.current.srcObject = null;
    };
    const tick = async () => {
      const element = video.current;
      if (stopped || !detector || !element || element.readyState < 2 || !element.videoWidth) {
        timer = window.setTimeout(tick, INTERVAL);
        return;
      }
      // Decode the band under the reticle: less work and fewer stray codes.
      const width = element.videoWidth, height = element.videoHeight;
      const cropWidth = Math.round(width * 0.9), cropHeight = Math.round(height * 0.5);
      const scale = Math.min(1, 1280 / cropWidth);
      canvas.width = Math.round(cropWidth * scale);
      canvas.height = Math.round(cropHeight * scale);
      context.drawImage(element, (width - cropWidth) / 2, (height - cropHeight) / 2, cropWidth, cropHeight, 0, 0, canvas.width, canvas.height);
      try {
        // Alternate frames get a contrast-stretched pass for dim labels.
        const results = await detector.detect(++frame % 2 ? canvas : enhanceContrast(canvas));
        let code: string | null = null, message = "";
        if (accept === "any") {
          const picked = pickCode(results);
          if (picked?.kind === "problem") message = picked.message;
          else if (picked) code = picked.code;
        } else {
          const picked = pickIsbn(results);
          if (picked?.ok) code = picked.isbn13;
          else if (picked) message = picked.message;
        }
        if (code) {
          if (continuous && code === reported && Date.now() - reportedSeenAt < REPEAT_AFTER_MS) {
            reportedSeenAt = Date.now();
          } else if (code === last) {
            navigator.vibrate?.(40);
            if (!continuous) {
              stopped = true;
              stop();
              callbacks.current.onCode(code);
              return;
            }
            reported = code;
            reportedSeenAt = Date.now();
            last = "";
            callbacks.current.onCode(code);
          } else last = code;
        } else if (message) {
          last = "";
          callbacks.current.onHint(message);
        }
      } catch {
        /* A failed frame is skipped; the next frame is tried. */
      }
      if (!stopped) timer = window.setTimeout(tick, INTERVAL);
    };
    const start = async () => {
      if (!window.isSecureContext) return callbacks.current.onProblem("insecure");
      if (!navigator.mediaDevices?.getUserMedia) return callbacks.current.onProblem("unsupported");
      try {
        // Request the camera and the reader together; both are needed.
        const [media, reader] = await Promise.all([
          navigator.mediaDevices.getUserMedia(constraints).catch((error: unknown) => {
            // Some Android devices reject the size hints; retry with any camera.
            if (error instanceof Error && error.name === "OverconstrainedError")
              return navigator.mediaDevices.getUserMedia({ audio: false, video: true });
            throw error;
          }),
          loadDetector().catch(() => {
            throw new Error("reader");
          }),
        ]);
        if (stopped) {
          media.getTracks().forEach((entry) => entry.stop());
          return;
        }
        stream = media;
        detector = reader;
        const [videoTrack] = media.getVideoTracks();
        track.current = videoTrack ?? null;
        const capabilities = (videoTrack?.getCapabilities?.() ?? {}) as MediaTrackCapabilities & { torch?: boolean; focusMode?: string[] };
        if (capabilities.focusMode?.includes("continuous"))
          void videoTrack!.applyConstraints({ advanced: [{ focusMode: "continuous" } as MediaTrackConstraintSet] }).catch(() => undefined);
        setTorch(capabilities.torch ? false : null);
        const element = video.current!;
        element.srcObject = media;
        await element.play().catch(() => undefined);
        setReady(true);
        timer = window.setTimeout(tick, INTERVAL);
      } catch (error) {
        stop();
        if (!stopped) callbacks.current.onProblem(error instanceof Error && error.message === "reader" ? "reader" : cameraProblem(error));
      }
    };
    // iOS suspends a backgrounded camera; release it and reopen on return.
    const visibility = () => {
      if (document.hidden) {
        stop();
        setReady(false);
      } else if (!stopped && !stream) void start();
    };
    document.addEventListener("visibilitychange", visibility);
    void start();
    return () => {
      stopped = true;
      document.removeEventListener("visibilitychange", visibility);
      stop();
    };
  }, []);

  async function toggleTorch() {
    const next = !torch;
    try {
      await track.current?.applyConstraints({ advanced: [{ torch: next } as MediaTrackConstraintSet] });
      setTorch(next);
    } catch {
      setTorch(null);
    }
  }

  return (
    <div className="scanner" data-ready={ready}>
      <video ref={video} className="scanner-video" playsInline muted autoPlay aria-hidden="true" />
      <div className="scanner-reticle" aria-hidden="true">
        <span className="scanner-line" />
      </div>
      <p className="scanner-status" role="status">
        {ready ? "Hold the barcode inside the frame" : "Starting the camera…"}
      </p>
      {torch !== null && (
        <button type="button" className="scanner-torch" aria-pressed={torch} onClick={() => void toggleTorch()}>
          {torch ? <FlashlightOff size={18} /> : <Flashlight size={18} />}
          <span>{torch ? "Light off" : "Light"}</span>
        </button>
      )}
    </div>
  );
}
