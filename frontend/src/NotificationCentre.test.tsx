import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import * as api from "./api";
import { NotificationCentre } from "./NotificationCentre";

afterEach(() => vi.restoreAllMocks());

describe("notification centre", () => {
  it("shows unread scoped events and records read evidence", async () => {
    vi.spyOn(api, "apiRequest").mockResolvedValue({
      unread_count: 1,
      results: [
        {
          id: 42,
          event_type: "escalation.overdue",
          resource_type: "operationalescalation",
          resource_id: 12,
          assignment: 7,
          production_line: 3,
          actor: 9,
          severity: "critical",
          metadata: {},
          occurred_at: "2026-09-04T07:00:00Z",
        },
      ],
    });
    const postSpy = vi.spyOn(api, "postJson").mockResolvedValue({});
    const actor = userEvent.setup();
    render(<NotificationCentre refreshToken="refresh-1" />);

    expect(await screen.findByRole("button", { name: "Alerts (1)" })).toBeInTheDocument();
    await actor.click(screen.getByRole("button", { name: "Alerts (1)" }));
    expect(screen.getByRole("heading", { name: "Notifications" })).toBeInTheDocument();
    expect(screen.getByText("Escalation · Overdue")).toBeInTheDocument();

    await actor.click(screen.getByRole("button", { name: "Mark read" }));

    await waitFor(() => expect(postSpy).toHaveBeenCalledWith("/notifications/42/read/"));
    expect(screen.getByText("No unread notifications.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Alerts" })).toBeInTheDocument();
  });
});
