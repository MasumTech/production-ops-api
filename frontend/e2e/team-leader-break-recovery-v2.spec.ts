import { expect, test, type Page } from "@playwright/test";

const password = process.env.E2E_PASSWORD ?? "";
const operationalDate = process.env.E2E_OPERATIONAL_DATE ?? "2026-09-04";

test.use({ timezoneId: "Europe/London" });

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

test("Break Recovery matches the approved current-opportunity reference", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1586, height: 992 });
  await signInAsTeamLeader(page);

  const workspace = page.locator('aside[aria-label="Team Leader workspace"]');
  await workspace.getByRole("button", { name: "Break & Recovery" }).click();

  await expect(
    page.getByRole("heading", { name: "Break & Recovery" }),
  ).toBeVisible();
  await expect(
    page.getByText(
      "Preserve the full approved break and prepare a controlled restart",
    ),
  ).toBeVisible();
  await expect(page.getByText("Review required", { exact: true })).toBeVisible();

  await expect(
    page.getByRole("tab", { name: "Current opportunity" }),
  ).toHaveAttribute("aria-selected", "true");
  await expect(
    page.getByRole("tab", { name: "Recovery history" }),
  ).toBeVisible();

  const event = page.locator(".break-recovery-v2__event");
  await expect(
    event.getByRole("heading", { name: "Current event · Line 2" }),
  ).toBeVisible();
  await expect(event).toContainText("09:55 · Printer fault");
  await expect(event).toContainText("Stopped safely");
  await expect(event).toContainText("10:35");
  await expect(event).toContainText("Planned Break 1");
  await expect(event).toContainText("10:00–10:40");
  await expect(event).toContainText("Suggested window");

  const checks = page.locator(".break-recovery-v2__checks");
  await expect(
    checks.getByRole("heading", { name: "Approval checks" }),
  ).toBeVisible();
  await expect(checks.locator("li.is-complete")).toHaveCount(4);
  await expect(checks).toContainText("Team Leader / Operations approval");

  const timeline = page.getByLabel("DEMO-LINE-02 recovery timeline");
  await expect(timeline.locator("li")).toHaveCount(5);
  for (const label of ["Fault", "Break", "Returned", "Checks", "Running"]) {
    await expect(timeline.getByText(label, { exact: true })).toBeVisible();
  }

  await expect(page.getByText("35 min", { exact: true })).toBeVisible();
  await expect(page.getByText("40 min", { exact: true })).toBeVisible();
  await expect(page.getByText("Approved speed", { exact: true })).toBeVisible();
  await expect(
    page.getByText(
      /Never recall people early, reduce approved rest, bypass checks/i,
    ),
  ).toBeVisible();

  await expect(
    page.getByRole("button", { name: "Decline with reason" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Confirm opportunity" }),
  ).toBeEnabled();
  await expect(
    page.getByRole("button", { name: /Resume line Complete checks first/ }),
  ).toBeDisabled();

  await expect(page.locator(".toast")).toBeHidden({ timeout: 5000 });

  await page.screenshot({
    path: testInfo.outputPath("team-leader-break-recovery-v2-reference.png"),
    animations: "disabled",
    fullPage: false,
  });
});

test("Recovery history shows completed evidence without changing current state", async ({
  page,
}) => {
  await signInAsTeamLeader(page);
  const workspace = page.locator('aside[aria-label="Team Leader workspace"]');
  await workspace.getByRole("button", { name: "Break & Recovery" }).click();

  await page.getByRole("tab", { name: "Recovery history" }).click();

  await expect(page.getByText("Recovered", { exact: true })).toBeVisible();
  await expect(page.getByText(/Safety, quality and technical checks completed/)).toBeVisible();
});
