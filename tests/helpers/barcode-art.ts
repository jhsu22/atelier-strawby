// Browser-side synthetic barcode photographs for the decoder benchmark and the
// fake camera. The EAN-13/EAN-5 encoder is written here from the GS1 tables so
// the image generator shares no code with the ZXing or native decoders.
// Installed with page.addInitScript(installBarcodeArt); runs in the page.

export const VARIANTS = [
  "clean",
  "far",
  "tilted-8deg",
  "portrait-90deg",
  "upside-down",
  "skewed",
  "blur-1.5px",
  "low-contrast-noise",
  "glare",
  "busy-cover",
  "jp-two-barcodes",
  "ean5-addon",
  "blur-3px",
] as const;
export type Variant = (typeof VARIANTS)[number];

export function installBarcodeArt() {
  const L = ["0001101", "0011001", "0010011", "0111101", "0100011", "0110001", "0101111", "0111011", "0110111", "0001011"];
  const R = L.map((p) => [...p].map((b) => (b === "0" ? "1" : "0")).join(""));
  const G = R.map((p) => [...p].reverse().join(""));
  const parity13 = ["LLLLLL", "LLGLGG", "LLGGLG", "LLGGGL", "LGLLGG", "LGGLLG", "LGGGLL", "LGLGLG", "LGLGGL", "LGGLGL"];
  const parity5 = ["GGLLL", "GLGLL", "GLLGL", "GLLLG", "LGGLL", "LLGGL", "LLLGG", "LGLGL", "LGLLG", "LLGLG"];
  function ean13(code: string) {
    const d = [...code].map(Number);
    let bits = "101";
    for (let i = 1; i <= 6; i++) bits += (parity13[d[0]!]![i - 1] === "L" ? L : G)[d[i]!];
    bits += "01010";
    for (let i = 7; i <= 12; i++) bits += R[d[i]!];
    return bits + "101";
  }
  function ean5(code: string) {
    const d = [...code].map(Number);
    const check = (3 * (d[0]! + d[2]! + d[4]!) + 9 * (d[1]! + d[3]!)) % 10;
    let bits = "1011";
    d.forEach((digit, i) => {
      bits += (parity5[check]![i] === "L" ? L : G)[digit] + (i < 4 ? "01" : "");
    });
    return bits;
  }
  function bars(ctx: CanvasRenderingContext2D, bits: string, x: number, y: number, module: number, height: number, ink: string) {
    ctx.fillStyle = ink;
    for (let i = 0; i < bits.length; i++) if (bits[i] === "1") ctx.fillRect(x + i * module, y, module, height);
  }
  /** Draw a barcode label as it might appear on a book, then distort it. */
  function draw(canvas: HTMLCanvasElement, isbn: string, variant: string, seed = 1) {
    let state = seed;
    const random = () => ((state = (state * 16807) % 2147483647) / 2147483647);
    const width = 1280, height = 960;
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d")!;
    ctx.save();
    ctx.fillStyle = variant === "busy-cover" ? "#2b3a67" : "#f4efe6";
    ctx.fillRect(0, 0, width, height);
    if (variant === "busy-cover")
      for (let i = 0; i < 60; i++) {
        ctx.fillStyle = `hsl(${Math.floor(random() * 360)} 70% ${30 + random() * 40}%)`;
        ctx.fillRect(random() * width, random() * height, 40 + random() * 300, 20 + random() * 200);
        ctx.font = `${20 + random() * 50}px serif`;
        ctx.fillText("STRAWBY", random() * width, random() * height);
      }
    const module = variant === "far" ? 1.6 : 3.2;
    const symbol = ean13(isbn);
    const symbolWidth = (symbol.length + 22) * module;
    const addon = variant === "ean5-addon" ? ean5("51099") : "";
    const labelWidth = symbolWidth + (addon ? (addon.length + 12) * module : 0);
    const barHeight = module * 26;
    const labelHeight = barHeight * (variant === "jp-two-barcodes" ? 2.3 : 1) + module * 16;
    ctx.translate(width / 2, height / 2);
    if (variant === "tilted-8deg") ctx.rotate((8 * Math.PI) / 180);
    if (variant === "portrait-90deg") ctx.rotate(Math.PI / 2);
    if (variant === "upside-down") ctx.rotate(Math.PI);
    if (variant === "skewed") ctx.transform(1, 0.12, 0.28, 1, 0, 0);
    ctx.translate(-labelWidth / 2, -labelHeight / 2);
    const paper = variant === "low-contrast-noise" ? "#c4c0b8" : "#ffffff";
    const ink = variant === "low-contrast-noise" ? "#6b665e" : "#111111";
    ctx.fillStyle = paper;
    ctx.fillRect(0, 0, labelWidth, labelHeight);
    if (variant === "blur-1.5px") ctx.filter = "blur(1.5px)";
    if (variant === "blur-3px") ctx.filter = "blur(3px)";
    const left = 11 * module, top = module * 4;
    ctx.font = `${module * 4}px monospace`;
    ctx.fillStyle = ink;
    ctx.fillText(`ISBN${isbn.slice(0, 3)}-${isbn.slice(3)}`, left, top + module * 2);
    bars(ctx, symbol, left, top + module * 4, module, barHeight, ink);
    if (addon) bars(ctx, addon, left + (symbol.length + 9) * module, top + module * 8, module, barHeight - module * 4, ink);
    if (variant === "jp-two-barcodes") {
      // Second row: the 192 price/classification code printed under the ISBN.
      bars(ctx, ean13("1920979005006"), left, top + module * 8 + barHeight * 1.15, module, barHeight, ink);
    }
    ctx.filter = "none";
    ctx.restore();
    if (variant === "low-contrast-noise") {
      const image = ctx.getImageData(0, 0, width, height);
      for (let i = 0; i < image.data.length; i += 4) {
        const n = (random() - 0.5) * 70;
        image.data[i] = Math.max(0, Math.min(255, image.data[i]! + n));
        image.data[i + 1] = Math.max(0, Math.min(255, image.data[i + 1]! + n));
        image.data[i + 2] = Math.max(0, Math.min(255, image.data[i + 2]! + n));
      }
      ctx.putImageData(image, 0, 0);
    }
    if (variant === "glare") {
      const glare = ctx.createRadialGradient(width * 0.56, height * 0.47, 10, width * 0.56, height * 0.47, 160);
      glare.addColorStop(0, "rgba(255,255,255,0.92)");
      glare.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = glare;
      ctx.fillRect(0, 0, width, height);
    }
  }
  const art = { draw, ean13, ean5 };
  (window as unknown as { __barcodeArt: typeof art }).__barcodeArt = art;
}

