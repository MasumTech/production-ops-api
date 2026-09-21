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

test("Shift Handover matches the approved unresolved-work reference", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1536, height: 992 });
  await signInAsTeamLeader(page);

  const workspace = page.locator('aside[aria-label="Team Leader workspace"]');
  await workspace.getByRole("button", { name: "Shift Handover" }).click();

  await expect(
    page.getByRole("heading", { name: "Shift Handover" }),
  ).toBeVisible();
  await expect(
    page.getByText(
      "Transfer only unresolved work with control, owner and next update",
    ),
  ).toBeVisible();
  await expect(page.getByText("3 open items")).toBeVisible();

  const transfer = page.getByLabel("Shift responsibility transfer");
  await expect(transfer).toContainText("Outgoing: Day shift · Imran Khan");
  await expect(transfer).toContainText(
    "Incoming: Night shift · demo.leader.two · Acceptance required",
  );
  await expect(transfer).toContainText("Draft saved");

  const openItems = page.getByLabel("Open items for handover");
  const table = openItems.getByRole("table");
  await expect(table.getByRole("row")).toHaveCount(4);
  await expect(table).toContainText("Filler pressure repeatedly dropping");
  await expect(table).toContainText("Printer restart checks required");
  await expect(table).toContainText("Carton stock below next-hour demand");
  await expect(table).toContainText("Engineering");
  await expect(table).toContainText("Materials");
  await expect(table).toContainText("Due now");
  await expect(table).toContainText("Monitor first 3 runs");
  await expect(table).toContainText("Confirm safe ETA");

  await expect(
    page.getByRole("heading", { name: "Completed this shift" }),
  ).toBeVisible();
  await expect(
    page.getByText(
      "Break 1 moved under approved decision · full 40 minutes",
    ),
  ).toBeVisible();
  await expect(
    page.getByText("Restart checks completed at 09:00"),
  ).toBeVisible();

  await expect(page.getByRole("heading", { name: "Sign-off" })).toBeVisible();
  await expect(page.getByText(/Ready to hand over/)).toBeVisible();
  await expect(
    page.getByText("Owner and next update are required for every open item."),
  ).toBeVisible();
  await expect(page.getByLabel("Handover note")).toBeVisible();
  await expect(page.getByRole("button", { name: "Save draft" })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Review open items" }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Hand over" })).toBeEnabled();

  await expect(page.locator(".toast")).toBeHidden({ timeout: 5000 });

  await page.screenshot({
    path: testInfo.outputPath("team-leader-shift-handover-v2-reference.png"),
    animations: "disabled",
    fullPage: false,
  });
});

test("Save draft keeps a Team Leader note without sending the handover", async ({
  page,
}) => {
  await signInAsTeamLeader(page);
  const workspace = page.locator('aside[aria-label="Team Leader workspace"]');
  await workspace.getByRole("button", { name: "Shift Handover" }).click();

  await page
    .getByLabel("Handover note")
    .fill("Confirm printer stability during the first three runs.");
  await page.getByRole("button", { name: "Save draft" }).click();

  await expect(
    page.getByText("Handover draft saved on this device."),
  ).toBeVisible();
  await expect(page.getByLabel("Handover note")).toHaveValue(
    "Confirm printer stability during the first three runs.",
  );
});
