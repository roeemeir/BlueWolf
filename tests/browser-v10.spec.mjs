import { expect, test } from "@playwright/test";

const baseURL = process.env.BLUEWOLF_BASE_URL ?? "http://127.0.0.1:3000";

function collectRuntimeFailures(page) {
  const failures = [];
  page.on("pageerror", (error) => failures.push(`pageerror: ${error.message}`));
  page.on("console", (message) => { if (message.type() === "error") failures.push(`console: ${message.text()}`); });
  return failures;
}

test("v0.10 live keeps all group data, group colors, 30m trail and continuous score colorbar", async ({ page }) => {
  const failures = collectRuntimeFailures(page);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(baseURL, { waitUntil: "networkidle" });
  await expect(page.getByRole("heading", { name: "תמונה מבצעית" })).toBeVisible();
  await expect(page.locator(".v10-group-card")).toHaveCount(2);
  await expect(page.locator(".v10-live-map")).toContainText("עקבה: 30 דקות");
  expect(await page.locator(".v09-trace-dots circle").count()).toBeGreaterThan(80);

  await page.locator(".v09-overlay-bar button", { hasText: "עקבה לפי ציון" }).click();
  await expect(page.locator(".v10-score-colorbar")).toBeVisible();
  await expect(page.locator(".v10-score-colorbar")).toContainText("50");
  expect(await page.locator(".v09-score-trace circle").count()).toBeGreaterThan(80);

  await expect(page.locator(".v09-timeline path[fill='none']")).toHaveCount(6);
  const groupFilter = page.locator(".v10-chart-filters").getByRole("button", { name: "SO", exact: true });
  await groupFilter.click();
  await expect(page.locator(".v09-timeline path[fill='none']")).toHaveCount(3);
  await groupFilter.click();
  await expect(page.locator(".v09-timeline path[fill='none']")).toHaveCount(6);
  expect(failures, failures.join("\n")).toEqual([]);
});

test("SO builder is generic, directional, 20-degree smile and blocks duplicate save", async ({ page }) => {
  const failures = collectRuntimeFailures(page);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(baseURL, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /מפתחים/ }).click();
  await expect(page.locator(".v10-template-builder")).toBeVisible();
  await expect(page.locator(".v10-smile-preview")).toContainText("0°");
  await expect(page.locator(".v10-smile-preview")).toContainText("20°");

  const before = await page.locator(".v10-smile-preview").innerHTML();
  await page.locator(".v10-slot-list button").first().click();
  const after = await page.locator(".v10-smile-preview").innerHTML();
  expect(after).not.toEqual(before);
  await page.getByRole("button", { name: /הוסף כפול/ }).click();
  await expect(page.locator(".v10-chain-editor article")).toHaveCount(4);
  await expect(page.locator(".v10-derived-relations")).toBeVisible();

  const name = page.getByPlaceholder("שם קצר");
  await name.fill("QA v1.2 A");
  await page.getByRole("button", { name: /שמור תבנית/ }).click();
  await expect(page.getByText("התבנית נשמרה")).toBeVisible();
  await name.fill("QA v1.2 B");
  await page.getByRole("button", { name: /שמור תבנית/ }).click();
  await expect(page.getByText("נמצאה תבנית זהה")).toBeVisible();
  await expect(page.getByRole("button", { name: "החלף קיימת" })).toBeVisible();
  expect(failures, failures.join("\n")).toEqual([]);
});

test("GT has configured map layers, live angle and working ruler", async ({ page }) => {
  const failures = collectRuntimeFailures(page);
  await page.setViewportSize({ width: 1400, height: 1000 });
  await page.goto(baseURL, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /מפתחים/ }).click();
  await page.locator(".v09-dev-nav button", { hasText: "GT ו־Sweep" }).click();
  await expect(page.locator(".v10-gt-map")).toBeVisible();
  await expect(page.getByText("שכבת מפה")).toBeVisible();
  await page.getByText("Route classified wrong").locator("input").check();
  await expect(page.locator(".v10-live-angle")).toBeVisible();
  await expect(page.locator(".v09-axis-handle")).toHaveCount(4);

  await page.getByRole("button", { name: /סרגל/ }).click();
  const map = page.locator(".v10-gt-map");
  await map.click({ position: { x: 170, y: 170 } });
  await map.click({ position: { x: 350, y: 250 } });
  await expect(page.locator(".v10-ruler line")).toBeVisible();
  await expect(page.locator(".v10-ruler text")).toContainText("m");
  expect(failures, failures.join("\n")).toEqual([]);
});

test("investigation draws all event traces/routes by event color and keeps PDF export", async ({ page }) => {
  const failures = collectRuntimeFailures(page);
  await page.setViewportSize({ width: 1280, height: 960 });
  await page.goto(baseURL, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "תחקור", exact: true }).click();
  await expect(page.locator(".v10-event-evidence-map")).toBeVisible();
  await expect(page.locator(".v10-event-centroid")).toHaveCount(4);
  expect(await page.locator(".v10-event-evidence path").count()).toBeGreaterThan(4);
  expect(await page.locator(".v10-event-evidence circle").count()).toBeGreaterThan(40);
  await expect(page.locator(".v10-event-causes")).toContainText("64.2");
  await expect(page.locator(".v10-event-causes")).toContainText("96 מ׳");
  await expect(page.locator(".v10-legacy-investigation .v09-report-map").first()).toBeVisible();

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: /PDF עם מפות/ }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/Blue-Wolf-.*\.pdf$/);
  expect(failures, failures.join("\n")).toEqual([]);
});

test("mobile remains RTL and template Apply stays reachable", async ({ page }) => {
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
  expect(failures, failures.join("\n")).toEqual([]);
});
