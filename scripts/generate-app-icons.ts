// Renders the installable-app icons from the brand mark (public/favicon.svg)
// in its light colours on the paper background. Run after changing the mark:
//   node scripts/generate-app-icons.ts
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { chromium } from "@playwright/test";

const svg = await readFile("public/favicon.svg", "utf8");
const icons = [
  // "any" icons may be shown unmasked; maskable ones keep the mark inside the 80% safe zone.
  { file: "public/icons/icon-192.png", size: 192, mark: 0.78 },
  { file: "public/icons/icon-512.png", size: 512, mark: 0.78 },
  { file: "public/icons/icon-maskable-512.png", size: 512, mark: 0.58 },
  { file: "public/icons/apple-touch-icon.png", size: 180, mark: 0.72 },
];
const browser = await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ?? (existsSync("/usr/bin/chromium") ? "/usr/bin/chromium" : undefined),
});
try {
  const page = await browser.newPage({ colorScheme: "light" });
  for (const { file, size, mark } of icons) {
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(
      `<body style="margin:0;width:${size}px;height:${size}px;display:grid;place-items:center;background:#faf8f5">` +
        `<div style="width:${Math.round(size * mark)}px;height:${Math.round(size * mark)}px">${svg.replace("<svg ", '<svg width="100%" height="100%" ')}</div></body>`,
    );
    await page.screenshot({ path: file, omitBackground: false });
    console.log(`Wrote ${file}`);
  }
} finally {
  await browser.close();
}
