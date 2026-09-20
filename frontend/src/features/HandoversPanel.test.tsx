import type { ComponentProps } from "react";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as api from "../api";
import type {
  Assignment,
  BreakOpportunity,
  Escalation,
  LineUpdate,
  ShiftHandover,
  UserSummary,
} from "../types";
import { HandoversPanel } from "./HandoversPanel";

const profile: UserSummary = {
  id: 2,
  username: "demo.leader",
  display_name: "Imran Khan",
  is_staff: false,
  workspace: "team_leader",
};

const assignments: Assignment[] = [
  {
    id: 10,
    team_leader: 2,
    team_leader_username: "demo.leader",
    production_line: 1,
    production_line_code: "DEMO-LINE-01",
    production_line_name: "Primary Filling",
    date: "2026-09-04",
    shift_type: "day",
    notes: "",
  },
  {
    id: 11,
    team_leader: 2,
    team_leader_username: "demo.leader",
    production_line: 2,
    production_line_code: "DEMO-LINE-02",
    production_line_name: "Secondary Packing",
    date: "2026-09-04",
    shift_type: "day",
    notes: "",
  },
];

function escalation(
  id: number,
  assignment: number,
  line: number,
  code: string,
  category: Escalation["category"],
  priority: Escalation["priority"],
  summary: string,
  control: string,
  raisedAt: string,
  dueAt: string,
): Escalation {
  return {
    id,
    asset: null,
    asset_code: null,
    asset_name: null,
    loss_minutes: 0,
    estimated_lost_units: 0,
    assignment,
    production_line: line,
    production_line_code: code,
    category,
    priority,
    status: "open",
    summary,
    details: "",
    immediate_action: control,
    owner: 9,
    owner_username: "demo.manager",
    raised_at: raisedAt,
    response_due_at: dueAt,
    is_overdue: false,
    needs_attention: true,
  };
}

const escalations: Escalation[] = [
  escalation(
    31,
    10,
    1,
    "DEMO-LINE-01",
    "quality",
    "critical",
    "Product hold",
    "Segregated; approved procedure followed",
    "2026-09-04T15:10:00Z",
    "2026-09-04T17:10:00Z",
  ),
  escalation(
    32,
    11,
    2,
    "DEMO-LINE-02",
    "equipment",
    "medium",
    "Printer",
    "Temporary repair; checks passed",
    "2026-09-04T14:35:00Z",
    "2026-09-04T18:00:00Z",
  ),
  escalation(
    33,
    11,
    2,
    "DEMO-LINE-02",
    "material",
    "medium",
    "Oat Milk material",
    "Ingredient prioritised",
    "2026-09-04T16:00:00Z",
    "2026-09-04T18:10:00Z",
  ),
];

const handovers: ShiftHandover[] = [
  {
    id: 41,
    outgoing_assignment: 10,
    incoming_assignment: 20,
    production_line: 1,
    production_line_code: "DEMO-LINE-01",
    outgoing_team_leader_username: "demo.leader",
    incoming_team_leader_username: "demo.leader.two",
    outgoing_date: "2026-09-04",
    outgoing_shift_type: "day",
    incoming_date: "2026-09-04",
    incoming_shift_type: "night",
    escalations: [escalations[0]],
    status: "pending",
    operational_summary: "One open item requires handover.",
    notes: "",
    handed_over_at: "2026-09-04T17:42:00Z",
  },
];

const updates: LineUpdate[] = [
  {
    id: 50,
    assignment: 10,
    production_line: 1,
    production_line_code: "DEMO-LINE-01",
    production_line_name: "Primary Filling",
    status: "green",
    current_product: "Salt & Pepper Chicken",
    issue_summary: "",
    action_taken: "Running to plan",
    action_owner: null,
    action_owner_username: null,
    support_required: "",
    requires_follow_up: false,
    recorded_at: "2026-09-04T16:00:00Z",
    next_update_due_at: "2026-09-04T17:00:00Z",
  },
];

const opportunities: BreakOpportunity[] = [
  {
    id: 60,
    assignment: 10,
    production_line: 1,
    production_line_code: "DEMO-LINE-01",
    break_block: 2,
    break_number: 1,
    source_update: 49,
    issue_summary: "Printer fault",
    status: "recovered",
    fault_at: "2026-09-04T08:05:00Z",
    suggested_start_at: "2026-09-04T08:10:00Z",
    expected_return_at: "2026-09-04T08:50:00Z",
    confirmed_at: "2026-09-04T08:10:00Z",
    returned_at: "2026-09-04T08:50:00Z",
    checks_completed_at: "2026-09-04T08:55:00Z",
    run_resumed_at: "2026-09-04T09:00:00Z",
    recovery_notes: "Checks passed.",
    declined_at: null,
    decline_reason: "",
  },
];

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

