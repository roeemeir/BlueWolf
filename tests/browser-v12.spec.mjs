import { expect, test } from "@playwright/test";

const baseURL = process.env.BLUEWOLF_BASE_URL ?? "http://127.0.0.1:3000";
function failures(page) { const out = []; page.on("pageerror", (error) => out.push(`pageerror: ${error.message}`)); page.on("console", (message) => { if (message.type() === "error") out.push(`console: ${message.text()}`); }); return out; }
async function waitForLiveCore(page) {
  const detectedGroup = page.locator(".v10-group-card:has(.v10-compact-scores)").first();
  await expect(detectedGroup).toBeVisible({ timeout: 30_000 });
  await expect(page.locator(".v12-data-error")).toHaveCount(0);
  return detectedGroup;
}

test("live simulation is NAV-derived and exposes versioned Python Core", async ({ page }) => {
  const runtime = failures(page);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(baseURL, { waitUntil: "networkidle" });
  await expect(page.getByText(/v0\.15 · SRS v1\.8 · Python Core 1\.0\.0/)).toBeVisible();
  await expect(page.getByRole("heading", { name: "תמונה מבצעית" })).toBeVisible();
  await expect(page.locator(".v09-kpis")).not.toContainText("96%");
  await expect(page.locator(".v09-kpis")).not.toContainText("4.2s");
  await expect(page.locator(".v12-live-map")).toBeVisible();
  await expect.poll(async () => await page.locator(".v12-live-map .v09-map-heading").textContent(), { timeout: 20_000 }).toMatch(/\d+ דגימות/);
  await expect(page.locator(".v10-group-card")).toHaveCount(2);
  await waitForLiveCore(page);
  expect(runtime, runtime.join("\n")).toEqual([]);
});

test("template switch is group-contextual and score trail colorbar is multicolor", async ({ page }) => {
  const runtime = failures(page);
  await page.setViewportSize({ width: 1360, height: 950 });
  await page.goto(baseURL, { waitUntil: "networkidle" });
  await expect(page.getByRole("button", { name: "החלפת תבנית לקבוצה" })).toHaveCount(0);
  const detectedGroup = await waitForLiveCore(page);
  await detectedGroup.click();
  await expect(page.getByRole("button", { name: "החלפת תבנית לקבוצה" })).toBeVisible();
  await page.getByRole("button", { name: "החלפת תבנית לקבוצה" }).click();
  await expect(page.locator(".v09-template-sheet")).toBeVisible();
  await page.locator(".v09-template-sheet").getByRole("button", { name: "ביטול" }).click();
  await page.locator(".v09-overlay-bar button", { hasText: "עקבה לפי ציון" }).click();
  const bars = page.locator(".v10-score-colorbar rect");
  await expect(bars).toHaveCount(41);
  const styles = await bars.evaluateAll((nodes) => [...new Set(nodes.slice(1).map((node) => node.getAttribute("style") ?? node.getAttribute("fill")))].filter(Boolean));
  expect(styles.length).toBeGreaterThan(8);
  expect(runtime, runtime.join("\n")).toEqual([]);
});

test("Influx mode never silently falls back to simulator", async ({ page }) => {
  const runtime = failures(page);
  await page.goto(baseURL, { waitUntil: "networkidle" });
  await waitForLiveCore(page);
  await page.locator(".v09-source>button").click();
  await expect(page.getByText("InfluxDB אמיתי", { exact: false }).first()).toBeVisible();
  await expect(page.getByText("ללא fallback לסימולטור", { exact: false }).first()).toBeVisible();
  await expect(page.locator(".v12-data-error")).toBeVisible({ timeout: 20_000 });
  await expect(page.locator(".v12-data-error")).toContainText("אינה מציגה במקומו נתוני סימולציה");
  expect(runtime, runtime.join("\n")).toEqual([]);
});

