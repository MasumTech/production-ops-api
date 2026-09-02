import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import * as api from "../api";
import type { DailyRiskBriefing } from "../types";
import { DailyRiskBriefingPanel } from "./DailyRiskBriefingPanel";

const briefing: DailyRiskBriefing = {
  summary: {
    date: "2026-09-02",
    generated_at: "2026-09-02T10:00:00Z",
    rules_version: "1.0",
    overall_risk_level: "critical",
    highest_risk_score: 100,
    average_confidence_percent: 75,
    lines_assessed: 2,
    risk_counts: {
      low: 0,
      medium: 0,
      high: 1,
      critical: 1,
    },
  },
  lines: [
    {
      production_line_id: 101,
      production_line_code: "LINE-01",
      production_line_name: "Primary Packing",
      risk_level: "critical",
      risk_score: 100,
      confidence_percent: 100,
      risk_factors: [
        {
          code: "red_line_status",
          source: "line_update",
          severity: "critical",
          score: 35,
          reason: "Latest line status is Red.",
          evidence: { latest_status: "red" },
        },
        {
          code: "overdue_escalation",
          source: "escalation",
          severity: "high",
          score: 20,
          reason: "One open escalation is overdue.",
          evidence: { overdue_escalations: 1 },
        },
      ],
      missing_data_warnings: [],
      metrics: {
        assignment_count: 1,
        shift_count: 1,
        planned_output: 5000,
        actual_output: 3000,
        performance_percentage: 60,
        downtime_minutes: 75,
        latest_status: "red",
        latest_update_at: "2026-09-02T09:00:00Z",
        open_escalations: 1,
        overdue_escalations: 1,
        critical_escalations: 1,
        unassigned_escalations: 0,
        short_material_items: 1,
        held_material_items: 0,
        active_assets: 2,
        recurring_asset_faults: 1,
        confirmed_loss_minutes: 70,
        estimated_lost_units: 900,
      },
    },
    {
      production_line_id: 102,
      production_line_code: "LINE-02",
      production_line_name: "Ready Meals",
      risk_level: "high",
      risk_score: 50,
      confidence_percent: 50,
      risk_factors: [],
      missing_data_warnings: [
        {
          code: "missing_shift",
          source: "shift",
          message: "No shift output record exists for this line and date.",
        },
      ],
      metrics: {
        assignment_count: 1,
        shift_count: 0,
        planned_output: 0,
        actual_output: 0,
        performance_percentage: null,
        downtime_minutes: 0,
        latest_status: "green",
        latest_update_at: "2026-09-02T09:30:00Z",
        open_escalations: 0,
        overdue_escalations: 0,
        critical_escalations: 0,
        unassigned_escalations: 0,
        short_material_items: 0,
        held_material_items: 0,
        active_assets: 1,
        recurring_asset_faults: 0,
        confirmed_loss_minutes: 0,
        estimated_lost_units: 0,
      },
    },
  ],
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("daily risk briefing panel", () => {
  it("renders traceable scores, evidence, and missing-data warnings", async () => {
    const request = vi.spyOn(api, "apiRequest").mockResolvedValue(briefing);

    render(<DailyRiskBriefingPanel operationalDate="2026-09-02" />);

    const summary = await screen.findByRole("region", { name: "Risk briefing summary" });
    expect(within(summary).getByText("100 / 100")).toBeInTheDocument();
    expect(request).toHaveBeenCalledWith(
      "/analytics/daily-risk-briefing/?date=2026-09-02",
    );

    const criticalLine = screen.getByRole("heading", { name: "Primary Packing" }).closest("article");
    expect(criticalLine).not.toBeNull();
    expect(within(criticalLine as HTMLElement).getByText("Latest line status is Red.")).toBeInTheDocument();
    expect(within(criticalLine as HTMLElement).getByText(/Source: Line Update/)).toBeInTheDocument();
    expect(within(criticalLine as HTMLElement).getByText("Latest Status: red")).toBeInTheDocument();

    expect(screen.getByText("Missing evidence lowers confidence")).toBeInTheDocument();
    expect(screen.getByText(/No shift output record exists/)).toBeInTheDocument();
    expect(screen.getByText(/does not predict outcomes/)).toBeInTheDocument();
  });

  it("reloads when the operational date changes", async () => {
    const request = vi.spyOn(api, "apiRequest").mockResolvedValue(briefing);
    const view = render(<DailyRiskBriefingPanel operationalDate="2026-09-02" />);

    await waitFor(() => expect(request).toHaveBeenCalledTimes(1));
    view.rerender(<DailyRiskBriefingPanel operationalDate="2026-09-03" />);

    await waitFor(() =>
      expect(request).toHaveBeenLastCalledWith(
        "/analytics/daily-risk-briefing/?date=2026-09-03",
      ),
    );
  });

  it("keeps the panel usable when the API fails and supports retry", async () => {
    const actor = userEvent.setup();
    vi.spyOn(api, "apiRequest")
      .mockRejectedValueOnce(new Error("Briefing service unavailable."))
      .mockResolvedValueOnce(briefing);

    render(<DailyRiskBriefingPanel operationalDate="2026-09-02" />);

    expect(await screen.findByText("Briefing service unavailable.")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Daily risk briefing" })).toBeInTheDocument();

    await actor.click(screen.getByRole("button", { name: "Retry briefing" }));

    const summary = await screen.findByRole("region", { name: "Risk briefing summary" });
    expect(within(summary).getByText("100 / 100")).toBeInTheDocument();
  });
});
