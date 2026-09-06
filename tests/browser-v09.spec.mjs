import { expect, test } from "@playwright/test";

const baseURL = process.env.BLUEWOLF_BASE_URL ?? "http://127.0.0.1:3000";

function collectRuntimeFailures(page) {
  const failures = [];
  page.on("pageerror", (error) => failures.push(`pageerror: ${error.message}`));
  page.on("console", (message) => { if (message.type() === "error") failures.push(`console: ${message.text()}`); });
  return failures;
}

test("desktop v0.9 live geometry, traces, base map and cropped timeline", async ({ page }) => {
  const failures = collectRuntimeFailures(page);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(baseURL, { waitUntil: "networkidle" });
  await expect(page.getByRole("heading", { name: "תמונה מבצעית" })).toBeVisible();
  await expect(page.locator(".v09-live-map")).toBeVisible();

  await expect(page.locator(".v09-map-select select")).toBeVisible();
  await expect(page.locator(".v09-overlay-bar button", { hasText: "מפת הנדסה" })).toHaveCount(0);

  expect(await page.locator(".v09-trace-dots circle").count()).toBeGreaterThan(20);
  await page.locator(".v09-overlay-bar button", { hasText: "עקבה לפי ציון" }).click();
  await expect(page.locator(".v09-score-legend")).toBeVisible();
  expect(await page.locator(".v09-score-trace circle").count()).toBeGreaterThan(20);

  await expect(page.locator(".v09-vehicles")).toBeVisible();
  await expect(page.locator(".v09-hulls path")).toHaveCount(2);

  await expect(page.locator(".v09-timeline path[fill='none']")).toHaveCount(6);
  await page.locator(".v09-chart-toggles button", { hasText: "נתיב" }).click();
  await expect(page.locator(".v09-timeline path[fill='none']")).toHaveCount(4);

  await page.locator(".v09-window-picker button", { hasText: "30 דק׳" }).click();
  await expect(page.locator(".v09-timeline")).toContainText("18:30");
  await expect(page.locator(".v09-timeline")).toContainText("19:00");
  await expect(page.locator(".v09-group-legend")).toContainText("קבוצת SI");
  await expect(page.locator(".v09-group-legend")).toContainText("קבוצת SO");
  await expect(page.locator(".v09-style-legend")).toContainText("כולל");
  await expect(page.locator(".v09-style-legend")).toContainText("סנכרון");

  expect(failures, failures.join("\n")).toEqual([]);
});

test("SO builder uses +/- controls, immediate permutations and relation-responsive preview", async ({ page }) => {
  const failures = collectRuntimeFailures(page);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(baseURL, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /מפתחים/ }).click();
  await expect(page.locator(".v09-template-builder")).toBeVisible();

  const singleSection = page.locator(".v09-so-count-groups section").first();
  const rows = singleSection.locator(".v09-count-row");
  await rows.nth(0).locator(".v09-stepper button").last().click();
  await rows.nth(1).locator(".v09-stepper button").last().click();
  await expect(page.locator(".v09-layout-options button").first()).toBeVisible();
  expect(await page.locator(".v09-layout-options button").count()).toBeGreaterThan(1);

  const before = await page.locator(".v09-template-svg").innerHTML();
  const relation = page.locator(".v09-relation-editors select").first();
  await relation.selectOption("opposite");
  const after = await page.locator(".v09-template-svg").innerHTML();
  expect(after).not.toEqual(before);

  expect(failures, failures.join("\n")).toEqual([]);
});

test("developer exposes threshold diagrams, scoring sensitivity, GT traces and parametric route handles", async ({ page }) => {
  const failures = collectRuntimeFailures(page);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(baseURL, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /מפתחים/ }).click();

  await page.locator(".v09-dev-nav button", { hasText: "ציון וספים" }).click();
  await expect(page.locator(".v09-sensitivity")).toContainText("120°→90°");
  await page.locator(".v09-thresholds section header button").first().click();
  await expect(page.locator(".v09-threshold-diagram").first()).toBeVisible();

  await page.locator(".v09-dev-nav button", { hasText: "GT ו־Sweep" }).click();
  await expect(page.locator(".v09-gt-map")).toBeVisible();
  expect(await page.locator(".v09-gt-map circle").count()).toBeGreaterThan(20);
  await page.getByText("Route classified wrong").locator("input").check();
  await expect(page.locator(".v09-axis-handle")).toHaveCount(4);

  await page.locator(".v09-dev-nav button", { hasText: "בנק נתיבים" }).click();
  await expect(page.locator(".v09-route-map")).toBeVisible();
  await expect(page.locator(".v09-param-handles circle[data-kind='center']")).toBeVisible();
  await expect(page.locator(".v09-param-handles circle[data-kind='radius']")).toBeVisible();
  await expect(page.locator(".v09-param-handles circle[data-kind='angle']")).toBeVisible();
  await expect(page.getByRole("button", { name: /חבר 2 ל‑Double/ })).toBeVisible();

  expect(failures, failures.join("\n")).toEqual([]);
});

test("investigation exports a PDF with maps and explicit joined/left vehicle boundaries", async ({ page }) => {
  const failures = collectRuntimeFailures(page);
  await page.setViewportSize({ width: 1280, height: 960 });
  await page.goto(baseURL, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "תחקור", exact: true }).click();
  await expect(page.locator(".v09-report-map").first()).toBeVisible();
  await expect(page.getByText(/הצטרפו:/).first()).toBeVisible();
  await expect(page.getByText(/יצאו:/).first()).toBeVisible();

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: /PDF עם מפות/ }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/Blue-Wolf-.*\.pdf$/);
  expect(failures, failures.join("\n")).toEqual([]);
});

test("mobile template sheet keeps Apply reachable and layout remains RTL without page clipping", async ({ page }) => {
  const failures = collectRuntimeFailures(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(baseURL, { waitUntil: "networkidle" });
  const initial = await page.evaluate(() => ({ direction: getComputedStyle(document.documentElement).direction, scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth }));
  expect(initial.direction).toBe("rtl");
  expect(initial.scrollWidth).toBeLessThanOrEqual(initial.clientWidth + 4);

  await page.getByRole("button", { name: "החלפת תבנית" }).click();
  const sheet = page.locator(".v09-template-sheet");
  await expect(sheet).toBeVisible();
  const apply = sheet.getByRole("button", { name: /החל תבנית/ });
  await expect(apply).toBeVisible();
  const box = await apply.boundingBox();
  if (!box) throw new Error("Apply button has no bounding box");
  expect(box.y + box.height).toBeLessThanOrEqual(844);

  const finalLayout = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth }));
  expect(finalLayout.scrollWidth).toBeLessThanOrEqual(finalLayout.clientWidth + 4);
  expect(failures, failures.join("\n")).toEqual([]);
});
