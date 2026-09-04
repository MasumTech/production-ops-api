import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import * as api from "../api";
import type { SupportCompanionData, UserSummary } from "../types";
import { SupportCompanion } from "./SupportCompanion";

const profile: UserSummary = {
  id: 9,
  username: "support.engineer",
  display_name: "Support Engineer",
  is_staff: false,
  workspace: "support",
};

const data: SupportCompanionData = {
  generated_at: "2026-09-04T07:00:00Z",
  assignments: [
    {
      id: 7,
      team_leader: 2,
      team_leader_username: "team.leader",
      production_line: 3,
      production_line_code: "LINE-03",
      production_line_name: "Ready Meals",
      date: "2026-09-04",
      shift_type: "day",
      notes: "",
    },
  ],
  updates: [
    {
      id: 10,
      assignment: 7,
      production_line: 3,
      production_line_code: "LINE-03",
      production_line_name: "Ready Meals",
      status: "red",
      current_product: "Chicken Curry",
      issue_summary: "Filler pressure is unstable.",
      action_taken: "Line speed reduced.",
      action_owner: 9,
      action_owner_username: "support.engineer",
      support_required: "Engineering",
      requires_follow_up: true,
      recorded_at: "2026-09-04T06:55:00Z",
      next_update_due_at: "2026-09-04T07:25:00Z",
    },
  ],
  materials: [
    {
      id: 12,
      assignment: 7,
      production_line: 3,
      production_line_code: "LINE-03",
      sequence_number: 1,
      product_code: "FILM-01",
      product_name: "Printed film",
      planned_quantity: 5000,
      status: "short",
      shortage_quantity: 400,
      owner: 9,
      owner_username: "support.engineer",
      expected_available_at: "2026-09-04T08:00:00Z",
      hold_reason: "",
      notes: "Delivery in transit.",
    },
  ],
  escalations: [
    {
      id: 11,
      asset: null,
      assignment: 7,
      production_line: 3,
      production_line_code: "LINE-03",
      asset_code: null,
      asset_name: null,
      loss_minutes: 15,
      estimated_lost_units: 180,
      category: "equipment",
      priority: "critical",
      status: "open",
      summary: "Filler pressure requires engineering support",
      details: "Pressure drops at full speed.",
      immediate_action: "Inspect the filler valve.",
      owner: 9,
      owner_username: "support.engineer",
      response_due_at: "2026-09-04T06:50:00Z",
      is_overdue: true,
      needs_attention: true,
    },
  ],
};

const defaultProps = {
  profile,
  data,
  operationalDate: "2026-09-04",
  lastUpdatedAt: "2026-09-04T07:00:00Z",
  online: true,
  liveState: "live",
  busy: false,
  error: "",
  onDateChange: vi.fn(),
  onRefresh: vi.fn(),
  onSignOut: vi.fn(),
  onSaved: vi.fn().mockResolvedValue(undefined),
};

afterEach(() => vi.restoreAllMocks());

describe("mobile support companion", () => {
  it("shows priority actions and exposes the shared five-section navigation", async () => {
    const actor = userEvent.setup();
    render(<SupportCompanion {...defaultProps} />);

    expect(screen.getByRole("heading", { name: "My response queue" })).toBeInTheDocument();
    expect(screen.getByText("Filler pressure requires engineering support")).toBeInTheDocument();
    expect(screen.getAllByText("Overdue").length).toBeGreaterThan(0);
    expect(screen.getByRole("navigation", { name: "Operational Support mobile workspace" })).toBeInTheDocument();

    await actor.click(screen.getByRole("button", { name: "Line Status" }));
    expect(screen.getByRole("heading", { name: "Line status" })).toBeInTheDocument();
    expect(screen.getByText("Chicken Curry")).toBeInTheDocument();
  });

  it("acknowledges an assigned action through the idempotent post helper", async () => {
    const postSpy = vi.spyOn(api, "postJson").mockResolvedValue({});
    const onSaved = vi.fn().mockResolvedValue(undefined);
    const actor = userEvent.setup();
    render(<SupportCompanion {...defaultProps} onSaved={onSaved} />);

    await actor.click(screen.getByRole("button", { name: "Acknowledge action" }));

    await waitFor(() => {
      expect(postSpy).toHaveBeenCalledWith("/operational-escalations/11/acknowledge/");
    });
    expect(onSaved).toHaveBeenCalledWith(
      "Action acknowledged. The Team Leader can see your response.",
    );
  });

  it("reports an offline acknowledgement as safely queued", async () => {
    vi.spyOn(api, "postJson").mockRejectedValue(new api.OfflineQueuedError("queue-1"));
    const onSaved = vi.fn().mockResolvedValue(undefined);
    const actor = userEvent.setup();
    render(<SupportCompanion {...defaultProps} online={false} onSaved={onSaved} />);

    await actor.click(screen.getByRole("button", { name: "Acknowledge action" }));

    await waitFor(() => {
      expect(onSaved).toHaveBeenCalledWith(
        "Acknowledgement queued securely and will sync when online.",
      );
    });
  });
});
