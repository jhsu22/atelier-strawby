// Camera failures, mapped from getUserMedia errors to the recovery the owner can take.
export type CameraProblem = "insecure" | "unsupported" | "denied" | "missing" | "busy" | "reader" | "unknown";
export const cameraMessages: Record<CameraProblem, string> = {
  insecure: "The camera needs a secure (HTTPS) connection. Open the collection at its https:// address, or take a photo instead.",
  unsupported: "This browser cannot open the camera here. Take a photo of the barcode or type the ISBN.",
  denied: "Camera access is blocked. Allow the camera for this site in your browser settings (on iPhone: Settings › Safari › Camera), or take a photo instead.",
  missing: "No camera was found. Take a photo of the barcode or type the ISBN.",
  busy: "The camera is being used by another app. Close it and try again, or take a photo instead.",
  reader: "The barcode reader could not load. Check your connection and try again, or type the ISBN.",
  unknown: "The camera could not start. Try again, or take a photo instead.",
};
export function cameraProblem(error: unknown): CameraProblem {
  const name = error instanceof DOMException || error instanceof Error ? error.name : "";
  if (name === "NotAllowedError" || name === "SecurityError") return "denied";
  if (name === "NotFoundError" || name === "OverconstrainedError") return "missing";
  if (name === "NotReadableError" || name === "AbortError") return "busy";
  return "unknown";
}
