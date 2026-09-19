import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { Assignment, ShiftRecord, WorkspaceData } from "../types";
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

const shifts: ShiftRecord[] = [
  {
    id: 20,
    production_line: 101,
    production_line_code: "DEMO-LINE-01",
    supervisor: 5,
    supervisor_username: "operations.manager",
    date: "2026-09-12",
    shift_type: "day",
    start_time: "07:00:00",
    end_time: "18:00:00",
    planned_output: 8400,
    actual_output: 6888,
    downtime_minutes: 4,
    performance_percentage: 82,
  },
  {
    id: 21,
    production_line: 102,
    production_line_code: "DEMO-LINE-02",
    supervisor: 5,
    supervisor_username: "operations.manager",
    date: "2026-09-12",
    shift_type: "day",
    start_time: "07:00:00",
    end_time: "18:00:00",
    planned_output: 6000,
    actual_output: 4020,
    downtime_minutes: 8,
    performance_percentage: 67,
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
      recorded_at: at(10, 12),
      next_update_due_at: at(18),
    },
    {
      id: 41,
      assignment: 2,
      production_line: 102,
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
      recorded_at: at(10, 12),
      next_update_due_at: at(10, 20),
    },
  ],
  materials: [],
  escalations: [],
  planBlocks: [],
  breakOpportunities: [],
  breaks: [],
  handovers: [],
  users: [],
  shifts,
  downtimeEvents: [],
};

describe("Team Leader My Lines v2", () => {
  it("renders the latest card-based operational control view", () => {
    render(<MyLinesPanel data={data} onRaiseIssue={vi.fn()} />);

    expect(screen.getByRole("heading", { name: "My Lines" })).toBeInTheDocument();
    expect(
      screen.getByText("Current position, ownership and next update"),
    ).toBeInTheDocument();
    expect(document.querySelectorAll(".team-control-card")).toHaveLength(2);
    expect(screen.getByRole("heading", { name: "Line 1" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Line 2" })).toBeInTheDocument();
    expect(screen.getAllByText("Running to plan", { exact: true }).length).toBeGreaterThan(0);
    expect(screen.getByText("Running with issues", { exact: true })).toBeInTheDocument();
    expect(screen.getByText("Seal concern", { exact: true })).toBeInTheDocument();
    expect(screen.getByText("Machine Minder checking", { exact: true })).toBeInTheDocument();
    expect(screen.getByText("Engineering · Line contact", { exact: true })).toBeInTheDocument();
    expect(screen.getByText("Due in 8 min", { exact: true })).toBeInTheDocument();
    expect(screen.getByText("Priority:", { exact: true })).toBeInTheDocument();
    expect(
      screen.queryByText("Today's product timeline", { exact: false }),
    ).not.toBeInTheDocument();
  });

  it("supports a legitimate third line and severity-sorts Red, Amber, Green", () => {
    const thirdAssignment: Assignment = {
      ...assignments[1],
      id: 3,
      production_line: 103,
      production_line_code: "DEMO-LINE-03",
      production_line_name: "Prepared Foods",
    };
    const thirdLineData: WorkspaceData = {
      ...data,
      assignments: [...assignments, thirdAssignment],
      updates: [
        ...data.updates,
        {
          id: 42,
          assignment: 3,
          production_line: 103,
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
          recorded_at: at(10, 12),
          next_update_due_at: at(10, 12),
        },
      ],
      shifts: [
        ...data.shifts,
        {
          ...data.shifts[1],
          id: 22,
          production_line: 103,
          production_line_code: "DEMO-LINE-03",
          planned_output: 6400,
          actual_output: 3450,
          downtime_minutes: 14,
          performance_percentage: 54,
        },
      ],
    };

    render(<MyLinesPanel data={thirdLineData} onRaiseIssue={vi.fn()} />);

    expect(document.querySelectorAll(".team-control-card")).toHaveLength(3);
    expect(screen.getByText("RED", { exact: true })).toBeInTheDocument();
    expect(screen.getByText("AMBER", { exact: true })).toBeInTheDocument();
    expect(screen.getByText("GREEN", { exact: true })).toBeInTheDocument();
    expect(screen.getByText("STOPPED", { exact: true })).toBeInTheDocument();
    expect(screen.getByText("Due now", { exact: true })).toBeInTheDocument();

    const headings = screen.getAllByRole("heading", { level: 2 });
    expect(headings.map((heading) => heading.textContent)).toEqual([
      "Line 3",
      "Line 2",
      "Line 1",
    ]);
  });

  it("routes both page-level and card-level actions to the selected priority line", async () => {
    const onRaiseIssue = vi.fn();
    const actor = userEvent.setup();

    render(<MyLinesPanel data={data} onRaiseIssue={onRaiseIssue} />);

    const updateButtons = screen.getAllByRole("button", { name: "Update line" });
    const issueButtons = screen.getAllByRole("button", { name: "Raise issue" });

    await actor.click(updateButtons[0]);
    expect(onRaiseIssue).toHaveBeenLastCalledWith(assignments[1].id, "update");

    await actor.click(issueButtons[0]);
    expect(onRaiseIssue).toHaveBeenLastCalledWith(assignments[1].id, "escalation");

    await actor.click(updateButtons[1]);
    expect(onRaiseIssue).toHaveBeenLastCalledWith(assignments[1].id, "update");
  });
});
