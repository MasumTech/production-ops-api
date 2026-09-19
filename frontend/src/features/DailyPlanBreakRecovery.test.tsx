import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import * as api from "../api";
import type {
  Assignment,
  BreakOpportunity,
  DailyPlanBlock,
  LineUpdate,
  ShiftRecord,
} from "../types";
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

const shift: ShiftRecord = {
  id: 90,
  production_line: assignment.production_line,
  production_line_code: assignment.production_line_code,
  supervisor: 1,
  supervisor_username: "operations.manager",
  date: assignment.date,
  shift_type: "day",
  start_time: "07:00:00",
  end_time: "18:00:00",
  planned_output: 8400,
  actual_output: 6888,
  downtime_minutes: 4,
  performance_percentage: 82,
};

const update: LineUpdate = {
  id: 20,
  assignment: assignment.id,
  production_line: assignment.production_line,
  production_line_code: assignment.production_line_code,
  production_line_name: assignment.production_line_name,
  status: "green",
  current_product: "Salt & Pepper Chicken",
  issue_summary: "",
  action_taken: "Running to plan",
  action_owner: null,
  action_owner_username: null,
  support_required: "",
  requires_follow_up: false,
  recorded_at: "2026-09-04T10:12:00Z",
  next_update_due_at: "2026-09-04T11:12:00Z",
};

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
  it("uses the configured shift time in the timeline board", () => {
    render(
      <DailyPlanPanel
        assignments={[{ ...assignment, date: "2026-09-14" }]}
        planBlocks={planBlocks}
        shifts={[
          {
            ...shift,
            date: "2026-09-14",
            start_time: "06:45:00",
            end_time: "18:00:00",
          },
        ]}
      />,
    );

    expect(
      screen.getByRole("heading", {
        name: "Shift schedule · 06:45–18:00",
      }),
    ).toBeInTheDocument();
  });

  it("matches the read-only timeline and output-table reference", () => {
    render(
      <DailyPlanPanel
        assignments={[assignment]}
        planBlocks={planBlocks}
        shifts={[shift]}
        updates={[update]}
      />,
    );

    expect(
      screen.getByRole("heading", { name: "Daily Plan" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Assigned-line product schedule, targets and planned breaks",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByLabelText("Filter Daily Plan by assigned line"),
    ).toHaveDisplayValue("All assigned lines");
    expect(
      screen.getByLabelText("Daily Plan sequence view"),
    ).toHaveDisplayValue("Product sequence");
    expect(screen.getByText("1 line assigned")).toBeInTheDocument();

    expect(
      screen.getByRole("heading", {
        name: "Shift schedule · 07:00–18:00",
      }),
    ).toBeInTheDocument();
    expect(screen.getByText("Production")).toBeInTheDocument();
    expect(screen.getByText("Planned break")).toBeInTheDocument();
    expect(screen.getAllByText("Salt & Pepper Chicken").length).toBeGreaterThan(0);
    expect(screen.getByText("Break 1")).toBeInTheDocument();

    const output = screen.getByLabelText("Output by assigned line");
    expect(output).toHaveTextContent("Current product");
    expect(output).toHaveTextContent("8,400");
    expect(output).toHaveTextContent("6,888");
    expect(output).toHaveTextContent("82%");
    expect(output).toHaveTextContent(/ahead|behind/);
    expect(
      screen.getByText(
        /Published plans are read-only\. Request a change for Operations Manager review\./i,
      ),
    ).toBeInTheDocument();
  });

  it("routes a plan-change request for the selected assignment", async () => {
    const onRequestPlanChange = vi.fn();
    const actor = userEvent.setup();

    render(
      <DailyPlanPanel
        assignments={[assignment]}
        planBlocks={planBlocks}
        shifts={[shift]}
        updates={[update]}
        onRequestPlanChange={onRequestPlanChange}
      />,
    );

    await actor.click(
      screen.getByRole("button", { name: "Request plan change" }),
    );

    expect(onRequestPlanChange).toHaveBeenCalledWith(assignment.id);
  });

  it("supports a legitimate third assigned line", () => {
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

    expect(screen.getByText("3 lines assigned")).toBeInTheDocument();
    expect(
      screen.getByLabelText("Team Leader shift schedule").querySelectorAll(
        ".tl-plan-v2__row",
      ),
    ).toHaveLength(3);
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

    expect(
      screen.queryByRole("button", { name: "Plan break" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText("Team Leader confirms every decision."),
    ).toBeInTheDocument();
    await actor.click(
      screen.getByRole("button", { name: "Confirm full break" }),
    );

    await waitFor(() => expect(postSpy).toHaveBeenCalledOnce());
    expect(postSpy).toHaveBeenCalledWith(
      "/break-opportunities/13/confirm/",
      undefined,
    );
    expect(onSaved).toHaveBeenCalledWith(
      "Break confirmed. The full 40-minute return time is protected.",
    );
  });
});
