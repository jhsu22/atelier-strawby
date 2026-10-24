import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

async function open(page: Page) {
  await page.goto("/");
  await expect(page.locator("[data-hydrated=true]")).toBeVisible();
  await page.getByRole("button", {name: "Open Girls' Last Tour", exact: true}).click();
  await expect(page.getByRole("region", {name: "Released and missing volumes"})).toBeVisible();
}
const catalog = (run: string, partial = false) => ({
  editionRunId: run, query: "Girls' Last Tour", provider: "googlebooks", checkedAt: "2026-10-24T00:00:00Z", scanned: 8, excluded: 1,
  nextOffset: partial ? 40 : null, warnings: [], volumes: (partial ? [1,2,3] : [1,2,3,4,5,6]).map(number => ({number, title: `Girls' Last Tour Vol. ${number}`, sourceUrl: `https://books.google.com/books?id=test${number}`, publishedOn: "2024-01-01", datePrecision: "day", provider: "googlebooks", digital: number === 5})),
});

test("series details lookup released volumes, show edition-specific missing numbers and restore saved evidence", async ({page}) => {
  let saved: ReturnType<typeof catalog> | null = null;
  const requests: Record<string, unknown>[] = [];
  await page.route("**/api/releases**", async route => {
    if (route.request().method() === "GET") {
      await route.fulfill({json: {catalog: saved}}); return;
    }
    const body = route.request().postDataJSON(); requests.push(body);
    saved = catalog(body.editionRunId, !body.continuation);
    await route.fulfill({json: {catalog: saved}});
  });
  await open(page);
  const panel = page.getByRole("region", {name: "Released and missing volumes"});
  await expect(panel).toContainText("No lookup saved yet");
  await expect(panel.getByRole("combobox", {name: "Release catalog source", exact: true})).toHaveValue("auto");
  await panel.getByRole("button", {name: "Search released volumes", exact: true}).click();
  await expect(panel).toContainText("these counts are partial");
  await expect(panel.locator(".missing-release-list li")).toHaveCount(2);
  await panel.getByRole("button", {name: "Load more catalog results", exact: true}).click();
  await expect(panel.locator(".missing-release-list a")).toHaveText([/Vol. 2/, /Vol. 3/, /Vol. 4/, /Vol. 5/]);
  await expect(panel.locator(".release-totals strong")).toHaveText(["6", "2", "4"]);
  await expect(panel).toContainText("Digital listing");
  await expect(panel.getByRole("button", {name: "Load more catalog results", exact: true})).toHaveCount(0);
  expect(requests).toHaveLength(2); expect(requests[1]!.continuation).toBe(true);
  await page.reload();
  await expect(page.locator("[data-hydrated=true]")).toBeVisible();
  await expect(panel.locator(".release-totals strong")).toHaveText(["6", "2", "4"]);
  await page.route("**/api/releases", route => route.fulfill({status: 503, json: {error: "Catalog temporarily unavailable"}}));
  await panel.getByRole("button", {name: "Search released volumes", exact: true}).click();
  await expect(panel.getByRole("alert")).toContainText("temporarily unavailable");
  await expect(panel.locator(".missing-release-list li")).toHaveCount(4);
});

test("released-volume panel handles incompatible metadata, alternate editions, mobile layout and accessibility", async ({page}, info) => {
  await page.route("**/api/releases**", async route => {
    const url = new URL(route.request().url());
    await route.fulfill({json: {catalog: catalog(url.searchParams.get("editionRunId") ?? "")}});
  });
  await open(page);
  for (const width of info.project.name === "mobile" ? [320,390] : [768,1440]) {
    await page.setViewportSize({width, height: 1000});
    expect(await page.getByRole("dialog").evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
  }
  await page.locator(".released-volumes").scrollIntoViewIfNeeded();
  for (const theme of ["light", "dark"]) {
    await page.evaluate(theme => document.documentElement.dataset.theme = theme, theme);
    // Theme colors transition; audit the settled state, not an intermediate frame.
    await page.evaluate(() => Promise.allSettled(document.getAnimations().map(animation => animation.finished)));
    const audit = await new AxeBuilder({page}).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
    expect(audit.violations).toEqual([]);
    await page.screenshot({path: `data/generated/releases-${info.project.name}-${theme}.png`});
  }
  await page.keyboard.press("Escape");
  await page.getByRole("button", {name: "Open Steins;Gate", exact: true}).click();
  const panel = page.getByRole("region", {name: "Released and missing volumes"});
  await expect(panel).toContainText("needs confirmation");
  await expect(panel.getByRole("button", {name: "Search released volumes", exact: true})).toHaveCount(0);
  await page.keyboard.press("Escape");
  await page.getByRole("button", {name: "Open A Sign of Affection", exact: true}).click();
  await expect(panel.getByRole("combobox", {name: "Release edition", exact: true}).locator("option")).toHaveCount(3);
});
