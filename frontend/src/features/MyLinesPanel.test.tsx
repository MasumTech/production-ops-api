import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type {
  Assignment,
  DailyPlanBlock,
  DowntimeEvent,
  ShiftRecord,
  WorkspaceData,
} from "../types";
import { MyLinesPanel } from "./MyLinesPanel";

const assignments: Assignment[] = [
  {
    id: 1,
    team_leader: 10,
    team_leader_username: "demo.leader",
    production_line: 101,
    production_line_code: "DEMO-LINE-01",
    production_line_name: "Primary Filling",
    date: "2026-09-12",
    shift_type: "day",
    notes: "",
  },
  {
    id: 2,
    team_leader: 10,
    team_leader_username: "demo.leader",
    production_line: 102,
    production_line_code: "DEMO-LINE-02",
    production_line_name: "Secondary Packing",
    date: "2026-09-12",
    shift_type: "day",
    notes: "",
  },
];

function at(hour: number, minute = 0): string {
  return `2026-09-12T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00Z`;
}

function displayTime(value: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(value));
}

function linePlan(
  assignment: Assignment,
  product: string,
  breakOne: [number, number],
  breakTwo: [number, number],
): DailyPlanBlock[] {
  const breakOneStart = breakOne[0] * 60 + breakOne[1];
  const breakTwoStart = breakTwo[0] * 60 + breakTwo[1];
  const fromMinutes = (value: number) => at(Math.floor(value / 60), value % 60);
  const definitions: Array<[DailyPlanBlock["block_type"], number, number, number | null]> = [
    ["production", 7 * 60, breakOneStart, null],
    ["break", breakOneStart, breakOneStart + 40, 1],
    ["production", breakOneStart + 40, breakTwoStart, null],
    ["break", breakTwoStart, breakTwoStart + 40, 2],
    ["production", breakTwoStart + 40, 18 * 60, null],
  ];

  return definitions.map(([blockType, start, end, breakNumber], index) => ({
    id: assignment.id * 10 + index,
    assignment: assignment.id,
    assignment_date: assignment.date,
    production_line: assignment.production_line,
    production_line_code: assignment.production_line_code,
    sequence_number: index + 1,
    block_type: blockType,
    planned_start_at: fromMinutes(start),
    planned_end_at: fromMinutes(end),
    product_code: blockType === "production" ? `PRODUCT-${assignment.id}` : "",
    product_name: blockType === "production" ? product : "",
    target_units_per_hour: blockType === "production" ? 840 : null,
    planned_units: blockType === "production" ? 1000 : 0,
    break_number: breakNumber,
  }));
}

const shifts: ShiftRecord[] = [
  {
    id: 20,
    production_line: 101,
    production_line_code: "DEMO-LINE-01",
    supervisor: 5,
    supervisor_username: "operations.manager",
    date: "2026-09-12",
    shift_type: "day",
    planned_output: 8400,
    actual_output: 4980,
    downtime_minutes: 12,
    performance_percentage: 59,
  },
  {
    id: 21,
    production_line: 102,
    production_line_code: "DEMO-LINE-02",
    supervisor: 5,
    supervisor_username: "operations.manager",
    date: "2026-09-12",
    shift_type: "day",
    planned_output: 6000,
    actual_output: 2760,
    downtime_minutes: 8,
    performance_percentage: 46,
  },
];

const downtimeEvents: DowntimeEvent[] = [
  {
    id: 30,
    shift: 20,
    production_line: 101,
    production_line_code: "DEMO-LINE-01",
    shift_date: "2026-09-12",
    started_at: at(8, 5),
    ended_at: at(8, 17),
    duration_minutes: 12,
    reason_category: "equipment",
    description: "Filler sensor reset",
    owner_group: "engineering",
    status: "resolved",
    resolution_note: "Line restarted",
  },
  {
    id: 31,
    shift: 21,
    production_line: 102,
    production_line_code: "DEMO-LINE-02",
    shift_date: "2026-09-12",
    started_at: at(9, 12),
    ended_at: at(9, 20),
    duration_minutes: 8,
    reason_category: "material",
    description: "Carton replenishment",
    owner_group: "operations",
    status: "resolved",
    resolution_note: "Stock restored",
  },
];

