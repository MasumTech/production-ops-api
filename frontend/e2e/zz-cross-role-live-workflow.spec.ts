import { expect, test, type Page } from "@playwright/test";

const password = process.env.E2E_PASSWORD ?? "";
const operationalDate = process.env.E2E_OPERATIONAL_DATE ?? "2026-09-04";

test.describe.configure({ mode: "serial" });

test.beforeEach(() => {
  test.skip(!password, "Set E2E_PASSWORD to run browser acceptance tests.");
});

async function signIn(page: Page, username: string) {
  await page.goto("/");
  await page.getByLabel("Username").fill(username);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
}

async function setOperationalDate(page: Page) {
  await page.getByLabel("Operational date").fill(operationalDate);
}

async function signOutTeamLeader(page: Page) {
  await page.getByLabel(/Open profile menu/).click();
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(
    page.getByRole("button", { name: "Sign in", exact: true }),
  ).toBeVisible();
}

test("Team Leader escalation becomes visible to Operations Manager", async ({
  page,
}) => {
  await signIn(page, "demo.leader");
  await expect(
    page.getByRole("heading", { name: "My Lines" }),
  ).toBeVisible();
  await setOperationalDate(page);

  const lineOne = page.locator(".team-control-card").filter({
    hasText: "Line 1",
  });
  await lineOne.getByRole("button", { name: "Raise issue" }).click();

  await expect(
    page.getByRole("heading", { name: "Raise issue" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "RED" }).click();
  await page.getByLabel("Category").selectOption("equipment");
  await page
    .getByLabel("Short problem")
    .fill("E2E cross-role filler interruption");
  await page
    .getByLabel("Immediate control")
    .fill("Line stopped safely; engineering support requested");
  await page.getByLabel("Support required").selectOption("engineering");
  await page.getByLabel("Action owner").selectOption("engineering");
  await page.getByLabel("Next update").selectOption("10");
  await page.getByRole("button", { name: "Save & escalate" }).click();

  await expect(
    page.getByText("Issue recorded and escalated to the attention queue."),
  ).toBeVisible();

  await signOutTeamLeader(page);

  await signIn(page, "demo.manager");
  await expect(
    page.getByRole("heading", { name: "Before-shift and live overview" }),
  ).toBeVisible();
  await setOperationalDate(page);

  const managerWorkspace = page.locator(
    'aside[aria-label="Operations Manager workspace"]',
  );
  await managerWorkspace
    .getByRole("button", { name: "Team Leaders" })
    .click();
  await expect(
    page.getByRole("heading", { name: "Team Leaders & line control" }),
  ).toBeVisible();
  const lineOneRow = page.getByRole("row", {
    name: "Open details for DEMO-LINE-01",
  });
  await lineOneRow.click();
  const lineOneDrawer = page.getByLabel("Line 1 details");
  await expect(lineOneDrawer).toContainText(
    "E2E cross-role filler interruption",
  );

  await managerWorkspace.getByRole("button", { name: "Materials" }).click();
  await page.getByRole("tab", { name: /Open actions/ }).click();
  await expect(
    page.getByText(/E2E cross-role filler interruption/),
  ).toBeVisible();
});

test("Team Leader material escalation becomes a manager open action", async ({
  page,
}) => {
  await signIn(page, "demo.leader");
  await expect(
    page.getByRole("heading", { name: "My Lines" }),
  ).toBeVisible();
  await setOperationalDate(page);

  const workspace = page.locator('aside[aria-label="Team Leader workspace"]');
  await workspace.getByRole("button", { name: "Materials" }).click();
  await expect(page.getByRole("heading", { name: "Materials" })).toBeVisible();

  const detail = page.getByLabel("Selected material details");
  await expect(detail).toContainText("Oat Milk Chai");
  await detail
    .getByRole("button", { name: "Raise material issue" })
    .click();

  await expect(
    page.getByRole("heading", { name: "Raise issue" }),
  ).toBeVisible();
  await expect(page.getByLabel("Category")).toHaveValue("material");
  await expect(page.getByLabel("Short problem")).toHaveValue(
    "Oat Milk Chai material risk",
  );
  await page.getByLabel("Support required").selectOption("materials");
  await page.getByLabel("Action owner").selectOption("materials");
  await page.getByRole("button", { name: "Save & escalate" }).click();

  await expect(
    page.getByText("Issue recorded and escalated to the attention queue."),
  ).toBeVisible();

  await signOutTeamLeader(page);

  await signIn(page, "demo.manager");
  await expect(
    page.getByRole("heading", { name: "Before-shift and live overview" }),
  ).toBeVisible();
  await setOperationalDate(page);

  const managerWorkspace = page.locator(
    'aside[aria-label="Operations Manager workspace"]',
  );
  await managerWorkspace.getByRole("button", { name: "Materials" }).click();
  await page.getByRole("tab", { name: /Open actions/ }).click();
  await expect(
    page.getByText(/Oat Milk Chai material risk/),
  ).toBeVisible();
});
