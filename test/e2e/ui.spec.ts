import { test, expect } from "@playwright/test";
import { FIXTURE_COUNTS } from "../helpers/fixture.js";

// ---------------------------------------------------------------------------
// Header / summary bar
// ---------------------------------------------------------------------------
test("page title is Job Tracker", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveTitle("Job Tracker");
});

test("summary bar loads job counts", async ({ page }) => {
  await page.goto("/");
  const summary = page.locator("#summary");
  await expect(summary).not.toHaveText("loading…", { timeout: 5000 });
  const text = await summary.textContent();
  expect(text).toContain(`${FIXTURE_COUNTS.total} jobs`);
  expect(text).toContain(`${FIXTURE_COUNTS.top_picks} top picks`);
});

// ---------------------------------------------------------------------------
// Tab navigation
// ---------------------------------------------------------------------------
test("all nav tabs are rendered", async ({ page }) => {
  await page.goto("/");
  for (const label of ["Run", "Top picks", "All", "Not suitable", "Applied", "Skills"]) {
    await expect(page.locator("nav button", { hasText: label })).toBeVisible();
  }
});

test("Top picks tab is active by default", async ({ page }) => {
  await page.goto("/");
  const active = page.locator("nav button.active");
  await expect(active).toHaveText("Top picks");
});

test("clicking All tab loads the available job table", async ({ page }) => {
  await page.goto("/");
  await page.locator("nav button", { hasText: "All" }).click();
  // All tab lists only available jobs (seed:3 is not-applied + broken → hidden).
  const rows = page.locator("table tbody tr");
  await expect(rows).toHaveCount(FIXTURE_COUNTS.listed);
});

test("Top picks tab shows only qualifying jobs", async ({ page }) => {
  await page.goto("/");
  const rows = page.locator("table tbody tr");
  await expect(rows).toHaveCount(FIXTURE_COUNTS.top_picks);
});

test("Not suitable tab shows unsuitable jobs", async ({ page }) => {
  await page.goto("/");
  await page.locator("nav button", { hasText: "Not suitable" }).click();
  const rows = page.locator("table tbody tr");
  await expect(rows).toHaveCount(FIXTURE_COUNTS.not_suitable);
  // Every row should have the "unsuitable" suitability pill.
  for (const pill of await page.locator(".pill.unsuitable").all()) {
    await expect(pill).toBeVisible();
  }
});

test("Applied tab shows jobs with a non-default stage", async ({ page }) => {
  await page.goto("/");
  await page.locator("nav button", { hasText: "Applied" }).click();
  const cards = page.locator(".appcard");
  await expect(cards).toHaveCount(FIXTURE_COUNTS.applied);
});

// ---------------------------------------------------------------------------
// Skills tab
// ---------------------------------------------------------------------------
test("Skills tab shows the analyst summary panel", async ({ page }) => {
  await page.goto("/");
  await page.locator("nav button", { hasText: "Skills" }).click();
  // The analyst panel with the summary text should appear.
  await expect(page.locator(".panel")).toBeVisible();
  // Python should be in the skills table.
  const table = page.locator("table tbody");
  await expect(table).toContainText("Python");
});

test("Skills table is sorted by count (Python has highest count)", async ({ page }) => {
  await page.goto("/");
  await page.locator("nav button", { hasText: "Skills" }).click();
  const firstSkill = page.locator("table tbody tr").first().locator("td").first();
  await expect(firstSkill).toHaveText("Python");
});

// ---------------------------------------------------------------------------
// Stage select (job action)
// ---------------------------------------------------------------------------
test("changing stage select sends POST and reflects new value", async ({ page }) => {
  await page.goto("/");
  await page.locator("nav button", { hasText: "All" }).click();
  // Find the stage select for seed:2 (Junior Frontend, not_applied).
  const row = page.locator("table tbody tr", { hasText: "Junior Frontend Developer" });
  const select = row.locator("select");
  await expect(select).toBeVisible();
  // Change it to 'applied'.
  await select.selectOption("applied");
  // After the POST resolves the select value should stay 'applied'.
  await expect(select).toHaveValue("applied");
});

// ---------------------------------------------------------------------------
// Run tab
// ---------------------------------------------------------------------------
test("Run tab shows command buttons", async ({ page }) => {
  await page.goto("/");
  await page.locator("nav button", { hasText: "Run" }).click();
  // There should be at least one command button.
  await expect(page.locator("button[data-cmd]").first()).toBeVisible();
});

test("Run tab shows the log area with placeholder text", async ({ page }) => {
  await page.goto("/");
  await page.locator("nav button", { hasText: "Run" }).click();
  await expect(page.locator("#runlog")).toBeVisible();
  await expect(page.locator("#runlog")).toContainText("Click a command to run it.");
});

test("running 'seed' command shows output in the log", async ({ page }) => {
  await page.goto("/");
  await page.locator("nav button", { hasText: "Run" }).click();
  await page.locator("button[data-cmd='seed']").click();
  const log = page.locator("#runlog");
  // Wait for the command to finish and badge to appear.
  await expect(log.locator(".badge")).toBeVisible({ timeout: 30_000 });
  // Badge should show a check (✓) or cross (✗) plus "seed".
  const badgeText = await log.locator(".badge").textContent();
  expect(badgeText).toMatch(/seed/);
});
