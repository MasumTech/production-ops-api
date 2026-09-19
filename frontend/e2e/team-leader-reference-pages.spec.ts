import { expect, test, type Page } from "@playwright/test";

const password = process.env.E2E_PASSWORD ?? "";
const operationalDate = process.env.E2E_OPERATIONAL_DATE ?? "2026-09-04";

test.beforeEach(() => {
  test.skip(!password, "Set E2E_PASSWORD to run browser acceptance tests.");
});

async function signInAsTeamLeader(page: Page) {
  await page.goto("/");
  await page.getByLabel("Username").fill("demo.leader");
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.locator('summary[aria-label="Open workspace controls"]').click();
  await page.getByLabel("Operational date").fill(operationalDate);
  await page.locator('summary[aria-label="Open workspace controls"]').click();
}

test("captures the five approved Team Leader reference pages", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1887, height: 852 });
  await signInAsTeamLeader(page);

  const workspace = page.locator('aside[aria-label="Team Leader workspace"]');

  const pages = [
    { nav: "My lines", heading: "My lines", slug: "my-lines" },
    { nav: "Daily plan", heading: "Daily production plan", slug: "daily-plan" },
    { nav: "Materials", heading: "Product & material readiness", slug: "materials" },
    { nav: "Break & recovery", heading: "Break & Recovery", slug: "break-recovery" },
    { nav: "Handover", heading: "Shift handover", slug: "handover" },
  ];

  for (const item of pages) {
    await workspace.getByRole("button", { name: item.nav }).click();
    await expect(page.getByRole("heading", { name: item.heading })).toBeVisible();
    await page.screenshot({
      path: testInfo.outputPath(`team-leader-reference-${item.slug}.png`),
      fullPage: true,
      animations: "disabled",
    });
  }
});

test("Team Leader reference pages remain keyboard reachable", async ({ page }) => {
  await signInAsTeamLeader(page);
  const workspace = page.locator('aside[aria-label="Team Leader workspace"]');

  for (const name of ["My lines", "Daily plan", "Materials", "Break & recovery", "Handover"]) {
    const button = workspace.getByRole("button", { name });
    await expect(button).toBeVisible();
    await button.focus();
    await expect(button).toBeFocused();
  }
});
