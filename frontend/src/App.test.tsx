import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import * as api from "./api";
import { LoginScreen } from "./App";
import { MyLinesPanel } from "./features/MyLinesPanel";
import { RaiseIssuePanel } from "./features/RaiseIssuePanel";
import type { Assignment, UserSummary, WorkspaceData } from "./types";

const assignment: Assignment = {
  id: 7,
  team_leader: 2,
  team_leader_username: "team.leader",
  production_line: 3,
  production_line_code: "LINE-03",
  production_line_name: "Ready Meals",
  date: "2026-08-31",
  shift_type: "day",
  notes: "",
};

const user: UserSummary = {
  id: 2,
  username: "team.leader",
  display_name: "Team Leader",
  is_staff: false,
};

afterEach(() => vi.restoreAllMocks());

describe("tablet workspace", () => {
  it("signs in with the supplied credentials", async () => {
    const loginSpy = vi.spyOn(api, "login").mockResolvedValue();
    const onAuthenticated = vi.fn();
    const actor = userEvent.setup();

    render(<LoginScreen onAuthenticated={onAuthenticated} />);
    await actor.type(screen.getByLabelText("Username"), "team.leader");
    await actor.type(screen.getByLabelText("Password"), "safe-password");
    await actor.click(screen.getByRole("button", { name: "Sign in securely" }));

    await waitFor(() => expect(onAuthenticated).toHaveBeenCalledOnce());
    expect(loginSpy).toHaveBeenCalledWith("team.leader", "safe-password");
  });

  it("shows latest RAG and risk counts for an assigned line", () => {
    const data: WorkspaceData = {
      assignments: [assignment],
      updates: [
        {
          id: 10,
          assignment: assignment.id,
          production_line: assignment.production_line,
          production_line_code: assignment.production_line_code,
          production_line_name: assignment.production_line_name,
          status: "amber",
          current_product: "Chicken Curry",
          issue_summary: "Film delivery is late.",
          action_taken: "Stores contacted.",
          action_owner: null,
          action_owner_username: null,
          support_required: "Materials",
          requires_follow_up: true,
          recorded_at: "2026-08-31T09:00:00Z",
          next_update_due_at: "2026-08-31T10:00:00Z",
        },
      ],
      materials: [],
      escalations: [
        {
          id: 11,
          assignment: assignment.id,
          production_line: assignment.production_line,
          production_line_code: assignment.production_line_code,
          category: "material",
          priority: "high",
          status: "open",
          summary: "Film delivery late",
          details: "",
          immediate_action: "",
          owner: 9,
          owner_username: "materials.owner",
          response_due_at: "2026-08-31T10:00:00Z",
          is_overdue: false,
          needs_attention: false,
        },
      ],
      breaks: [],
      handovers: [],
      users: [user],
    };

    render(<MyLinesPanel data={data} onRaiseIssue={vi.fn()} />);

    expect(screen.getByText("LINE-03")).toBeInTheDocument();
    expect(screen.getByText("Amber")).toBeInTheDocument();
    expect(screen.getByText("Chicken Curry")).toBeInTheDocument();
    expect(screen.getByText("1 open actions")).toBeInTheDocument();
  });

  it("posts a line update through the real API contract", async () => {
    const postSpy = vi.spyOn(api, "postJson").mockResolvedValue({});
    const onSaved = vi.fn().mockResolvedValue(undefined);
    const actor = userEvent.setup();

    render(
      <RaiseIssuePanel
        assignments={[assignment]}
        users={[user]}
        selectedAssignment={assignment.id}
        onSaved={onSaved}
      />,
    );

    await actor.type(screen.getByLabelText("Current product"), "Chicken Curry");
    await actor.click(screen.getByRole("button", { name: "Record line update" }));

    await waitFor(() => expect(postSpy).toHaveBeenCalledOnce());
    expect(postSpy).toHaveBeenCalledWith(
      "/hourly-line-updates/",
      expect.objectContaining({
        assignment: assignment.id,
        status: "green",
        current_product: "Chicken Curry",
      }),
    );
    expect(onSaved).toHaveBeenCalledWith("Line status recorded.");
  });
});
