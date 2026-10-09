import { expect, test, type Page } from "@playwright/test";

const password = process.env.E2E_PASSWORD ?? "";
const operationalDate = process.env.E2E_OPERATIONAL_DATE ?? "2026-09-04";

test.beforeEach(() => {
  test.skip(!password, "Set E2E_PASSWORD to run browser acceptance tests.");
});

async function signIn(page: Page, username: string) {
  await page.goto("/");
  await page.getByLabel("Username").fill(username);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
}

test("manager design exposes fifteen plan leaders and the profile editor", async ({ page }, testInfo) => {
  await page.clock.install({ time: new Date(`${operationalDate}T08:00:00Z`) });
  await page.setViewportSize({ width: 1536, height: 960 });
  await signIn(page, "demo.manager");
  await expect(page.getByRole("heading", { name: "Before-shift and live overview" })).toBeVisible();

  await page.locator(".manager-profile summary").click();
  await page.getByRole("button", { name: "Edit profile" }).click();
  await expect(page.getByRole("dialog", { name: "Edit your profile" })).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("manager-shell-profile-editor.png"),
    animations: "disabled",
    fullPage: false,
  });
  await page.getByRole("button", { name: "Close profile editor" }).click();

  await page.locator('aside[aria-label="Operations Manager workspace"]').getByRole("button", { name: "Daily plans" }).click();
  await page.getByRole("button", { name: "Add plan block" }).click();
  const editor = page.getByRole("dialog", { name: "Add plan block" });
  await editor.getByLabel("Production line").selectOption("line-7");
  const leaders = editor.getByLabel("Team Leader");
  await expect(leaders.getByRole("option")).toHaveCount(16);
  await expect(leaders.getByRole("option", { name: "Team Leader 15" })).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("manager-daily-plan-fifteen-leaders.png"),
    animations: "disabled",
    fullPage: false,
  });
});

test("modern notification drawer presents clear actions and filters", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1366, height: 900 });
  await signIn(page, "demo.manager");
  await expect(page.getByRole("heading", { name: "Before-shift and live overview" })).toBeVisible();
  await page.getByRole("button", { name: /^Notifications/ }).click();
  const drawer = page.getByRole("dialog", { name: "Notifications" });
  await expect(drawer.getByRole("tab", { name: "Critical" })).toBeVisible();
  await expect(drawer.getByRole("button", { name: "Mark all as seen" })).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("manager-shell-notification-drawer.png"),
    animations: "disabled",
    fullPage: false,
  });
});

test("Team Leader My Plan opens hourly downtime CRUD", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1536, height: 960 });
  await signIn(page, "demo.leader");
  await page.getByLabel("Operational date").fill(operationalDate);
  await expect(page.getByRole("heading", { name: "My Lines" })).toBeVisible();
  await page.locator('aside[aria-label="Team Leader workspace"]').getByRole("button", { name: "Daily Plan" }).click();
  await page.getByRole("button", { name: /Line 1 ▾/ }).click();
  const downtimeHour = page.locator(".tl-plan-v2__hour.has-downtime").first();
  await expect(downtimeHour).toBeVisible();
  await downtimeHour.getByRole("button", { name: /^Manage downtime for/ }).click();
  const editor = page.getByRole("dialog", { name: /Line 1 ·/ });
  await expect(editor.getByRole("heading", { name: "Recorded downtime" })).toBeVisible();
  await expect(editor.getByRole("button", { name: "Add downtime" })).toBeVisible();
  await expect(editor.getByRole("button", { name: "Edit" }).first()).toBeVisible();
  await expect(editor.getByRole("button", { name: "Delete" }).first()).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("team-leader-daily-plan-v2-hourly-downtime.png"),
    animations: "disabled",
    fullPage: false,
  });
});
