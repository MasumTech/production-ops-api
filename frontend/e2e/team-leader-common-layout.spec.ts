import { expect, test, type Page } from "@playwright/test";

const password = process.env.E2E_PASSWORD ?? "";
const operationalDate = process.env.E2E_OPERATIONAL_DATE ?? "2026-09-04";

const viewports = [
  { name: "reference", width: 1586, height: 992 },
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
  await page.getByLabel("Operational date").fill(operationalDate);
  await expect(page.getByRole("heading", { name: "My Lines" })).toBeVisible();
  await expect(page.locator(".team-control-card")).toHaveCount(2);
}

for (const viewport of viewports) {
  test(`Team Leader common shell matches the ${viewport.name} layout`, async ({ page }, testInfo) => {
    await signInAsTeamLeader(page);
    await page.setViewportSize({ width: viewport.width, height: viewport.height });

    await expect(
      page.getByText("Operations Control Board", { exact: true }),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Refresh" })).toBeVisible();
    await expect(page.getByLabel(/Open profile menu/)).toBeVisible();

    const sidebar = page.locator('aside[aria-label="Team Leader workspace"]');
    if (viewport.name === "phone") {
      await expect(page.getByRole("group", { name: "Data view" })).toBeHidden();
      await page.getByRole("button", { name: "Open navigation" }).click();
      await expect(sidebar).toHaveClass(/team-control-sidebar--open/);
      await expect(sidebar.getByRole("button")).toHaveCount(5);
    } else {
      await expect(page.getByLabel("Shift pattern")).toHaveValue("day");
      await expect(page.getByRole("group", { name: "Data view" })).toBeVisible();
      await expect(page.getByRole("button", { name: /Alerts/ })).toBeVisible();
      await expect(sidebar).toBeVisible();
      await expect(sidebar.getByRole("button")).toHaveCount(5);
      await expect(sidebar.getByRole("button", { name: "My Lines" })).toHaveAttribute(
        "aria-current",
        "page",
      );
      await expect(page.getByText("Version 1.4.0", { exact: true })).toBeVisible();
    }

    await page.waitForTimeout(3800);

    if (viewport.name === "phone") {
      await page.locator(".team-control-menu").click();
      await expect(sidebar).not.toHaveClass(/team-control-sidebar--open/);
      await page.screenshot({
        path: testInfo.outputPath("team-leader-common-layout-phone.png"),
        animations: "disabled",
        fullPage: false,
      });

      await page.getByRole("button", { name: "Open navigation" }).click();
      await expect(sidebar).toHaveClass(/team-control-sidebar--open/);
      await page.screenshot({
        path: testInfo.outputPath(
          "team-leader-common-layout-phone-navigation.png",
        ),
        animations: "disabled",
        fullPage: false,
      });
      return;
    }

    await page.screenshot({
      path: testInfo.outputPath(
        `team-leader-common-layout-${viewport.name}.png`,
      ),
      animations: "disabled",
      fullPage: false,
    });
  });
}