test("historical range derives events and event-only PDF from NAV", async ({ page }) => {
  const runtime = failures(page);
  await page.setViewportSize({ width: 1400, height: 1000 });
  await page.goto(baseURL, { waitUntil: "networkidle" });
  await waitForLiveCore(page);
  await page.getByRole("button", { name: "תחקור", exact: true }).click();
  await expect(page.getByRole("heading", { name: "תחקור לפי חלון נתוני ניווט" })).toBeVisible();
  await page.getByRole("button", { name: "24 שעות" }).click();
  await page.getByRole("button", { name: "טען טווח" }).click();
  await expect.poll(async () => await page.locator(".v09-kpis").textContent(), { timeout: 30_000 }).toMatch(/\d+.*דגימות|דגימות.*\d+/s);
  await expect(page.locator(".v09-event-card").first()).toBeVisible({ timeout: 30_000 });
  await page.locator(".v09-event-card").first().click();
  await expect(page.locator(".v09-event-detail .v10-event-evidence-map")).toBeVisible();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "PDF", exact: true }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/Blue-Wolf-v14-.*\.pdf$/);
  expect(runtime, runtime.join("\n")).toEqual([]);
});

test("in-app System Tests execute production Core and compare Figure-8 to external GT", async ({ page }) => {
  const runtime = failures(page);
  test.setTimeout(150_000);
  await page.setViewportSize({ width: 1400, height: 1000 });
  await page.goto(baseURL, { waitUntil: "networkidle" });
  await waitForLiveCore(page);
  await page.getByRole("button", { name: /מפתחים/ }).click();
  await expect(page.getByRole("heading", { name: "בדיקות מערכת אמיתיות" })).toBeVisible();
  await page.getByRole("button", { name: "הרץ E2E" }).click();
  await expect.poll(async () => await page.locator(".v09-test-kpis").textContent(), { timeout: 120_000 }).toMatch(/ניתוחי Core/);
  const failedCards = await page.locator(".v09-test-grid article:has(.fail)").allTextContents();
  expect(failedCards, failedCards.join("\n---\n")).toEqual([]);
  await expect(page.locator(".v09-test-grid")).toContainText("Core contract");
  await expect(page.locator(".v09-test-grid")).toContainText("Simulator→NAV→Python Core→GT");
  await expect(page.locator(".v09-test-grid")).toContainText("שמינייה = היפודרום עם legs מוצלבים");
  await expect(page.locator(".v09-test-grid")).toContainText("הפרעת NAV מוזרקת מול estimate");
  await expect(page.locator(".v09-test-grid")).toContainText("30 יום");
  await expect(page.locator(".v09-test-grid")).toContainText("Influx adapter");
  expect(runtime, runtime.join("\n")).toEqual([]);
});

test("SO builder stays count-first and exposes Figure-8 as a crossed-leg entity", async ({ page }) => {
  const runtime = failures(page);
  await page.goto(baseURL, { waitUntil: "networkidle" });
  await waitForLiveCore(page);
  await page.getByRole("button", { name: /מפתחים/ }).click();
  await page.locator(".v09-dev-nav button", { hasText: "תבניות" }).click();
  await expect(page.locator(".v10-template-builder")).toBeVisible();
  await expect(page.locator(".v10-so-counts")).toBeVisible();
  await expect(page.locator(".v10-so-counts")).toContainText("שמינייה");
  await expect(page.locator(".v10-so-counts")).toContainText("legs מוצלבים");
  await expect(page.locator(".v10-layout-options button").first()).toBeVisible();
  await page.locator(".v10-layout-options button").first().click();
  await expect(page.locator(".v10-smile-preview")).toBeVisible();
  expect(runtime, runtime.join("\n")).toEqual([]);
});

test("mobile remains RTL without horizontal overflow", async ({ page }) => {
  const runtime = failures(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(baseURL, { waitUntil: "networkidle" });
  const layout = await page.evaluate(() => ({ direction: getComputedStyle(document.documentElement).direction, scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth }));
  expect(layout.direction).toBe("rtl");
  expect(layout.scrollWidth).toBeLessThanOrEqual(layout.clientWidth + 5);
  await expect(page.locator(".v12-live-map")).toBeVisible();
  await waitForLiveCore(page);
  expect(runtime, runtime.join("\n")).toEqual([]);
});