function renderPanel(overrides: Partial<ComponentProps<typeof HandoversPanel>> = {}) {
  const onSaved = vi.fn().mockResolvedValue(undefined);
  render(
    <HandoversPanel
      profile={profile}
      assignments={assignments}
      handovers={handovers}
      escalations={escalations}
      updates={updates}
      opportunities={opportunities}
      onSaved={onSaved}
      {...overrides}
    />,
  );
  return { onSaved };
}

describe("Team Leader Shift Handover v2", () => {
  it("matches the unresolved-work transfer reference", () => {
    renderPanel();

    expect(screen.getByRole("heading", { name: "Shift Handover" })).toBeInTheDocument();
    expect(
      screen.getByText(
        "Transfer only unresolved work with control, owner and next update",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("3 open items")).toBeInTheDocument();

    const transfer = screen.getByLabelText("Shift responsibility transfer");
    expect(transfer).toHaveTextContent("Outgoing: Day shift · Imran Khan");
    expect(transfer).toHaveTextContent(
      "Incoming: Night shift · Acceptance required",
    );
    expect(transfer).toHaveTextContent("Draft saved");

    const openItems = screen.getByLabelText("Open items for handover");
    const table = within(openItems).getByRole("table");
    expect(within(table).getAllByRole("row")).toHaveLength(4);
    expect(within(table).getByText("Product hold")).toBeInTheDocument();
    expect(within(table).getByText("Printer")).toBeInTheDocument();
    expect(within(table).getByText("Oat Milk material")).toBeInTheDocument();
    expect(within(table).getByText("QA / Operations")).toBeInTheDocument();
    expect(within(table).getByText("Engineering")).toBeInTheDocument();
    expect(within(table).getByText("Materials")).toBeInTheDocument();
    expect(within(table).getByText("Due now")).toBeInTheDocument();

    expect(screen.getByRole("heading", { name: "Completed this shift" })).toBeInTheDocument();
    expect(
      screen.getByText(/Break 1 moved under approved decision · full 40 minutes/),
    ).toBeInTheDocument();
    expect(screen.getByText("Restart checks completed at 09:00")).toBeInTheDocument();

    expect(screen.getByRole("heading", { name: "Sign-off" })).toBeInTheDocument();
    expect(screen.getByText(/Ready to hand over/)).toBeInTheDocument();
    expect(screen.getAllByText(/Acceptance required/).length).toBeGreaterThan(0);
    expect(
      screen.getByText("Owner and next update are required for every open item."),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save draft" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Review open items" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Hand over" })).toBeInTheDocument();
  });

  it("saves the handover note locally as a draft", async () => {
    const actor = userEvent.setup();
    const { onSaved } = renderPanel();

    await actor.type(
      screen.getByLabelText("Handover note"),
      "Confirm first three printer runs.",
    );
    await actor.click(screen.getByRole("button", { name: "Save draft" }));

    expect(onSaved).toHaveBeenCalledWith(
      "Handover draft saved on this device.",
    );
    const draft = JSON.parse(
      localStorage.getItem(
        "team-leader-handover-draft:demo.leader:2026-09-04",
      ) ?? "{}",
    ) as { note?: string; savedAt?: string };
    expect(draft.note).toBe("Confirm first three printer runs.");
    expect(draft.savedAt).toBeTruthy();
  });

  it("creates only the missing line handover package", async () => {
    const actor = userEvent.setup();
    const apiSpy = vi.spyOn(api, "apiRequest").mockResolvedValue([
      {
        ...assignments[1],
        id: 21,
        team_leader: 3,
        team_leader_username: "demo.leader.two",
        shift_type: "night",
      },
    ]);
    const postSpy = vi.spyOn(api, "postJson").mockResolvedValue({
      ...handovers[0],
      id: 42,
      outgoing_assignment: 11,
      incoming_assignment: 21,
      production_line: 2,
      production_line_code: "DEMO-LINE-02",
      escalations: [escalations[1], escalations[2]],
    } as ShiftHandover);
    const { onSaved } = renderPanel();

    await actor.click(screen.getByRole("button", { name: "Hand over" }));

    await waitFor(() => expect(apiSpy).toHaveBeenCalledOnce());
    expect(apiSpy).toHaveBeenCalledWith(
      "/team-leader-assignments/11/handover-options/",
    );
    expect(postSpy).toHaveBeenCalledWith(
      "/shift-handovers/",
      expect.objectContaining({
        outgoing_assignment: 11,
        incoming_assignment: 21,
        escalation_ids: [32, 33],
      }),
    );
    expect(onSaved).toHaveBeenCalledWith(
      "Shift handover sent. Incoming Team Leader acceptance is required.",
    );
  });
});
