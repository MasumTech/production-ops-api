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

async function setTeamLeaderDate(page: Page) {
  await page.locator('summary[aria-label="Open workspace controls"]').click();
  await page.getByLabel("Operational date").fill(operationalDate);
  await page.locator('summary[aria-label="Open workspace controls"]').click();
}

async function signOutTeamLeader(page: Page) {
  await page.locator('summary[aria-label="Open workspace controls"]').click();
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page.getByRole("button", { name: "Sign in", exact: true })).toBeVisible();
}

test("Team Leader red update becomes visible to Operations Manager", async ({ page }) => {
  await signIn(page, "demo.leader");
  await setTeamLeaderDate(page);

  await page.getByRole("button", { name: "Update line" }).click();
  await expect(
    page.getByRole("heading", { name: "Update line or raise issue" }),
  ).toBeVisible();

  await page.getByLabel("RAG status").selectOption("red");
  await page.getByLabel("Current product").fill("Salt & Pepper Chicken");
  await page
    .getByLabel(/Issue summary/)
    .fill("E2E cross-role filler interruption");
  await page
    .getByLabel("Action taken")
    .fill("Line made safe and engineering support requested");
  await page
    .getByLabel("Support required")
    .fill("Engineering");
  await page.getByRole("button", { name: "Record line update" }).click();

  await expect(page.getByText("Line status recorded.")).toBeVisible();
  await signOutTeamLeader(page);

  await signIn(page, "demo.manager");
  await page.getByLabel("Operational date").fill(operationalDate);
  await expect(
    page.getByRole("heading", { name: "Before-shift and live overview" }),
  ).toBeVisible();

  const workspace = page.locator('aside[aria-label="Operations Manager workspace"]');
  await workspace.getByRole("button", { name: "Team Leaders" }).click();
  await expect(
    page.getByRole("heading", { name: "Team Leaders & line control" }),
  ).toBeVisible();
  await expect(page.getByText("E2E cross-role filler interruption")).toBeVisible();

  await workspace.getByRole("button", { name: "Risk briefing" }).click();
  await expect(
    page.getByRole("heading", { name: "AI Daily Risk Briefing" }),
  ).toBeVisible();
  await expect(page.getByText(/DEMO-LINE-01|Line 1/).first()).toBeVisible();
});

test("Team Leader material escalation is visible in manager actions", async ({ page }) => {
  await signIn(page, "demo.leader");
  await setTeamLeaderDate(page);

  const workspace = page.locator('aside[aria-label="Team Leader workspace"]');
  await workspace.getByRole("button", { name: "Materials" }).click();
  await expect(
    page.getByRole("heading", { name: "Product & material readiness" }),
  ).toBeVisible();

  await page.getByText("Oat Milk Chai", { exact: true }).click();
  await page.getByRole("button", { name: "Raise issue" }).click();
  await expect(
    page.getByRole("heading", { name: "Update line or raise issue" }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Escalation" })).toHaveClass(/is-active/);
  await expect(page.getByLabel("Category")).toHaveValue("material");

  await page.getByLabel("Priority").selectOption("medium");
  await page
    .getByLabel("Detail")
    .fill("E2E material escalation from Team Leader workspace");
  await page.getByRole("button", { name: "Raise escalation" }).click();
  await expect(
    page.getByText("Escalation raised and added to the attention queue."),
  ).toBeVisible();

  await signOutTeamLeader(page);
  await signIn(page, "demo.manager");
  await page.getByLabel("Operational date").fill(operationalDate);
  const managerWorkspace = page.locator('aside[aria-label="Operations Manager workspace"]');
  await managerWorkspace.getByRole("button", { name: "Materials" }).click();
  await page.getByRole("tab", { name: /Open actions/ }).click();
  await expect(page.getByText(/Oat Milk Chai material risk/)).toBeVisible();
});
