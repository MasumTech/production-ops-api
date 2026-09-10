import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import * as api from "../api";
import type { PilotEvidence, PilotStatus, PilotTrial, ProductionLine, UserSummary } from "../types";
import { PilotAdminPanel } from "./PilotAdminPanel";

const status: PilotStatus = {
  status: "ready",
  generated_at: "2026-09-04T07:00:00Z",
  active_users: 4,
  support_users: 1,
  events_last_hour: 8,
  latest_event_at: "2026-09-04T06:59:00Z",
  unread_notifications: 3,
  open_actions: 4,
  overdue_actions: 1,
  unassigned_actions: 0,
  reminder_worker: {
    status: "healthy",
    last_started_at: "2026-09-04T06:59:00Z",
    last_completed_at: "2026-09-04T06:59:01Z",
    last_error: "",
    published_count: 2,
  },
};

const leader: UserSummary = {
  id: 7,
  username: "team.leader",
  display_name: "Team Leader",
  is_staff: false,
  workspace: "team_leader",
};

afterEach(() => vi.restoreAllMocks());

describe("pilot administration", () => {
  it("renders monitoring evidence and changes an approved workspace role", async () => {
    vi.spyOn(api, "apiRequest").mockImplementation(async (path) => {
      if (path === "/pilot/status/") return status as never;
      if (path === "/workspace-roles/") return [leader] as never;
      throw new Error(`Unexpected path ${path}`);
    });
    vi.spyOn(api, "apiList").mockResolvedValue([]);
    const postSpy = vi.spyOn(api, "postJson").mockResolvedValue({
      ...leader,
      workspace: "support",
    });
    const actor = userEvent.setup();
    render(<PilotAdminPanel />);

    expect(await screen.findByText("Pilot services reporting normally")).toBeInTheDocument();
    expect(screen.getByText("8")).toBeInTheDocument();
    expect(screen.getByText("Healthy")).toBeInTheDocument();

    await actor.click(screen.getByRole("button", { name: "Grant Support access" }));

    await waitFor(() => {
      expect(postSpy).toHaveBeenCalledWith("/workspace-roles/", {
        user: leader.id,
        workspace: "support",
      });
    });
    expect(screen.getByRole("button", { name: "Set as Team Leader" })).toBeInTheDocument();
  });

  it("renders the cross-functional review gate and human feedback evidence", async () => {
    const line: ProductionLine = {
      id: 3,
      code: "L-03",
      name: "Packing line",
      location: "Bay 3",
      target_units_per_hour: 100,
      status: "active",
    };
    const trial: PilotTrial = {
      id: 12,
      name: "Four-week pilot",
      objective: "Validate the workflow.",
      start_date: "2026-09-10",
      end_date: "2026-10-07",
      status: "active",
      selected_lines: [line],
      created_by: 1,
      created_by_username: "manager",
      started_at: "2026-09-10T07:00:00Z",
      started_by: 1,
      started_by_username: "manager",
      decided_at: null,
      decided_by: null,
      decided_by_username: null,
      decision_note: "",
    };
    const evidence = {
      trial,
      summary: {
        observation_count: 2,
        average_update_duration_seconds: 18,
        average_escalation_ack_seconds: 32,
        missed_actions: 0,
        accurate_updates: 2,
        paper_fallback_count: 1,
      },
      review: {
        required_approvals: 4,
        approved_approvals: 2,
        pending_approvals: 2,
        changes_requested: 0,
        feedback_count: 1,
        ready_for_start: false,
      },
      approvals: ["operations", "quality_safety", "engineering_it", "product_owner"].map((role, index) => ({
        id: index + 1,
        trial: trial.id,
        reviewer_role: role as "operations" | "quality_safety" | "engineering_it" | "product_owner",
        decision: index < 2 ? "approved" : "pending",
        note: index < 2 ? "Reviewed." : "",
        decided_by: index < 2 ? 1 : null,
        decided_by_username: index < 2 ? "manager" : null,
        decided_at: index < 2 ? "2026-09-10T07:05:00Z" : null,
        created_at: "2026-09-10T07:00:00Z",
        updated_at: "2026-09-10T07:05:00Z",
      })),
      feedback: [{
        id: 9,
        trial: trial.id,
        reviewer_role: "operations" as const,
        category: "usability" as const,
        sentiment: "positive" as const,
        notes: "The update flow was clear.",
        created_by: 1,
        created_by_username: "manager",
        created_at: "2026-09-10T08:00:00Z",
        updated_at: "2026-09-10T08:00:00Z",
      }],
      observations: [],
    } satisfies PilotEvidence;
    vi.spyOn(api, "apiRequest").mockImplementation(async (path) => {
      if (path === "/pilot/status/") return status as never;
      if (path === "/workspace-roles/") return [leader] as never;
      if (path === `/pilot-trials/${trial.id}/evidence/`) return evidence as never;
      throw new Error(`Unexpected path ${path}`);
    });
    vi.spyOn(api, "apiList").mockImplementation(async (path) => {
      if (path.startsWith("/production-lines")) return [line] as never;
      if (path.startsWith("/pilot-trials")) return [trial] as never;
      return [] as never;
    });
    render(<PilotAdminPanel />);

    expect(await screen.findByText("Cross-functional sign-off")).toBeInTheDocument();
    expect(screen.getByText("2/4 reviews approved · 1 feedback notes")).toBeInTheDocument();
    expect(screen.getByText("The update flow was clear.")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Save review" })).toHaveLength(4);
  });
});
