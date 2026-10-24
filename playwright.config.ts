import { defineConfig } from "@playwright/test";
import { existsSync } from "node:fs";

// The disposable test server defaults to the dev port; set STRAWBY_TEST_PORT to
// run browser tests while `npm run dev` is using 4321.
const port = process.env.STRAWBY_TEST_PORT ?? "4321";

export default defineConfig({
  testDir: "./tests/e2e",
  outputDir: "data/generated/stage2-playwright",
  timeout: 30_000,
  expect: { timeout: 8_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [
    ["list"],
    ["json", { outputFile: "data/generated/stage2-browser-results.json" }],
  ],
  use: {
    baseURL: process.env.STRAWBY_TEST_URL ?? `http://127.0.0.1:${port}`,
    launchOptions: {
      executablePath:
        process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ??
        (existsSync("/usr/bin/chromium") ? "/usr/bin/chromium" : undefined),
    },
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  projects: [
    { name: "desktop", use: { viewport: { width: 1440, height: 1000 } } },
    {
      name: "mobile",
      use: {
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
      },
    },
  ],
  webServer: process.env.STRAWBY_TEST_URL
    ? undefined
    : {
        command: "node scripts/browser-server.ts",
        url: `http://127.0.0.1:${port}`,
        reuseExistingServer: false,
        timeout: 120_000,
      },
});
