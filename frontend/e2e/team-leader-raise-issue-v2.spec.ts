import { expect, test, type Page } from "@playwright/test";

const password = process.env.E2E_PASSWORD ?? "";
const operationalDate = process.env.E2E_OPERATIONAL_DATE ?? "2026-09-04";

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
  await expect(page.getByRole("heading", { name: "My Lines" })).toBeVisible();
  await page.getByLabel("Operational date").fill(operationalDate);
  await expect(page.locator(".team-control-card")).toHaveCount(2);
}

test("Raise Issue matches the latest structured reference", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1586, height: 1080 });
  await signInAsTeamLeader(page);

  const lineTwo = page.locator(".team-control-card").filter({
    hasText: "Line 2",
  });
  await lineTwo.getByRole("button", { name: "Raise issue" }).click();

  await expect(page.getByRole("heading", { name: "Raise issue" })).toBeVisible();
  await expect(page.getByText("Describe", { exact: true })).toBeVisible();
  await expect(page.getByText("Support", { exact: true })).toBeVisible();
  await expect(page.getByText("Follow-up", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Line").locator("option:checked")).toHaveText(
    /Line 2/,
  );
  await expect(page.getByRole("button", { name: "AMBER" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );

  await page.getByLabel("Category").selectOption("equipment");
  await page.getByLabel("Short problem").fill("Seal concern after former change");
  await page
    .getByLabel("Immediate control")
    .fill("Line slowed; Machine Minder checking");
  await page.getByLabel("Support required").selectOption("engineering");
  await page.getByLabel("Action owner").selectOption("engineering");
  await page.getByLabel("Next update").selectOption("10");

  await expect(page.getByRole("button", { name: "Add evidence" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Save draft" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Request support" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Save & escalate" })).toBeVisible();
  await expect(page.getByText(/does not replace the procedure/i)).toBeVisible();
  await expect(page.locator(".toast")).toBeHidden({ timeout: 5000 });

  await page.screenshot({
    path: testInfo.outputPath("team-leader-raise-issue-v2-reference.png"),
    animations: "disabled",
    fullPage: false,
  });
});
