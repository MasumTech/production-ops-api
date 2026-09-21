import { expect, test, type Page } from "@playwright/test";

const password = process.env.E2E_PASSWORD ?? "";
const weekdayDate = "2026-09-04";
const weekendDate = "2026-09-05";

test.use({ timezoneId: "Europe/London" });

test.beforeEach(() => {
  test.skip(!password, "Set E2E_PASSWORD to run browser acceptance tests.");
});

async function signIn(page: Page, username: string) {
  await page.goto("/");
  await page.getByLabel("Username").fill(username);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
}

test("final UAT keeps weekday and weekend shift timing deterministic", async ({
  page,
}, testInfo) => {
  await signIn(page, "demo.leader");
  await expect(page.getByRole("heading", { name: "My Lines" })).toBeVisible();

  await page.getByLabel("Operational date").fill(weekdayDate);
  await expect(page.getByLabel("Shift pattern")).toContainText(
    "Day · 06:45–18:00",
  );
  await expect(page.locator(".team-control-card")).toHaveCount(2);

  await page.screenshot({
    path: testInfo.outputPath("final-uat-weekday-shift.png"),
    animations: "disabled",
    fullPage: false,
  });

  await page.getByLabel("Operational date").fill(weekendDate);
  await expect(page.getByLabel("Shift pattern")).toContainText(
    "Day · 07:00–18:00",
  );

  await page.screenshot({
    path: testInfo.outputPath("final-uat-weekend-shift.png"),
    animations: "disabled",
    fullPage: false,
  });
});

test("final UAT keeps all Team Leader workspaces reachable", async ({ page }) => {
  await signIn(page, "demo.leader");
  await page.getByLabel("Operational date").fill(weekdayDate);
  await expect(page.getByRole("heading", { name: "My Lines" })).toBeVisible();

  const workspace = page.locator('aside[aria-label="Team Leader workspace"]');
  await expect(workspace.getByRole("button")).toHaveCount(5);

  await workspace.getByRole("button", { name: "Daily Plan" }).click();
  await expect(page.getByRole("heading", { name: "Daily Plan" })).toBeVisible();
  await expect(
    page.getByRole("heading", { name: /Shift schedule · 06:45–18:00/ }),
  ).toBeVisible();

  await workspace.getByRole("button", { name: "Materials" }).click();
  await expect(page.getByRole("heading", { name: "Materials" })).toBeVisible();

  await workspace.getByRole("button", { name: "Break & Recovery" }).click();
  await expect(
    page.getByRole("heading", { name: "Break & Recovery" }),
  ).toBeVisible();

  await workspace.getByRole("button", { name: "Shift Handover" }).click();
  await expect(
    page.getByRole("heading", { name: "Shift Handover" }),
  ).toBeVisible();

  await workspace.getByRole("button", { name: "My Lines" }).click();
  await expect(page.getByRole("heading", { name: "My Lines" })).toBeVisible();
});

test("final UAT keeps all Operations Manager workspaces reachable", async ({
  page,
}, testInfo) => {
  await signIn(page, "demo.manager");
  await page.getByLabel("Operational date").fill(weekdayDate);
  await expect(
    page.getByRole("heading", { name: "Before-shift and live overview" }),
  ).toBeVisible();
  await expect(page.getByLabel("Shift pattern")).toContainText(
    "Day · 06:45–18:00",
  );

  const workspace = page.locator(
    'aside[aria-label="Operations Manager workspace"]',
  );
  await expect(workspace.getByRole("button")).toHaveCount(6);

  await workspace.getByRole("button", { name: "Team Leaders" }).click();
  await expect(
    page.getByRole("heading", { name: "Team Leaders & line control" }),
  ).toBeVisible();

  await workspace.getByRole("button", { name: "Daily plans" }).click();
  await expect(page.getByRole("heading", { name: "Daily plans" })).toBeVisible();
  await expect(
    page.getByLabel("Daily schedule timeline"),
  ).toContainText("06:45");

  await workspace.getByRole("button", { name: "Materials" }).click();
  await expect(
    page.getByRole("heading", { name: "Materials & actions" }),
  ).toBeVisible();

  await workspace.getByRole("button", { name: "Break recovery" }).click();
  await expect(
    page.getByRole("heading", { name: "Break recovery & loss history" }),
  ).toBeVisible();

  await workspace.getByRole("button", { name: "Risk briefing" }).click();
  await expect(
    page.getByRole("heading", { name: "AI Daily Risk Briefing" }),
  ).toBeVisible();

  await workspace.getByRole("button", { name: "Overview" }).click();
  await expect(
    page.getByRole("heading", { name: "Before-shift and live overview" }),
  ).toBeVisible();

  await page.screenshot({
    path: testInfo.outputPath("final-uat-manager-overview.png"),
    animations: "disabled",
    fullPage: false,
  });
});
