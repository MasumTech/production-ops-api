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
  production_line_name: assignment.production_line_name,
  break_block: 2,
  break_number: 1,
  source_update: 22,
  issue_summary: "Printer fault",
  source_action_taken: "Line stopped safely and product controlled",
  source_support_required: "Engineering checks before restart",
  source_next_update_due_at: "2026-09-04T08:45:00Z",
  planned_break_start_at: "2026-09-04T08:30:00Z",
  planned_break_end_at: "2026-09-04T09:10:00Z",
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
    expect(screen.getByText("Done")).toBeInTheDocument();
    expect(screen.getByText("Planned output left")).toBeInTheDocument();
    expect(screen.getByText("Planned break")).toBeInTheDocument();
    expect(screen.getAllByText("Salt & Pepper Chicken").length).toBeGreaterThan(0);
    expect(screen.getByLabelText("Break 1, 40 minutes")).toBeInTheDocument();

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

  it("expands the selected output row with recorded hourly actuals", async () => {
    const actor = userEvent.setup();
    render(
      <DailyPlanPanel
        assignments={[assignment]}
        planBlocks={planBlocks}
        shifts={[shift]}
        updates={[update]}
        hourlyOutputs={[{ id: 3, assignment: assignment.id, hour_start_at: "2026-09-04T07:00:00Z", actual_units: 790, updated_at: "2026-09-04T08:00:00Z" }]}
      />,
    );
    await actor.click(screen.getByRole("button", { name: /Line 3 ▾/ }));
    expect(screen.getByRole("heading", { name: "Line 3 · Hourly details" })).toBeInTheDocument();
    expect(screen.getByText("D 790")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Line 3 ▴/ })).toHaveAttribute("aria-expanded", "true");
    await actor.click(screen.getByRole("button", { name: "Close details" }));
    expect(screen.queryByRole("heading", { name: "Line 3 · Hourly details" })).not.toBeInTheDocument();
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

  it("matches the current-opportunity reference and confirms safely", async () => {
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
      screen.getByRole("heading", { name: "Break & Recovery" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Preserve the full approved break and prepare a controlled restart",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("Review required", { exact: true })).toBeInTheDocument();
    expect(
      screen.getByRole("tab", { name: "Current opportunity" }),
    ).toHaveAttribute("aria-selected", "true");
    expect(
      screen.getByLabelText("Select break recovery line"),
    ).toHaveDisplayValue("Line 3 · Printer fault · Review required");
    expect(
      screen.getByRole("heading", { name: /Current event · Line/ }),
    ).toBeInTheDocument();
    expect(screen.getByText("08:05 · Printer fault")).toBeInTheDocument();
    expect(screen.getByText("Stopped safely")).toBeInTheDocument();
    expect(screen.getByText("08:45")).toBeInTheDocument();
    expect(screen.getByText("08:30–09:10")).toBeInTheDocument();
    expect(screen.getByText("08:10–08:50")).toBeInTheDocument();
    expect(screen.getByText("35 min")).toBeInTheDocument();
    expect(screen.getByText("40 min")).toBeInTheDocument();
    expect(screen.getByText("Approved speed")).toBeInTheDocument();
    expect(
      screen.getByText(
        /Never recall people early, reduce approved rest, bypass checks/i,
      ),
    ).toBeInTheDocument();

    const confirmButton = screen.getByRole("button", {
      name: "Confirm opportunity",
    });
    expect(confirmButton).toBeEnabled();
    await actor.click(confirmButton);

    await waitFor(() => expect(postSpy).toHaveBeenCalledOnce());
    expect(postSpy).toHaveBeenCalledWith(
      "/break-opportunities/13/confirm/",
      undefined,
    );
    expect(onSaved).toHaveBeenCalledWith(
      "Break confirmed. The full 40-minute return time is protected.",
    );
  });

  it("switches between active opportunities on assigned lines", async () => {
    const secondAssignment = {
      ...assignment,
      id: 8,
      production_line: 4,
      production_line_code: "LINE-04",
      production_line_name: "Desserts",
    };
    const secondOpportunity: BreakOpportunity = {
      ...opportunity,
      id: 14,
      assignment: secondAssignment.id,
      production_line: secondAssignment.production_line,
      production_line_code: secondAssignment.production_line_code,
      production_line_name: secondAssignment.production_line_name,
      issue_summary: "Conveyor fault",
      status: "confirmed",
      confirmed_at: "2026-09-04T08:10:00Z",
    };
    const actor = userEvent.setup();

    render(
      <BreakRecoveryPanel
        assignments={[assignment, secondAssignment]}
        opportunities={[opportunity, secondOpportunity]}
        onSaved={vi.fn().mockResolvedValue(undefined)}
      />,
    );

    const selector = screen.getByLabelText("Select break recovery line");
    expect(selector).toHaveDisplayValue(
      "Line 4 · Conveyor fault · Break confirmed",
    );
    await actor.selectOptions(selector, String(opportunity.id));
    expect(
      screen.getByRole("heading", { name: "Current event · Line 3" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Confirm opportunity" }),
    ).toBeEnabled();
  });

  it("loads genuine 7 and 30 day recovery history", async () => {
    const recovered: BreakOpportunity = {
      ...opportunity,
      id: 15,
      assignment: 71,
      assignment_date: "2026-09-01",
      status: "recovered",
      run_resumed_at: "2026-09-01T09:00:00Z",
      recovery_notes: "Safety, quality and technical checks completed.",
    };
    const listSpy = vi.spyOn(api, "apiList").mockResolvedValue([recovered]);
    const actor = userEvent.setup();

    render(
      <BreakRecoveryPanel
        assignments={[assignment]}
        opportunities={[opportunity]}
        onSaved={vi.fn().mockResolvedValue(undefined)}
      />,
    );

    await actor.click(screen.getByRole("tab", { name: "Recovery history" }));
    await waitFor(() =>
      expect(listSpy).toHaveBeenCalledWith(
        "/break-opportunities/?date_from=2026-08-29&date_to=2026-09-04",
      ),
    );
    expect(screen.getByText(/1 Sept? · Printer fault/)).toBeInTheDocument();

    await actor.selectOptions(screen.getByLabelText("History range"), "30");
    await waitFor(() =>
      expect(listSpy).toHaveBeenLastCalledWith(
        "/break-opportunities/?date_from=2026-08-06&date_to=2026-09-04",
      ),
    );
  });

  it("requires a recorded reason before declining an opportunity", async () => {
    const postSpy = vi.spyOn(api, "postJson").mockResolvedValue({
      ...opportunity,
      status: "declined",
      declined_at: "2026-09-04T08:08:00Z",
      decline_reason: "Approved break remains at planned time.",
    });
    const actor = userEvent.setup();

    render(
      <BreakRecoveryPanel
        assignments={[assignment]}
        opportunities={[opportunity]}
        onSaved={vi.fn().mockResolvedValue(undefined)}
      />,
    );

    await actor.click(
      screen.getByRole("button", { name: "Decline with reason" }),
    );
    await actor.type(
      screen.getByLabelText("Reason for declining"),
      "Approved break remains at planned time.",
    );
    await actor.click(screen.getByRole("button", { name: "Confirm decline" }));

    await waitFor(() => expect(postSpy).toHaveBeenCalledOnce());
    expect(postSpy).toHaveBeenCalledWith(
      "/break-opportunities/13/decline/",
      { decline_reason: "Approved break remains at planned time." },
    );
  });
});
