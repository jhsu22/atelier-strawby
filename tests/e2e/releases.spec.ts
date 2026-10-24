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
  await expect(panel.getByRole("button", {name: "Find missing volumes", exact: true})).toBeVisible();
  await expect(panel.getByRole("combobox", {name: "Release catalog source", exact: true})).not.toBeVisible();
  await panel.getByText("Options & sources", {exact: true}).click();
  await expect(panel.getByRole("combobox", {name: "Release catalog source", exact: true})).toHaveValue("auto");
  await panel.getByText("Options & sources", {exact: true}).click();
  await panel.getByRole("button", {name: "Find missing volumes", exact: true}).click();
  await expect(panel).toContainText("Partial results");
  await expect(panel.locator(".missing-release-list li")).toHaveCount(2);
  await panel.getByRole("button", {name: "Check more releases", exact: true}).click();
  await expect(panel.locator(".missing-release-list a")).toHaveText([/Vol. 2/, /Vol. 3/, /Vol. 4/, /Vol. 5/]);
  await expect(panel.locator(".release-count")).toHaveText("4");
  await expect(panel).toContainText("Digital listing");
  await expect(panel.getByRole("button", {name: "Check more releases", exact: true})).toHaveCount(0);
  await panel.getByText("Options & sources", {exact: true}).click();
  await expect(panel.locator(".release-query")).toContainText("6 releases found · 2 owned");
  await expect(panel.locator(".release-evidence li")).toHaveCount(6);
  expect(requests).toHaveLength(2); expect(requests[1]!.continuation).toBe(true);
  await page.reload();
  await expect(page.locator("[data-hydrated=true]")).toBeVisible();
  await expect(panel.locator(".release-count")).toHaveText("4");
  await expect(panel.getByRole("combobox", {name: "Release catalog source", exact: true})).not.toBeVisible();
  await page.route("**/api/releases", route => route.fulfill({status: 503, json: {error: "Catalog temporarily unavailable"}}));
  await panel.getByRole("button", {name: "Refresh", exact: true}).click();
  await expect(panel.getByRole("alert")).toContainText("temporarily unavailable");
  await expect(panel.locator(".missing-release-list li")).toHaveCount(4);
});

test("released-volume panel handles incompatible metadata, alternate editions, mobile layout and accessibility", async ({page}, info) => {
  await page.route("**/api/releases**", async route => {
    const url = new URL(route.request().url());
    await route.fulfill({json: {catalog: catalog(url.searchParams.get("editionRunId") ?? "")}});
  });
  await open(page);
  await expect(page.locator(".release-count")).toHaveText("4");
  for (const width of info.project.name === "mobile" ? [320,390] : [768,1440]) {
    await page.setViewportSize({width, height: 1000});
    expect(await page.getByRole("dialog").evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
    expect(await page.locator(".released-volumes").evaluate(element => element.getBoundingClientRect().height)).toBeLessThan(330);
  }
  await page.locator(".released-volumes").scrollIntoViewIfNeeded();
  for (const theme of ["light", "dark"]) {
    await page.evaluate(theme => document.documentElement.dataset.theme = theme, theme);
    // Settle theme transitions, including fields inside the collapsed options.
    await page.evaluate(() => {
      for (const animation of document.getAnimations()) {
        if (animation instanceof CSSTransition) animation.finish();
      }
    });
    const audit = await new AxeBuilder({page}).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
    expect(audit.violations).toEqual([]);
    await page.screenshot({path: `data/generated/releases-${info.project.name}-${theme}.png`});
  }
  await page.keyboard.press("Escape");
  await page.getByRole("button", {name: "Open Steins;Gate", exact: true}).click();
  const panel = page.getByRole("region", {name: "Released and missing volumes"});
  await expect(panel).toContainText("needs confirmation");
  await expect(panel.getByRole("button", {name: "Find missing volumes", exact: true})).toHaveCount(0);
  await page.keyboard.press("Escape");
  await page.getByRole("button", {name: "Open A Sign of Affection", exact: true}).click();
  await panel.getByText("Options & sources", {exact: true}).click();
  await expect(panel.getByRole("combobox", {name: "Release edition", exact: true}).locator("option")).toHaveCount(3);
  const edition = panel.getByRole("combobox", {name: "Release edition", exact: true});
  const otherId = await edition.locator("option").nth(1).getAttribute("value");
  const otherLanguage = (await edition.locator("option").nth(1).innerText()).split(" · ")[0]!;
  const changed = page.waitForRequest(request => request.method() === "GET" && new URL(request.url()).searchParams.get("editionRunId") === otherId);
  await edition.selectOption(otherId!);
  await changed;
  await expect(panel.locator(".release-context")).toContainText(otherLanguage);
});
