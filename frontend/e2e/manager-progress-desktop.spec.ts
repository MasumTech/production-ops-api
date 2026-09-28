import { expect, test } from "@playwright/test";

const password = process.env.E2E_PASSWORD ?? "";
const operationalDate = process.env.E2E_OPERATIONAL_DATE ?? "2026-09-04";

test("manager progress views render at desktop width with recorded hourly details", async ({ page }, testInfo) => {
  test.skip(!password, "Set E2E_PASSWORD to run browser acceptance tests.");
  await page.setViewportSize({ width: 1536, height: 1024 });
  await page.goto("/");
  await page.getByLabel("Username").fill(process.env.DEMO_MANAGER_USERNAME ?? "demo.manager");
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByLabel("Operational date").fill(operationalDate);

  const nav = page.locator('aside[aria-label="Operations Manager workspace"]');
  await expect(page.locator(".manager-position-row")).toHaveCount(6);
  await expect(page.getByLabel("Hourly downtime chart")).toBeVisible();
  await expect(page.locator(".manager-position-track i").first()).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("manager-progress-overview-desktop.png"), animations: "disabled", fullPage: true });

  await nav.getByRole("button", { name: "Team Leaders" }).click();
  await expect(page.locator(".manager-leader-progress-card")).toHaveCount(3);
  await expect(page.locator(".manager-leader-progress-line")).toHaveCount(6);
  await expect(page.locator(".manager-leader-progress-grid")).toHaveCSS("grid-template-columns", /\d+px \d+px/);
  await page.screenshot({ path: testInfo.outputPath("manager-progress-team-leaders-desktop.png"), animations: "disabled", fullPage: true });

  await nav.getByRole("button", { name: "Daily plans" }).click();
  await expect(page.locator(".daily-plan-row")).toHaveCount(6);
  await expect(page.locator(".daily-plan-block--production").first()).toBeVisible();
  await page.locator(".manager-output-open").first().click();
  await expect(page.locator(".manager-output-detail")).toBeVisible();
  await expect(page.locator(".manager-output-hour").first()).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("manager-progress-daily-plans-desktop.png"), animations: "disabled", fullPage: true });

  expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false);
});
