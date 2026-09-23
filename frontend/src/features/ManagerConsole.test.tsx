import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as api from "../api";
import { localDate } from "../format";
import type {
  Assignment,
  LineUpdate,
  ManagerWorkspaceData,
  UserSummary,
} from "../types";
import {
  buildManagerPriorities,
  buildManagerRows,
  ManagerConsole,
} from "./ManagerConsole";

const profile: UserSummary = {
  id: 1,
  username: "operations.manager",
  display_name: "Operations Manager",
  is_staff: true,
  workspace: "manager",
};

const assignments: Assignment[] = [
  {
    id: 1,
    team_leader: 11,
    team_leader_username: "lead.one",
    production_line: 101,
    production_line_code: "LINE-01",
    production_line_name: "Primary Packing",
    date: "2026-09-01",
    shift_type: "day",
    notes: "",
  },
  {
    id: 2,
    team_leader: 12,
    team_leader_username: "lead.two",
    production_line: 102,
    production_line_code: "LINE-02",
    production_line_name: "Ready Meals",
    date: "2026-09-01",
    shift_type: "day",
    notes: "",
  },
];

const updates: LineUpdate[] = [
  {
    id: 10,
    assignment: 1,
    production_line: 101,
    production_line_code: "LINE-01",
    production_line_name: "Primary Packing",
    status: "green",
    current_product: "Product A",
    issue_summary: "",
    action_taken: "",
    action_owner: null,
    action_owner_username: null,
    support_required: "",
    requires_follow_up: false,
    recorded_at: "2026-09-01T09:30:00Z",
    next_update_due_at: "2026-09-01T11:00:00Z",
  },
  {
    id: 11,
    assignment: 2,
    production_line: 102,
    production_line_code: "LINE-02",
    production_line_name: "Ready Meals",
    status: "red",
    current_product: "Product B",
    issue_summary: "Filler stopped",
    action_taken: "Engineering called",
    action_owner: 19,
    action_owner_username: "engineer.one",
    support_required: "Engineering",
    requires_follow_up: true,
    recorded_at: "2026-09-01T08:00:00Z",
    next_update_due_at: "2026-09-01T08:30:00Z",
  },
];

const data: ManagerWorkspaceData = {
  assignments,
  updates,
  materials: [
    {
      id: 20,
      assignment: 2,
      production_line: 102,
      production_line_code: "LINE-02",
      sequence_number: 1,
      product_code: "PROD-B",
      product_name: "Product B",
      planned_quantity: 1000,
      status: "short",
      shortage_quantity: 200,
      owner: 21,
      owner_username: "materials.owner",
      expected_available_at: "2026-09-01T10:30:00Z",
      needed_by_at: "2026-09-01T09:45:00Z",
      hold_reason: "",
      notes: "",
    },
  ],
  escalations: [
    {
      id: 30,
      assignment: 2,
      production_line: 102,
      production_line_code: "LINE-02",
      asset: null,
      asset_code: null,
      asset_name: null,
      loss_minutes: 0,
      estimated_lost_units: 0,
      category: "equipment",
      priority: "critical",
      status: "open",
      summary: "Filler stopped",
      details: "",
      immediate_action: "Line made safe",
      owner: 19,
      owner_username: "engineer.one",
      response_due_at: "2026-09-01T08:20:00Z",
      is_overdue: true,
      needs_attention: true,
    },
  ],
  shifts: [
    {
      id: 40,
      production_line: 102,
      production_line_code: "LINE-02",
      supervisor: 1,
      supervisor_username: "operations.manager",
      date: "2026-09-01",
      shift_type: "day",
      planned_output: 5000,
      actual_output: 3200,
      downtime_minutes: 45,
      performance_percentage: 64,
    },
  ],
  downtimeEvents: [
    {
      id: 1,
      shift: 40,
      production_line: 102,
      production_line_code: "LINE-02",
      shift_date: "2026-09-01",
      started_at: "2026-09-01T08:05:00Z",
      ended_at: "2026-09-01T08:17:00Z",
      duration_minutes: 12,
      reason_category: "equipment",
      description: "Filler sensor reset",
      owner_group: "engineering",
      status: "resolved",
      resolution_note: "Line restarted",
    },
  ],
  summary: {
    total_shifts: 1,
    total_planned_output: 5000,
    total_actual_output: 3200,
    overall_performance_percentage: 64,
    total_downtime_minutes: 45,
    open_incidents: 1,
    critical_incidents: 1,
  },
};

afterEach(() => {
  vi.restoreAllMocks();
});

beforeEach(() => {
  vi.spyOn(api, "apiRequest").mockResolvedValue({
    unread_count: 0,
    results: [],
  } as never);
});

