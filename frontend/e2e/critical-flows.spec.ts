import { expect, test, type Page } from "@playwright/test";

const password = process.env.E2E_PASSWORD ?? "";
const operationalDate = process.env.E2E_OPERATIONAL_DATE ?? "2026-09-04";

test.beforeEach(() => {
  test.skip(!password, "Set E2E_PASSWORD to run browser acceptance tests.");
});

async function signIn(page: Page, username: string) {
  await page.goto("/");
  const usernameEnvKey = `${username.toUpperCase().replaceAll(".", "_")}_USERNAME`;
  await page.getByLabel("Username").fill(process.env[usernameEnvKey] ?? username);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
}

test("manager can open the daily risk briefing after secure sign-in", async ({ page }) => {
  await signIn(page, "demo.manager");
  await page.getByLabel("Operational date").fill(operationalDate);

  await expect(
    page.getByRole("heading", { name: "Before-shift and live overview" }),
  ).toBeVisible();

  const workspace = page.locator('aside[aria-label="Operations Manager workspace"]');
  await expect(workspace.getByRole("button")).toHaveCount(6);
  await expect(page.locator(".control-kpi")).toHaveCount(4);
  await expect(page.locator(".leader-card")).toHaveCount(3);
  await expect(page.locator(".leader-line")).toHaveCount(6);
  // The deterministic fixture is Friday, so the configured day shift starts
  // at 06:45 and produces a 15-minute opening bucket plus 11 hourly buckets.
  await expect(page.locator(".downtime-bars article")).toHaveCount(12);

  await workspace.getByRole("button", { name: "Team Leaders" }).click();
  await expect(page.getByRole("heading", { name: "Team Leaders & line control" })).toBeVisible();
  await workspace.getByRole("button", { name: "Daily plans" }).click();
  await expect(page.getByRole("heading", { name: "Daily plans" })).toBeVisible();
  await workspace.getByRole("button", { name: "Materials" }).click();
  await expect(page.getByRole("heading", { name: "Materials & actions" })).toBeVisible();
  await workspace.getByRole("button", { name: "Break recovery" }).click();
  await expect(
    page.getByRole("heading", { name: "Break recovery & loss history" }),
  ).toBeVisible();
  await workspace.getByRole("button", { name: "Risk briefing" }).click();
  await expect(
    page.getByRole("heading", { name: "AI Daily Risk Briefing" }),
  ).toBeVisible();
});

test("team leader is routed to the assigned-line workspace", async ({ page }) => {
  await signIn(page, "demo.leader");

  await expect(page.getByText("Operations Control Board", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "My Lines" })).toBeVisible();
  await page.getByLabel("Operational date").fill(operationalDate);
  await expect(page.getByLabel("Shift pattern")).toHaveValue("day");
  await expect(page.getByRole("group", { name: "Data view" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Alerts/ })).toBeVisible();
  await expect(page.getByLabel(/Open profile menu/)).toBeVisible();
  await expect(page.locator(".team-control-card")).toHaveCount(2);
  await expect(page.getByLabel("Assigned-line summary")).toBeVisible();
  await expect(page.getByRole("button", { name: "Update line" }).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Raise issue" }).first()).toBeVisible();
  await expect(page.getByText("Priority:", { exact: true })).toBeVisible();

  const firstIssueButton = page.getByRole("button", { name: "Raise issue" }).first();
  await firstIssueButton.click();
  await expect(page.getByRole("heading", { name: "Raise issue" })).toBeVisible();
  await expect(page.getByText("Describe", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByRole("heading", { name: "My Lines" })).toBeVisible();

  const workspace = page.locator('aside[aria-label="Team Leader workspace"]');
  await expect(workspace).toBeVisible();
  await expect(workspace.getByRole("button")).toHaveCount(5);
  await workspace.getByRole("button", { name: "Daily Plan" }).click();
  await expect(
    page.getByRole("heading", { name: "Daily Plan" }),
  ).toBeVisible();
  await expect(page.locator(".tl-plan-v2__row")).toHaveCount(2);
  await expect(page.getByLabel("Output by assigned line")).toBeVisible();

  await workspace.getByRole("button", { name: "Materials" }).click();
  await expect(
    page.getByRole("heading", { name: "Materials" }),
  ).toBeVisible();
  await expect(page.getByRole("table")).toBeVisible();
  for (const status of ["READY", "IN PROCESS", "SHORT", "HELD"]) {
    await expect(page.getByText(status, { exact: true }).first()).toBeVisible();
  }
  await expect(page.getByLabel("Selected material details")).toContainText(
    "Oat Milk Chai",
  );
  await expect(
    page.getByRole("button", { name: "Raise material issue" }),
  ).toBeVisible();

  await workspace.getByRole("button", { name: "Break & Recovery" }).click();
  await expect(
    page.getByRole("heading", { name: "Break & Recovery" }),
  ).toBeVisible();
  await expect(
    page.getByRole("tab", { name: "Current opportunity" }),
  ).toHaveAttribute("aria-selected", "true");
  await expect(page.locator(".break-recovery-v2__review")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Confirm opportunity" }),
  ).toBeEnabled();

  await workspace.getByRole("button", { name: "Shift Handover" }).click();
  await expect(
    page.getByRole("heading", { name: "Shift Handover" }),
  ).toBeVisible();
  await expect(page.getByText("3 open items")).toBeVisible();
  await expect(page.getByLabel("Open items for handover")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Hand over" }),
  ).toBeEnabled();
});
