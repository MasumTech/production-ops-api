import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import * as api from "../api";
import type { Assignment, BreakOpportunity, DailyPlanBlock } from "../types";
import { BreakRecoveryPanel } from "./BreakRecoveryPanel";
import { DailyPlanPanel } from "./DailyPlanPanel";

const assignment: Assignment = {
  id: 7,
  team_leader: 2,
  team_leader_username: "team.leader",
  production_line: 3,
  production_line_code: "LINE-03",
  production_line_name: "Ready Meals",
  date: "2026-09-04",
  shift_type: "day",
  notes: "",
};

const planBlocks: DailyPlanBlock[] = [
  {
    id: 1,
    assignment: assignment.id,
    assignment_date: assignment.date,
    production_line: assignment.production_line,
    production_line_code: assignment.production_line_code,
    sequence_number: 1,
    block_type: "production",
    planned_start_at: "2026-09-04T07:00:00Z",
    planned_end_at: "2026-09-04T09:00:00Z",
    product_code: "SPC-01",
    product_name: "Salt & Pepper Chicken",
    target_units_per_hour: 24,
    planned_units: 48,
    break_number: null,
  },
  {
    id: 2,
    assignment: assignment.id,
    assignment_date: assignment.date,
    production_line: assignment.production_line,
    production_line_code: assignment.production_line_code,
    sequence_number: 2,
    block_type: "break",
    planned_start_at: "2026-09-04T09:00:00Z",
    planned_end_at: "2026-09-04T09:40:00Z",
    product_code: "",
    product_name: "",
    target_units_per_hour: null,
    planned_units: 0,
    break_number: 1,
  },
];

const opportunity: BreakOpportunity = {
  id: 13,
  assignment: assignment.id,
  production_line: assignment.production_line,
  production_line_code: assignment.production_line_code,
  break_block: 2,
  break_number: 1,
  source_update: 22,
  issue_summary: "Filler stopped",
  status: "suggested",
  fault_at: "2026-09-04T08:05:00Z",
  suggested_start_at: "2026-09-04T08:10:00Z",
  expected_return_at: "2026-09-04T08:50:00Z",
  confirmed_at: null,
  returned_at: null,
  checks_completed_at: null,
  run_resumed_at: null,
  recovery_notes: "",
  declined_at: null,
  decline_reason: "",
};

afterEach(() => vi.restoreAllMocks());

describe("daily plan and break opportunity workspace", () => {
  it("uses the configured weekday shift time in the plan heading", () => {
    render(
      <DailyPlanPanel
        assignments={[{ ...assignment, date: "2026-09-14" }]}
        planBlocks={planBlocks}
        shifts={[
          {
            id: 90,
            production_line: assignment.production_line,
            production_line_code: assignment.production_line_code,
            supervisor: 1,
            supervisor_username: "operations.manager",
            date: "2026-09-14",
            shift_type: "day",
            start_time: "06:45:00",
            end_time: "18:00:00",
            planned_output: 0,
            actual_output: 0,
            downtime_minutes: 0,
            performance_percentage: null,
          },
        ]}
      />,
    );

    expect(screen.getByText("06:45–18:00 day shift")).toBeInTheDocument();
    expect(screen.queryByLabelText("Daily plan summary")).not.toBeInTheDocument();
  });

  it("shows the time-based product target and approved break without an edit form", () => {
    render(<DailyPlanPanel assignments={[assignment]} planBlocks={planBlocks} />);

    expect(screen.getByRole("heading", { name: "Daily production plan" })).toBeInTheDocument();
    expect(screen.getByText("LINE 3")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Ready Meals" })).toBeInTheDocument();
    expect(screen.getByLabelText("48 planned units")).toBeInTheDocument();
    expect(screen.getByText("Salt & Pepper Chicken")).toBeInTheDocument();
    expect(screen.getByText(/SPC-01 · 24\/hour · 48 units/)).toBeInTheDocument();
    expect(screen.getByText("Break 1 · 40 minutes")).toBeInTheDocument();
    expect(
      screen.getByText(
        (_, element) =>
          element?.tagName === "SPAN" &&
          element.textContent?.replace(/\\s+/g, " ").trim() ===
            "1/2 approved breaks",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText(/Published for/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /create|publish|edit/i })).not.toBeInTheDocument();
  });

  it("supports a legitimate third assigned line without adding manager controls", () => {
    const assignments = [
      assignment,
      {
        ...assignment,
        id: 8,
        production_line: 4,
        production_line_code: "DEMO-LINE-04",
        production_line_name: "Secondary Filling",
      },
      {
        ...assignment,
        id: 9,
        production_line: 5,
        production_line_code: "DEMO-LINE-05",
        production_line_name: "Final Packing",
      },
    ];

    render(
      <DailyPlanPanel
        assignments={assignments}
        planBlocks={planBlocks}
      />,
    );

    expect(screen.getByText("LINE 3")).toBeInTheDocument();
    expect(screen.getByText("LINE 4")).toBeInTheDocument();
    expect(screen.getByText("LINE 5")).toBeInTheDocument();
    expect(screen.getAllByRole("article")).toHaveLength(3);
    expect(screen.queryByLabelText("Daily plan summary")).not.toBeInTheDocument();
  });

  it("lets the Team Leader confirm a suggested full break", async () => {
    const postSpy = vi.spyOn(api, "postJson").mockResolvedValue(opportunity);
    const onSaved = vi.fn().mockResolvedValue(undefined);
    const actor = userEvent.setup();

    render(
      <BreakRecoveryPanel
        assignments={[assignment]}
        opportunities={[opportunity]}
        onSaved={onSaved}
      />,
    );

    expect(screen.queryByRole("button", { name: "Plan break" })).not.toBeInTheDocument();
    expect(screen.getByText("Team Leader confirms every decision.")).toBeInTheDocument();
    await actor.click(screen.getByRole("button", { name: "Confirm full break" }));

    await waitFor(() => expect(postSpy).toHaveBeenCalledOnce());
    expect(postSpy).toHaveBeenCalledWith("/break-opportunities/13/confirm/", undefined);
    expect(onSaved).toHaveBeenCalledWith(
      "Break confirmed. The full 40-minute return time is protected.",
    );
  });
});