describe("manager console", () => {
  it("sorts urgent lines ahead of stable lines", () => {
    const rows = buildManagerRows(
      data,
      "day",
      new Date("2026-09-01T10:00:00Z").getTime(),
    );

    expect(
      rows.map(
        (row) => row.assignment.production_line_code,
      ),
    ).toEqual([
      "LINE-02",
      "LINE-01",
    ]);

    expect(rows[0].attentionLevel).toBe("urgent");
    expect(rows[0].isLate).toBe(true);
    expect(rows[1].attentionLevel).toBe("stable");
  });

  it("builds rows only for the selected shift", () => {
    const nightAssignment: Assignment = {
      ...assignments[0],
      id: 3,
      production_line: 103,
      production_line_code: "LINE-03",
      production_line_name: "Night Packing",
      shift_type: "night",
    };

    const rows = buildManagerRows(
      {
        ...data,
        assignments: [...assignments, nightAssignment],
      },
      "night",
    );

    expect(rows.map((row) => row.assignment.production_line_code)).toEqual([
      "LINE-03",
    ]);
  });

  it("builds priorities from real issues and exposes missing updates", () => {
    const issueRows = buildManagerRows(
      {
        ...data,
        updates: [updates[1]],
      },
      "day",
      new Date("2026-09-01T10:00:00Z").getTime(),
    );

    expect(buildManagerPriorities(issueRows)).toEqual([
      expect.objectContaining({
        title: "Line 2: Filler stopped",
        detail: "Line made safe",
      }),
      expect.objectContaining({
        title: "Line 2: Product B short",
      }),
      expect.objectContaining({
        title: "Line 1: status update missing",
        detail: "No update recorded for the Day shift.",
      }),
    ]);
  });

  it("shows the overview and the shared manager shell", async () => {
    const actor = userEvent.setup();
    const onShiftPatternChange = vi.fn();
    render(
      <ManagerConsole
        profile={profile}
        data={data}
        operationalDate="2026-09-01"
        shiftPattern="day"
        lastUpdatedAt="2026-09-01T10:00:00Z"
        online
        liveState="live"
        busy={false}
        error=""
        onDateChange={vi.fn()}
        onShiftPatternChange={onShiftPatternChange}
        onRefresh={vi.fn()}
        onSignOut={vi.fn()}
      />,
    );

    expect(
      screen.getByRole("heading", {
        name: "Before-shift and live overview",
      }),
    ).toBeInTheDocument();

    const summary = screen.getByRole("region", {
      name: "Operational summary",
    });
    expect(summary.querySelectorAll(".control-kpi")).toHaveLength(4);
    expect(summary.querySelectorAll(".app-icon")).toHaveLength(4);

    expect(
      within(summary).getByText("64%"),
    ).toBeInTheDocument();

    expect(
      within(summary).getByText("45 min"),
    ).toBeInTheDocument();

    const attention = screen.getByRole("region", { name: "Attention summary" });
    expect(within(attention).getByText("1 critical issue")).toBeInTheDocument();
    expect(within(attention).getByText("1 material risk")).toBeInTheDocument();
    expect(within(attention).getByText("1 open action")).toBeInTheDocument();
    expect(within(attention).getByText("0 missing updates")).toBeInTheDocument();

    const priorities = screen.getByRole("heading", { name: "Suggested priorities" }).closest("section");
    expect(priorities).not.toBeNull();
    expect(within(priorities as HTMLElement).getByText("Line 2: Filler stopped")).toBeInTheDocument();
    expect(within(priorities as HTMLElement).getByText("Line made safe")).toBeInTheDocument();
    expect(within(priorities as HTMLElement).queryByText(/conveyor reset/i)).not.toBeInTheDocument();

    const coverage = screen.getByRole("region", { name: "Team Leaders and production lines" });
    expect(within(coverage).getByText("Team Leader 1")).toBeInTheDocument();
    expect(within(coverage).getByText("Team Leader 2")).toBeInTheDocument();
    expect(within(coverage).getByText("Line 1")).toBeInTheDocument();
    expect(within(coverage).getByText("Line 2")).toBeInTheDocument();
    expect(within(coverage).queryByText("lead.one")).not.toBeInTheDocument();

    await userEvent.click(within(coverage).getByRole("button", { name: "12 min downtime" }));
    expect(screen.getByText("Filler sensor reset")).toBeInTheDocument();

    expect(
      within(screen.getByRole("navigation", { name: "Manager sections" })).getByRole(
        "button",
        { name: "Overview", current: "page" },
      ),
    ).toBeInTheDocument();

    const controls = screen.getByLabelText("Workspace controls");
    expect(within(controls).getByLabelText("Operational date")).toHaveValue("2026-09-01");
    expect(within(controls).getByLabelText("Shift pattern")).toHaveValue("day");
    expect(within(controls).getByRole("button", { name: "Historical" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(within(controls).getByRole("button", { name: "Refresh" })).toBeInTheDocument();
    expect(
      within(controls).getByRole("button", { name: "Alerts" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Open navigation" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("group", { name: "Data view" }),
    ).toBeInTheDocument();

    await actor.selectOptions(within(controls).getByLabelText("Shift pattern"), "night");
    expect(onShiftPatternChange).toHaveBeenCalledWith("night");

    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Daily risk briefing" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Loss and asset history" })).not.toBeInTheDocument();
  });

  it("switches between focused manager workspaces", async () => {
    const actor = userEvent.setup();
    vi.spyOn(api, "apiRequest").mockRejectedValue(new Error("Analytics unavailable."));

    render(
      <ManagerConsole
        profile={profile}
        data={data}
        operationalDate="2026-09-01"
        shiftPattern="day"
        lastUpdatedAt="2026-09-01T10:00:00Z"
        online
        liveState="live"
        busy={false}
        error=""
        onDateChange={vi.fn()}
        onShiftPatternChange={vi.fn()}
        onRefresh={vi.fn()}
        onSignOut={vi.fn()}
      />,
    );

    const navigation = screen.getByRole("navigation", { name: "Manager sections" });

    await actor.click(within(navigation).getByRole("button", { name: "Team Leaders" }));
    expect(screen.getByRole("heading", { name: "Team Leaders & line control" })).toBeInTheDocument();
    const table = screen.getByRole("table");
    expect(within(table).getByText("Stopped")).toBeInTheDocument();
    expect(within(table).getByText("64%")).toBeInTheDocument();

    await actor.click(within(navigation).getByRole("button", { name: "Daily plans" }));
    expect(screen.getByRole("heading", { name: "Daily plans" })).toBeInTheDocument();
    expect(screen.getByLabelText("Filter daily plans by line")).toBeInTheDocument();
    expect(screen.getByLabelText("Filter daily plans by Team Leader")).toBeInTheDocument();
    expect(screen.getByText("Read-only snapshot")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add plan block" })).not.toBeInTheDocument();
    expect(screen.getByText("Full-day completion")).toBeInTheDocument();
    expect(screen.getByText("Position now")).toBeInTheDocument();

    await actor.click(within(navigation).getByRole("button", { name: "Materials" }));
    expect(screen.getByRole("heading", { name: "Materials & actions" })).toBeInTheDocument();
    const time = (value: string) => new Intl.DateTimeFormat("en-GB", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(new Date(value));
    const materialsTable = screen.getByRole("table");
    expect(materialsTable).toHaveTextContent(time("2026-09-01T09:45:00Z"));
    expect(materialsTable).toHaveTextContent(`ETA ${time("2026-09-01T10:30:00Z")}`);
    expect(screen.getByRole("tab", { name: /Materials/ })).toBeInTheDocument();
    await actor.click(screen.getByRole("tab", { name: /Open actions/ }));
    expect(screen.getByRole("heading", { name: "Open actions" })).toBeInTheDocument();

    await actor.click(within(navigation).getByRole("button", { name: "Risk briefing" }));
    expect(screen.getByRole("heading", { name: "AI Daily Risk Briefing" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Briefing cockpit" })).toBeInTheDocument();

    await actor.click(within(navigation).getByRole("button", { name: "Break recovery" }));
    expect(screen.getByRole("heading", { name: "Break recovery & loss history" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Recovery activity" })).toBeInTheDocument();
    await actor.click(screen.getByRole("tab", { name: "Loss & asset history" }));
    expect(screen.getByRole("heading", { name: "Loss and asset history" })).toBeInTheDocument();
  });

  it("lets a manager edit downtime evidence and add a comment from the line drawer", async () => {
    const actor = userEvent.setup();
    const onRefresh = vi.fn();
    const request = vi.mocked(api.apiRequest);
    request.mockResolvedValue({} as never);

    render(
      <ManagerConsole
        profile={profile}
        data={data}
        operationalDate="2026-09-01"
        shiftPattern="day"
        lastUpdatedAt="2026-09-01T10:00:00Z"
        online
        liveState="live"
        busy={false}
        error=""
        onDateChange={vi.fn()}
        onShiftPatternChange={vi.fn()}
        onRefresh={onRefresh}
        onSignOut={vi.fn()}
      />,
    );

    await actor.click(within(screen.getByRole("navigation", { name: "Manager sections" })).getByRole("button", { name: "Team Leaders" }));
    await actor.click(screen.getByLabelText("Open details for LINE-02"));
    await actor.click(screen.getByRole("button", { name: /Filler sensor reset/ }));

    const dialog = screen.getByRole("dialog", { name: "Edit downtime & description" });
    await actor.clear(within(dialog).getByLabelText("Description"));
    await actor.type(within(dialog).getByLabelText("Description"), "Verified filler sensor reset");
    await actor.type(within(dialog).getByLabelText("Manager comment"), "Checked against engineering log");
    await actor.click(within(dialog).getByRole("button", { name: "Review & save" }));

    expect(request).toHaveBeenCalledWith("/downtime-events/1/", expect.objectContaining({ method: "PATCH" }));
    expect(onRefresh).toHaveBeenCalled();
  });

  it("adds and edits plan blocks for the current operational date", async () => {
    const actor = userEvent.setup();
    const request = vi.mocked(api.apiRequest);
    request.mockResolvedValue({} as never);
    const today = localDate();
    const planBlock = {
      id: 70,
      assignment: 1,
      assignment_date: today,
      production_line: 101,
      production_line_code: "LINE-01",
      sequence_number: 1,
      block_type: "production" as const,
      planned_start_at: `${today}T07:00:00Z`,
      planned_end_at: `${today}T09:00:00Z`,
      product_code: "PROD-A",
      product_name: "Product A",
      target_units_per_hour: 100,
      planned_units: 200,
      break_number: null,
    };

    render(
      <ManagerConsole
        profile={profile}
        data={{ ...data, planBlocks: [planBlock] }}
        operationalDate={today}
        shiftPattern="day"
        lastUpdatedAt={`${today}T10:00:00Z`}
        online
        liveState="live"
        busy={false}
        error=""
        onDateChange={vi.fn()}
        onShiftPatternChange={vi.fn()}
        onRefresh={vi.fn()}
        onSignOut={vi.fn()}
      />,
    );

    await actor.click(within(screen.getByRole("navigation", { name: "Manager sections" })).getByRole("button", { name: "Daily plans" }));
    await actor.click(screen.getByRole("button", { name: "Add plan block" }));
    const addDialog = screen.getByRole("dialog", { name: "Add plan block" });
    await actor.type(within(addDialog).getByLabelText("Product code"), "NEW-01");
    await actor.type(within(addDialog).getByLabelText("Product name"), "New product");
    await actor.type(within(addDialog).getByLabelText("Target units / hour"), "120");
    await actor.click(within(addDialog).getByRole("button", { name: "Add block" }));
    expect(request).toHaveBeenCalledWith("/daily-plan-blocks/", expect.objectContaining({ method: "POST" }));

    await actor.click(screen.getByRole("button", { name: /Product A/ }));
    await actor.click(screen.getByRole("button", { name: "Edit block" }));
    const editDialog = screen.getByRole("dialog", { name: "Edit plan block" });
    await actor.clear(within(editDialog).getByLabelText("Product name"));
    await actor.type(within(editDialog).getByLabelText("Product name"), "Product A revised");
    await actor.click(within(editDialog).getByRole("button", { name: "Save changes" }));
    expect(request).toHaveBeenCalledWith("/daily-plan-blocks/70/", expect.objectContaining({ method: "PATCH" }));
  });

  it("filters the board to late or missing updates", async () => {
    const actor = userEvent.setup();

    const currentUpdate: LineUpdate = {
      ...updates[0],
      next_update_due_at: new Date(
        Date.now() + 60 * 60 * 1000,
      ).toISOString(),
    };

    render(
      <ManagerConsole
        profile={profile}
        data={{
          ...data,
          updates: [currentUpdate],
        }}
        operationalDate="2026-09-01"
        shiftPattern="day"
        lastUpdatedAt="2026-09-01T10:00:00Z"
        online
        liveState="live"
        busy={false}
        error=""
        onDateChange={vi.fn()}
        onShiftPatternChange={vi.fn()}
        onRefresh={vi.fn()}
        onSignOut={vi.fn()}
      />,
    );

    await actor.click(
      within(screen.getByRole("navigation", { name: "Manager sections" })).getByRole(
        "button",
        { name: "Team Leaders" },
      ),
    );

    await actor.click(
      screen.getByRole("button", {
        name: /Needs attention/,
      }),
    );

    const priorityBoard = screen
      .getByRole("heading", {
        name: "Team Leaders and line control table",
      })
      .closest("section");

    expect(priorityBoard).not.toBeNull();

    const table = within(
      priorityBoard as HTMLElement,
    ).getByRole("table");

    expect(
      within(table).getByText("Line 2"),
    ).toBeInTheDocument();

    expect(
      within(table).queryByText("Line 1"),
    ).not.toBeInTheDocument();
  });
});
