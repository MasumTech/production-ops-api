import { render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import * as api from "../api";
import type {
  Assignment,
  LossAnalyticsReport,
} from "../types";
import { LossAnalyticsPanel } from "./LossAnalyticsPanel";

const assignments: Assignment[] = [
  {
    id: 1,
    team_leader: 11,
    team_leader_username: "lead.one",
    production_line: 101,
    production_line_code: "LINE-01",
    production_line_name: "Primary Packing",
    date: "2026-09-01",
    shift_type: "day",
    notes: "",
  },
];

const report: LossAnalyticsReport = {
  summary: {
    date_from: "2026-08-03",
    date_to: "2026-09-01",
    total_events: 4,
    total_loss_minutes: 70,
    total_estimated_lost_units: 220,
    unassigned_asset_events: 1,
    recurring_asset_count: 1,
  },
  assets: [
    {
      asset_id: 10,
      asset_code: "PRN-01",
      asset_name: "Primary Label Printer",
      production_line_code: "LINE-01",
      occurrences: 3,
      affected_shifts: 2,
      open_events: 1,
      total_loss_minutes: 45,
      total_estimated_lost_units: 120,
      latest_event_at: "2026-09-01T08:00:00Z",
      recurring: true,
    },
  ],
  line_losses: [
    {
      production_line_id: 101,
      production_line_code: "LINE-01",
      category: "equipment",
      occurrences: 3,
      affected_shifts: 2,
      total_loss_minutes: 45,
      total_estimated_lost_units: 120,
    },
  ],
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("loss analytics panel", () => {
  it("renders deterministic asset-loss evidence", async () => {
    const request = vi
      .spyOn(api, "apiRequest")
      .mockResolvedValue(report);

    render(
      <LossAnalyticsPanel assignments={assignments} />,
    );

    expect(
      await screen.findByRole("heading", {
        name: "Loss and asset history",
      }),
    ).toBeInTheDocument();

    expect(request).toHaveBeenCalledWith(
      expect.stringContaining("/analytics/loss-assets/?"),
    );

    const assetName = await screen.findByText(
      "Primary Label Printer",
    );
    const assetRow = assetName.closest("tr");

    expect(assetRow).not.toBeNull();
    expect(
      within(assetRow as HTMLTableRowElement).getByText("3"),
    ).toBeInTheDocument();
    expect(
      within(assetRow as HTMLTableRowElement).getByText("45"),
    ).toBeInTheDocument();
    expect(
      within(assetRow as HTMLTableRowElement).getByText("120"),
    ).toBeInTheDocument();
    expect(
      within(assetRow as HTMLTableRowElement).getByText(
        "Repeated-loss evidence",
      ),
    ).toBeInTheDocument();
  });

  it("shows an API error without hiding the screen", async () => {
    vi.spyOn(api, "apiRequest").mockRejectedValue(
      new Error("Analytics service unavailable."),
    );

    render(
      <LossAnalyticsPanel assignments={assignments} />,
    );

    expect(
      await screen.findByText("Analytics service unavailable."),
    ).toBeInTheDocument();

    expect(
      screen.getByRole("heading", {
        name: "Loss and asset history",
      }),
    ).toBeInTheDocument();
  });
});