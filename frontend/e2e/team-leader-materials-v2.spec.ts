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

test("Materials matches the approved readiness reference", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1536, height: 992 });
  await signInAsTeamLeader(page);

  const workspace = page.locator('aside[aria-label="Team Leader workspace"]');
  await workspace.getByRole("button", { name: "Materials" }).click();

  await expect(page.getByRole("heading", { name: "Materials" })).toBeVisible();
  await expect(
    page.getByText(
      "Readiness, shortages, holds and safe expected times for assigned lines",
    ),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Add item" })).toBeVisible();
  await expect(page.getByLabel("Filter by assigned line")).toHaveValue("all");
  await expect(page.getByLabel("Filter by material status")).toHaveValue("all");
  await expect(page.getByLabel("Search product or material")).toBeVisible();

  const table = page.getByRole("table");
  await expect(table.getByRole("row")).toHaveCount(5);

  const readyRow = table.getByRole("row", { name: /Salt & Pepper Chicken/i });
  const inProcessRow = table.getByRole("row", { name: /Sweet & Sour Chicken/i });
  const shortRow = table.getByRole("row", { name: /Oat Milk Chai/i });
  const heldRow = table.getByRole("row", { name: /BBQ Chicken Bites/i });

  await expect(readyRow).toContainText("Line 1");
  await expect(readyRow).toContainText("09:00");
  await expect(readyRow).toContainText("READY");
  await expect(readyRow).toContainText("Operations");
  await expect(readyRow).toContainText("Available");

  await expect(inProcessRow).toContainText("12:00");
  await expect(inProcessRow).toContainText("IN PROCESS");
  await expect(inProcessRow).toContainText("120 kg");
  await expect(inProcessRow).toContainText("Batcher");
  await expect(inProcessRow).toContainText("ETA 11:30");

  await expect(shortRow).toContainText("Line 2");
  await expect(shortRow).toContainText("10:30");
  await expect(shortRow).toContainText("SHORT");
  await expect(shortRow).toContainText("640 packs");
  await expect(shortRow).toContainText("Materials");
  await expect(shortRow).toContainText("Decision due 10:20");

  await expect(heldRow).toContainText("14:00");
  await expect(heldRow).toContainText("HELD");
  await expect(heldRow).toContainText("QA label release");
  await expect(heldRow).toContainText("QA");
  await expect(heldRow).toContainText("Do not use");

  const detail = page.getByLabel("Selected material details");
  await expect(detail).toContainText("Oat Milk Chai · Line 2");
  await expect(detail).toContainText("640 packs short");
  await expect(detail).toContainText("Needed by 10:30");
  await expect(detail).toContainText("Responsible: Materials");
  await expect(detail).toContainText("Next action: Confirm replenishment");
  await expect(detail).toContainText("Carton stock below next-hour demand.");
  await expect(
    detail.getByRole("button", { name: "Update status" }),
  ).toBeVisible();
  await expect(
    detail.getByRole("button", { name: "Raise material issue" }),
  ).toBeVisible();
  await expect(detail).toContainText(
    "Team Leaders cannot release held product.",
  );

  await page.screenshot({
    path: testInfo.outputPath("team-leader-materials-v2-reference.png"),
    animations: "disabled",
    fullPage: false,
  });
});

test("Materials filters keep the selected operational view useful", async ({
  page,
}) => {
  await signInAsTeamLeader(page);
  const workspace = page.locator('aside[aria-label="Team Leader workspace"]');
  await workspace.getByRole("button", { name: "Materials" }).click();

  await page.getByLabel("Filter by material status").selectOption("held");
  await expect(page.getByRole("row", { name: /BBQ Chicken Bites/i })).toBeVisible();
  await expect(page.getByRole("row", { name: /Oat Milk Chai/i })).toHaveCount(0);

  await page.getByLabel("Filter by material status").selectOption("all");
  await page.getByLabel("Search product or material").fill("oat");
  await expect(page.getByRole("row", { name: /Oat Milk Chai/i })).toBeVisible();
  await expect(
    page.getByRole("row", { name: /Salt & Pepper Chicken/i }),
  ).toHaveCount(0);
});
