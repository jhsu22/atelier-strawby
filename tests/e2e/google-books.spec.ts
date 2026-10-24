import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

test("Google Books is a third source with setup guidance, attribution and reviewable metadata application", async ({page}, info) => {
  await page.goto("/");
  await expect(page.locator("[data-hydrated=true]")).toBeVisible();
  await page.getByRole("button", {name: info.project.name === "mobile" ? "Add" : "Add to collection", exact: true}).click();
  await page.getByRole("combobox", {name: "Copy media type", exact: true}).selectOption("book");
  await page.getByRole("textbox", {name: "Title", exact: true}).fill("Synthetic book lookup");
  await page.getByRole("textbox", {name: "Notes", exact: true}).fill("Keep my acquisition memory");
  await page.getByLabel("Acquisition date", {exact: true}).fill("2024-02-29");
  await page.getByText("Find metadata & artwork", {exact: true}).click();
  await page.getByRole("combobox", {name: "Metadata source", exact: true}).selectOption("googlebooks");
  await expect(page.getByRole("button", {name: "Search Books", exact: true})).toBeVisible();
  let calls = 0;
  await page.route("**/api/metadata", async route => {
    expect(route.request().postDataJSON().provider).toBe("googlebooks");
    expect(route.request().postDataJSON()).not.toHaveProperty("googleBooksKey");
    calls++;
    await route.fulfill({status: 200, contentType: "application/json", body: JSON.stringify(calls === 1 ? {
      candidates: [], warnings: ["Google Books is not configured. Add GOOGLE_BOOKS_API_KEY to the server's .dev.vars, then restart the app."], failures: [422],
    } : {candidates: [
      {id: "synthetic", provider: "googlebooks", title: "Synthetic book lookup", subtitle: "Synthetic author · Test publisher", sourceUrl: "https://books.google.com/books?id=synthetic", detail: false, applicable: true, warning: "Physical edition needs review.", patch: {authors: ["Synthetic author"], publisher: "Test publisher"}},
      {id: "mismatch", provider: "googlebooks", title: "Different book", subtitle: "Other author", sourceUrl: "https://books.google.com/books?id=mismatch", detail: false, applicable: false, warning: "Does not match the requested book.", patch: {}},
    ], warnings: []})});
  });
  await page.getByRole("button", {name: "Search Books", exact: true}).click();
  await expect(page.locator(".metadata-results")).toContainText("GOOGLE_BOOKS_API_KEY");
  await page.getByRole("button", {name: "Search Books again", exact: true}).click();
  await expect(page.getByText("Google Books search results", {exact: true})).toBeVisible();
  await expect(page.getByRole("link", {name: "View on Google Books"})).toHaveCount(2);
  await expect(page.locator(".metadata-results").getByAltText("Google", {exact: true})).toBeVisible();
  const mismatch = page.locator(".metadata-results article").filter({hasText: "Different book"});
  await expect(mismatch.getByRole("button", {name: "Use these details"})).toBeDisabled();
  const audit = await new AxeBuilder({page}).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
  expect(audit.violations).toEqual([]);
  await page.locator(".metadata-results article").filter({hasText: "Synthetic book lookup"}).getByRole("button", {name: "Use these details"}).click();
  await expect(page.getByRole("textbox", {name: "Authors", exact: true})).toHaveValue("Synthetic author");
  await expect(page.getByRole("textbox", {name: "Publisher", exact: true})).toHaveValue("Test publisher");
  await expect(page.getByRole("textbox", {name: "Notes", exact: true})).toHaveValue("Keep my acquisition memory");
  await expect(page.getByLabel("Acquisition date", {exact: true})).toHaveValue("2024-02-29");
  await page.getByRole("button", {name: "Cancel", exact: true}).click();
});
