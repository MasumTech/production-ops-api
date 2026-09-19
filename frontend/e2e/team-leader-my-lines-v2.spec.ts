import { expect, test, type Page, type Route } from "@playwright/test";

const password = process.env.E2E_PASSWORD ?? "";
const operationalDate = process.env.E2E_OPERATIONAL_DATE ?? "2026-09-04";

test.beforeEach(() => {
  test.skip(!password, "Set E2E_PASSWORD to run browser acceptance tests.");
});

async function signIn(page: Page) {
  await page.goto("/");
  await page.getByLabel("Username").fill(
    process.env.DEMO_LEADER_USERNAME ?? "demo.leader",
  );
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("heading", { name: "My Lines" })).toBeVisible();
}

function json(route: Route, body: unknown) {
  return route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify(body),
  });
}

async function installThreeLineReferenceData(page: Page) {
  const assignments = [
    {
      id: 101,
      team_leader: 2,
      team_leader_username: "demo.leader",
      production_line: 1,
      production_line_code: "DEMO-LINE-01",
      production_line_name: "Primary Filling",
      date: operationalDate,
      shift_type: "day",
      notes: "",
    },
    {
      id: 102,
      team_leader: 2,
      team_leader_username: "demo.leader",
      production_line: 2,
      production_line_code: "DEMO-LINE-02",
      production_line_name: "Secondary Packing",
      date: operationalDate,
      shift_type: "day",
      notes: "",
    },
    {
      id: 103,
      team_leader: 2,
      team_leader_username: "demo.leader",
      production_line: 3,
      production_line_code: "DEMO-LINE-03",
      production_line_name: "Prepared Foods",
      date: operationalDate,
      shift_type: "day",
      notes: "",
    },
  ];

  const updates = [
    {
      id: 201,
      assignment: 101,
      production_line: 1,
      production_line_code: "DEMO-LINE-01",
      production_line_name: "Primary Filling",
      status: "green",
      current_product: "Salt & Pepper Chicken",
      issue_summary: "",
      action_taken: "",
      action_owner: null,
      action_owner_username: null,
      support_required: "",
      requires_follow_up: false,
      recorded_at: `${operationalDate}T10:12:00Z`,
      next_update_due_at: `${operationalDate}T18:00:00Z`,
    },
    {
      id: 202,
      assignment: 102,
      production_line: 2,
      production_line_code: "DEMO-LINE-02",
      production_line_name: "Secondary Packing",
      status: "amber",
      current_product: "Oat Milk Chai",
      issue_summary: "Seal concern",
      action_taken: "Machine Minder checking",
      action_owner: null,
      action_owner_username: null,
      support_required: "Engineering",
      requires_follow_up: true,
      recorded_at: `${operationalDate}T10:12:00Z`,
      next_update_due_at: `${operationalDate}T10:20:00Z`,
    },
    {
      id: 203,
      assignment: 103,
      production_line: 3,
      production_line_code: "DEMO-LINE-03",
      production_line_name: "Prepared Foods",
      status: "red",
      current_product: "Vegetable Spring Rolls",
      issue_summary: "Quality hold",
      action_taken: "Product isolated",
      action_owner: null,
      action_owner_username: null,
      support_required: "QA / Operations",
      requires_follow_up: true,
      recorded_at: `${operationalDate}T10:12:00Z`,
      next_update_due_at: `${operationalDate}T10:12:00Z`,
    },
  ];

  const shifts = [
    {
      id: 301,
      production_line: 1,
      production_line_code: "DEMO-LINE-01",
      supervisor: 2,
      supervisor_username: "demo.leader",
      date: operationalDate,
      shift_type: "day",
      start_time: "07:00:00",
      end_time: "18:00:00",
      planned_output: 8400,
      actual_output: 6888,
      downtime_minutes: 4,
      performance_percentage: 82,
    },
    {
      id: 302,
      production_line: 2,
      production_line_code: "DEMO-LINE-02",
      supervisor: 2,
      supervisor_username: "demo.leader",
      date: operationalDate,
      shift_type: "day",
      start_time: "07:00:00",
      end_time: "18:00:00",
      planned_output: 6000,
      actual_output: 4020,
      downtime_minutes: 8,
      performance_percentage: 67,
    },
    {
      id: 303,
      production_line: 3,
      production_line_code: "DEMO-LINE-03",
      supervisor: 2,
      supervisor_username: "demo.leader",
      date: operationalDate,
      shift_type: "day",
      start_time: "07:00:00",
      end_time: "18:00:00",
      planned_output: 6400,
      actual_output: 3450,
      downtime_minutes: 14,
      performance_percentage: 54,
    },
  ];

  await page.route("**/api/team-leader-assignments/my-lines/**", (route) =>
    json(route, assignments),
  );
  await page.route("**/api/hourly-line-updates/latest-status/**", (route) =>
    json(route, updates),
  );
  await page.route("**/api/shifts/**", (route) => json(route, shifts));
  await page.route("**/api/downtime-events/**", (route) => json(route, []));
  await page.route("**/api/daily-plan-blocks/**", (route) => json(route, []));
  await page.route("**/api/product-material-readiness/**", (route) =>
    json(route, []),
  );
  await page.route("**/api/operational-escalations/**", (route) =>
    json(route, []),
  );
  await page.route("**/api/break-opportunities/**", (route) => json(route, []));
  await page.route("**/api/shift-handovers/**", (route) => json(route, []));
  await page.route("**/api/active-users/**", (route) => json(route, []));
}

test("My Lines matches the latest three-card reference", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1586, height: 992 });
  await signIn(page);
  await installThreeLineReferenceData(page);

  await page.getByLabel("Operational date").fill(operationalDate);

  await expect(page.locator(".team-control-card")).toHaveCount(3);
  await expect(page.getByText("3", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("1", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("RED", { exact: true })).toBeVisible();
  await expect(page.getByText("AMBER", { exact: true })).toBeVisible();
  await expect(page.getByText("GREEN", { exact: true })).toBeVisible();
  await expect(page.getByText("STOPPED", { exact: true })).toBeVisible();
  await expect(page.getByText("Running with issues", { exact: true })).toBeVisible();
  await expect(page.getByText("Running to plan", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Quality hold", { exact: true })).toBeVisible();
  await expect(page.getByText("Machine Minder checking", { exact: true })).toBeVisible();
  await expect(page.getByText("QA / Operations · Line contact", { exact: true })).toBeVisible();
  await expect(page.getByText("Engineering · Line contact", { exact: true })).toBeVisible();
  await expect(page.getByText("Due now", { exact: true })).toBeVisible();
  await expect(page.getByText("Due in 8 min", { exact: true })).toBeVisible();
  await expect(page.getByText("Priority:", { exact: true })).toBeVisible();

  await page.waitForTimeout(300);

  await page.screenshot({
    path: testInfo.outputPath("team-leader-my-lines-v2-reference.png"),
    animations: "disabled",
    fullPage: false,
  });
});
