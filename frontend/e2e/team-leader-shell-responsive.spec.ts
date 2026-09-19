import { expect, test, type Page } from "@playwright/test";

const password = process.env.E2E_PASSWORD ?? "";
const operationalDate = process.env.E2E_OPERATIONAL_DATE ?? "2026-09-04";

const viewports = [
  { name: "desktop", width: 1536, height: 1024 },
  { name: "tablet", width: 1024, height: 768 },
  { name: "phone", width: 390, height: 844 },
] as const;

test.beforeEach(() => {
  test.skip(!password, "Set E2E_PASSWORD to run browser acceptance tests.");
});

async function signInAsTeamLeader(page: Page) {
  await page.goto("/");
  await page.getByLabel("Username").fill(
    process.env.DEMO_LEADER_USERNAME ?? "demo.leader",
  );
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("heading", { name: "My lines" })).toBeVisible();

  await page.locator('summary[aria-label="Open workspace controls"]').click();
  await page.getByLabel("Operational date").fill(operationalDate);
  await page.locator('summary[aria-label="Open workspace controls"]').click();
}

for (const viewport of viewports) {
  test(`Team Leader shell matches the ${viewport.name} layout`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await signInAsTeamLeader(page);

    await expect(page.getByText("LINE CONTROL ASSISTANT")).toBeVisible();
    await expect(page.getByRole("heading", { name: "My lines" })).toBeVisible();
    await expect(page.getByText(/Shift\s+\d{2}:\d{2}\s+–\s+\d{2}:\d{2}/)).toBeVisible();

    if (viewport.name === "phone") {
      await expect(
        page.getByRole("navigation", { name: "Team Leader mobile workspace" }),
      ).toBeVisible();
    } else {
      await expect(
        page.locator('aside[aria-label="Team Leader workspace"]'),
      ).toBeVisible();
    }

    await page.screenshot({
      path: testInfo.outputPath(`team-leader-shell-${viewport.name}.png`),
      animations: "disabled",
    });
  });
}
