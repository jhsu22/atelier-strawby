import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

async function ready(page: Page, section: "timeline" | "stats") {
  await page.goto(`/?section=${section}`);
  await expect(page.locator("[data-hydrated=true]")).toBeVisible();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.evaluate(() => Promise.all(document.getAnimations().map(animation => animation.finished)));
}
async function noOverflow(page: Page) {
  expect(await page.getByRole("dialog").evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
}

test("timeline uses real dates and notes, combines filters on each copy and returns from detail", async ({ page }) => {
  await ready(page, "timeline");
  await expect(page.locator(".haul-card")).toHaveCount(56);
  await expect(page.locator(".timeline-results").getByRole("status")).toContainText("55 recorded dates · 181 matching copies");
  const first = page.locator('[data-haul-date="2021-09-18"]');
  await expect(first.locator(".haul-memory p")).toHaveText("first manga, at some random vromans");
  await expect(page.locator('[data-haul-date="2021-10-27"] .haul-memory p')).toHaveText("first b&n manga trip");
  await expect(page.locator('[data-haul-date="unknown"] .haul-count')).toContainText("5 manga");
  await page.getByRole("combobox", {name: "Haul year", exact: true}).selectOption("2021");
  await expect(page.locator(".timeline-results").getByRole("status")).toContainText("21 matching copies");
  await page.getByRole("combobox", {name: "Memory tag", exact: true}).selectOption("Gifts from Sammy");
  await expect(page.locator(".timeline-results").getByRole("status")).toContainText("0 matching copies");
  await expect(page.getByText("No acquisitions match these filters.")).toBeVisible();
  await page.getByRole("button", {name: "Reset timeline filters"}).click();
  await page.getByRole("combobox", {name: "Memory tag", exact: true}).selectOption("Gifts from Sammy");
  await expect(page.locator(".timeline-results").getByRole("status")).toContainText("8 matching copies");
  await expect(page.locator(".haul-memory p")).toHaveText(["from sammy c:", "from sammy c:", "from sammy <3"]);
  await page.getByRole("combobox", {name: "Haul media", exact: true}).selectOption("cd");
  await expect(page.locator(".haul-card")).toHaveCount(0);
  await page.getByRole("button", {name: "Reset timeline filters"}).click();
  await page.getByRole("combobox", {name: "Haul year", exact: true}).selectOption("2021");
  await first.locator(".haul-items button").click();
  await expect(page.getByRole("dialog")).toHaveAccessibleName("To Your Eternity");
  await page.reload();
  await expect(page.getByRole("dialog")).toHaveAccessibleName("To Your Eternity");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveAccessibleName("Haul timeline");
  // Without reloading, opening detail keeps the in-session timeline filters.
  await page.getByRole("combobox", {name: "Haul year", exact: true}).selectOption("2021");
  await first.locator(".haul-items button").click();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("combobox", {name: "Haul year", exact: true})).toHaveValue("2021");
  await page.goBack();
  await expect(page.getByRole("dialog")).toHaveAccessibleName("To Your Eternity");
  await page.goBack();
  await expect(page.getByRole("dialog")).toHaveAccessibleName("Haul timeline");
});

test("analytics show reconciled totals, all distributions, counting rules, gaps and detail navigation", async ({ page }) => {
  await ready(page, "stats");
  for (const [metric, value] of [["Physical manga volumes", "177"], ["Unique manga series", "38"], ["CDs", "4"], ["Books (separate)", "0"]]) {
    await expect(page.locator(`[data-metric="${metric}"] strong`)).toHaveText(value!);
  }
  await expect(page.getByRole("region", {name: "Volumes by language"})).toContainText("167");
  await expect(page.getByRole("region", {name: "Manga acquisitions by year"})).toContainText("96");
  await expect(page.getByRole("region", {name: "CD acquisitions by year"})).toContainText("Unknown date");
  await expect(page.locator(".haul-ranking li").first()).toContainText("December 25, 2022");
  await expect(page.locator(".haul-ranking li").first()).toContainText("19 copies");
  await expect(page.locator(".collection-insights")).toContainText("Kodansha");
  await expect(page.locator(".gap-ranking")).toContainText("5–6");
  await page.getByText("How these numbers are counted", {exact: true}).click();
  await expect(page.locator(".counting-rules")).toContainText("163 manga / LN language values are assumed");
  await expect(page.locator(".counting-rules")).toContainText("3 manga / LN records have unconfirmed");
  await page.getByRole("region", {name: "Most collected series"}).getByRole("button", {name: "A Sign of Affection", exact: true}).click();
  await expect(page.getByRole("dialog")).toHaveAccessibleName("A Sign of Affection");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveAccessibleName("Collection stats");
  await page.getByRole("button", {name: "Explore the haul timeline →", exact: true}).click();
  await expect(page.getByRole("dialog")).toHaveAccessibleName("Haul timeline");
});

test("Stage 4 panels fit phones and desktops and pass light/dark accessibility scans", async ({ page }, info) => {
  for (const section of ["timeline", "stats"] as const) {
    await ready(page, section);
    for (const width of info.project.name === "mobile" ? [320, 390, 650] : [768, 1024, 1440]) {
      await page.setViewportSize({width, height: 1000});
      await noOverflow(page);
    }
    await page.setViewportSize(info.project.use.viewport!);
    for (const theme of ["light", "dark"]) {
      await page.evaluate(theme => document.documentElement.dataset.theme = theme, theme);
      const audit = await new AxeBuilder({page}).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
      expect(audit.violations).toEqual([]);
      await page.screenshot({path: `data/generated/stage4-${section}-${info.project.name}-${theme}.png`});
    }
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    expect(new URL(page.url()).searchParams.has("section")).toBe(false);
  }
});

test("a persisted personal CD joins a manga date, filters and opens its album", async ({ page, baseURL }, info) => {
  const title = `Stage4 test-only CD ${info.project.name}`;
  const headers = {Origin: new URL(baseURL!).origin, "X-Strawby-Request": "1"};
  const response = await page.request.post("/api/items", { headers, data: { item: {kind: "cd", title, acquiredOn: "2021-09-18", notes: "test-only mixed-media memory", tagsMode: "manual", tags: ["Test-only convention"]}, requestId: crypto.randomUUID() } });
  expect(response.ok()).toBe(true);
  const saved = await response.json();
  try {
    await ready(page, "timeline");
    const haul = page.locator('[data-haul-date="2021-09-18"]');
    await expect(haul.locator(".haul-count")).toContainText("1 manga / LN · 1 CDs");
    await page.getByRole("combobox", {name: "Haul media", exact: true}).selectOption("cd");
    await page.getByRole("combobox", {name: "Memory tag", exact: true}).selectOption("Test-only convention");
    await expect(page.locator(".haul-card")).toHaveCount(1);
    await haul.locator(".haul-items button").click();
    await expect(page.getByRole("dialog")).toHaveAccessibleName(title);
    await expect(page.getByRole("dialog")).toContainText("test-only mixed-media memory");
    await ready(page, "stats");
    await expect(page.locator('[data-metric="CDs"] strong')).toHaveText("5");
    await expect(page.getByRole("region", {name: "CD acquisitions by year"})).toContainText("2021");
  } finally {
    const current = await page.request.get(`/api/items/${saved.id}`);
    const {version} = await current.json();
    const deleted = await page.request.delete(`/api/items/${saved.id}`, {headers, data: {version, confirmed: true}});
    expect(deleted.ok()).toBe(true);
  }
});
