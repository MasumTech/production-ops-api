import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import * as api from "../api";
import type {
  Assignment,
  LineUpdate,
  ManagerWorkspaceData,
  UserSummary,
} from "../types";
import {
  buildManagerRows,
  ManagerConsole,
} from "./ManagerConsole";

const profile: UserSummary = {
  id: 1,
  username: "operations.manager",
  display_name: "Operations Manager",
  is_staff: true,
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

describe("manager console", () => {
  it("sorts urgent lines ahead of stable lines", () => {
    const rows = buildManagerRows(
      data,
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

  it("shows the overview and matching desktop and mobile navigation", () => {
    render(
      <ManagerConsole
        profile={profile}
        data={data}
        operationalDate="2026-09-01"
        lastUpdatedAt="2026-09-01T10:00:00Z"
        online
        liveState="live"
        busy={false}
        error=""
        onDateChange={vi.fn()}
        onRefresh={vi.fn()}
        onSignOut={vi.fn()}
      />,
    );

    expect(
      screen.getByRole("heading", {
        name: "Live Floor priority board",
      }),
    ).toBeInTheDocument();

    const summary = screen.getByRole("region", {
      name: "Operational summary",
    });

    expect(
      within(summary).getByText("3,200 / 5,000"),
    ).toBeInTheDocument();

    expect(
      within(summary).getByText("1 overdue"),
    ).toBeInTheDocument();

    expect(
      within(screen.getByRole("navigation", { name: "Manager sections" })).getByRole(
        "button",
        { name: "Overview", current: "page" },
      ),
    ).toBeInTheDocument();

    expect(
      within(
        screen.getByRole("navigation", { name: "Operations Manager mobile workspace" }),
      ).getAllByRole("button"),
    ).toHaveLength(5);

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
        lastUpdatedAt="2026-09-01T10:00:00Z"
        online
        liveState="live"
        busy={false}
        error=""
        onDateChange={vi.fn()}
        onRefresh={vi.fn()}
        onSignOut={vi.fn()}
      />,
    );

    const navigation = screen.getByRole("navigation", { name: "Manager sections" });

    await actor.click(within(navigation).getByRole("button", { name: "Line Control" }));
    expect(screen.getByRole("heading", { name: "Line Control" })).toBeInTheDocument();
    const table = screen.getByRole("table");
    expect(within(table).getByText("Lead: lead.two")).toBeInTheDocument();
    expect(within(table).getAllByText("Filler stopped")).toHaveLength(2);

    await actor.click(within(navigation).getByRole("button", { name: "Actions & Materials" }));
    expect(screen.getByRole("heading", { name: "Actions and materials" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Open actions" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Material risks" })).toBeInTheDocument();

    await actor.click(within(navigation).getByRole("button", { name: "Risk Briefing" }));
    expect(screen.getByRole("heading", { name: "Risk Briefing" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Daily risk briefing" })).toBeInTheDocument();

    await actor.click(within(navigation).getByRole("button", { name: "Loss Analytics" }));
    expect(screen.getByRole("heading", { name: "Loss Analytics" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Loss and asset history" })).toBeInTheDocument();
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
        lastUpdatedAt="2026-09-01T10:00:00Z"
        online
        liveState="live"
        busy={false}
        error=""
        onDateChange={vi.fn()}
        onRefresh={vi.fn()}
        onSignOut={vi.fn()}
      />,
    );

    await actor.click(
      within(screen.getByRole("navigation", { name: "Manager sections" })).getByRole(
        "button",
        { name: "Line Control" },
      ),
    );

    await actor.click(
      screen.getByRole("button", {
        name: "Late",
      }),
    );

    const priorityBoard = screen
      .getByRole("heading", {
        name: "All-line control view",
      })
      .closest("section");

    expect(priorityBoard).not.toBeNull();

    const table = within(
      priorityBoard as HTMLElement,
    ).getByRole("table");

    expect(
      within(table).getByText("LINE-02"),
    ).toBeInTheDocument();

    expect(
      within(table).queryByText("LINE-01"),
    ).not.toBeInTheDocument();
  });
});