const data: WorkspaceData = {
  assignments,
  updates: [
    {
      id: 40,
      assignment: 1,
      production_line: 101,
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
      recorded_at: at(16),
      next_update_due_at: at(17),
    },
    {
      id: 41,
      assignment: 2,
      production_line: 102,
      production_line_code: "DEMO-LINE-02",
      production_line_name: "Secondary Packing",
      status: "amber",
      current_product: "Oat Milk Chai",
      issue_summary: "Carton stock running low",
      action_taken: "Replenishment requested",
      action_owner: null,
      action_owner_username: null,
      support_required: "Operations",
      requires_follow_up: true,
      recorded_at: at(16, 10),
      next_update_due_at: at(17, 10),
    },
  ],
  materials: [],
  escalations: [],
  planBlocks: [
    ...linePlan(assignments[0], "Salt & Pepper Chicken", [11, 20], [15, 20]),
    ...linePlan(assignments[1], "Oat Milk Chai", [10, 40], [14, 40]),
  ],
  breakOpportunities: [],
  breaks: [],
  handovers: [],
  users: [],
  shifts,
  downtimeEvents,
};

describe("Team Leader My Lines reference board", () => {
  it("renders two production cards, reference metrics, status and planned breaks", () => {
    render(<MyLinesPanel data={data} onRaiseIssue={vi.fn()} onNavigate={vi.fn()} />);

    expect(screen.getByRole("heading", { name: "My lines" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Line 1" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Line 2" })).toBeInTheDocument();
    expect(screen.getAllByText("Salt & Pepper Chicken").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Oat Milk Chai").length).toBeGreaterThan(0);
    expect(screen.getByText("On track")).toBeInTheDocument();
    expect(screen.getByText("Behind plan")).toBeInTheDocument();
    expect(screen.getByText("8,400")).toBeInTheDocument();
    expect(screen.getByText("6,000")).toBeInTheDocument();
    expect(screen.getAllByText("Break")).toHaveLength(4);
    expect(screen.getByRole("button", { name: "12 min downtime" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "8 min downtime" })).toBeInTheDocument();
  });

  it("opens the eleven-hour downtime evidence with a short description and functional owner", async () => {
    const actor = userEvent.setup();
    render(<MyLinesPanel data={data} onRaiseIssue={vi.fn()} onNavigate={vi.fn()} />);

    await actor.click(screen.getByRole("button", { name: "12 min downtime" }));

    expect(screen.getByRole("heading", { name: "Hourly downtime · Line 1" }))
      .toBeInTheDocument();
    expect(screen.getByText("Filler sensor reset")).toBeInTheDocument();
    expect(screen.getByText(`${displayTime(at(8, 5))}–${displayTime(at(8, 17))}`))
      .toBeInTheDocument();
    expect(screen.getByText("Engineering · Resolved")).toBeInTheDocument();
    expect(screen.getAllByText("No recorded loss")).toHaveLength(10);
    expect(screen.getByText("Planned breaks are excluded from recorded loss."))
      .toBeInTheDocument();
  });

  it("routes all four quick actions through the existing workflows", async () => {
    const onRaiseIssue = vi.fn();
    const onNavigate = vi.fn();
    const actor = userEvent.setup();
    render(
      <MyLinesPanel
        data={data}
        onRaiseIssue={onRaiseIssue}
        onNavigate={onNavigate}
      />,
    );

    await actor.click(screen.getByRole("button", { name: "Update line" }));
    await actor.click(screen.getByRole("button", { name: "Raise issue" }));
    await actor.click(screen.getByRole("button", { name: "Material problem" }));
    await actor.click(screen.getByRole("button", { name: "Handover" }));

    expect(onRaiseIssue).toHaveBeenNthCalledWith(1, assignments[0].id);
    expect(onRaiseIssue).toHaveBeenNthCalledWith(2, assignments[1].id);
    expect(onNavigate).toHaveBeenNthCalledWith(1, "materials");
    expect(onNavigate).toHaveBeenNthCalledWith(2, "handover");
  });
});