/**
 * Replace getUserMedia with a stream of a page canvas, or a scripted failure.
 * The canvas is window.__fakeCamera; tests draw barcodes onto it.
 */
export function installFakeCamera(mode: { fail?: string; insecure?: boolean; noMediaDevices?: boolean }) {
  if (mode.insecure) Object.defineProperty(window, "isSecureContext", { get: () => false });
  if (mode.noMediaDevices) {
    Object.defineProperty(navigator, "mediaDevices", { get: () => undefined });
    return;
  }
  const canvas = document.createElement("canvas");
  canvas.width = 1280;
  canvas.height = 960;
  (window as unknown as { __fakeCamera: HTMLCanvasElement }).__fakeCamera = canvas;
  const calls: MediaStreamConstraints[] = [];
  (window as unknown as { __cameraCalls: MediaStreamConstraints[] }).__cameraCalls = calls;
  const getUserMedia = async (constraints: MediaStreamConstraints) => {
    calls.push(constraints);
    if (mode.fail) throw new DOMException("Synthetic camera failure", mode.fail);
    // Keep frames flowing; captureStream only emits on canvas changes.
    const context = canvas.getContext("2d")!;
    const tick = () => {
      context.fillStyle = "rgba(0,0,0,0.002)";
      context.fillRect(0, 0, 1, 1);
      requestAnimationFrame(tick);
    };
    tick();
    return canvas.captureStream(30);
  };
  Object.defineProperty(navigator, "mediaDevices", {
    get: () => ({ getUserMedia, enumerateDevices: async () => [] }),
  });
}
