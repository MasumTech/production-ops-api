import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import * as api from "../api";
import type { PilotStatus, UserSummary } from "../types";
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
});
