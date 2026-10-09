import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import * as api from "./api";
import { HourlyOutputEditor, type HourlyOutputContext } from "./HourlyOutputEditor";

const newOutputContext: HourlyOutputContext = {
  assignmentId: 7,
  lineLabel: "Line 3",
  hourLabel: "07:00–08:00",
  hourStartAt: "2026-09-04T07:00:00Z",
  target: 800,
  output: null,
};

afterEach(() => vi.restoreAllMocks());

describe("HourlyOutputEditor", () => {
  it("records Team Leader good, reject and rework quantities", async () => {
    const actor = userEvent.setup();
    const request = vi.spyOn(api, "apiRequest").mockResolvedValue({} as never);
    const onSaved = vi.fn().mockResolvedValue(undefined);
    const onClose = vi.fn();

    render(
      <HourlyOutputEditor
        context={newOutputContext}
        onClose={onClose}
        onSaved={onSaved}
      />,
    );

    const dialog = screen.getByRole("dialog", { name: "Line 3 · 07:00–08:00" });
    await actor.clear(within(dialog).getByLabelText("Good units"));
    await actor.type(within(dialog).getByLabelText("Good units"), "790");
    await actor.clear(within(dialog).getByLabelText("Reject units"));
    await actor.type(within(dialog).getByLabelText("Reject units"), "8");
    await actor.clear(within(dialog).getByLabelText("Rework units"));
    await actor.type(within(dialog).getByLabelText("Rework units"), "2");
    await actor.type(within(dialog).getByLabelText("Production note"), "Verified counter reading");

    expect(within(dialog).getByText("10 short")).toBeInTheDocument();
    await actor.click(within(dialog).getByRole("button", { name: "Record output" }));

    await waitFor(() => expect(request).toHaveBeenCalledWith(
      "/hourly-outputs/",
      expect.objectContaining({ method: "POST" }),
    ));
    const payload = JSON.parse(request.mock.calls[0][1]?.body as string);
    expect(payload).toEqual({
      assignment: 7,
      hour_start_at: "2026-09-04T07:00:00Z",
      actual_units: 790,
      rejected_units: 8,
      rework_units: 2,
      notes: "Verified counter reading",
    });
    expect(onSaved).toHaveBeenCalledWith("Hourly production recorded.");
    expect(onClose).toHaveBeenCalled();
  });

  it("requires and submits a Manager correction reason", async () => {
    const actor = userEvent.setup();
    const request = vi.spyOn(api, "apiRequest").mockResolvedValue({} as never);
    const onSaved = vi.fn().mockResolvedValue(undefined);
    const onClose = vi.fn();

    render(
      <HourlyOutputEditor
        context={{
          ...newOutputContext,
          output: {
            id: 31,
            assignment: 7,
            hour_start_at: "2026-09-04T07:00:00Z",
            actual_units: 780,
            rejected_units: 6,
            rework_units: 1,
            notes: "Initial reading",
            recorded_by_username: "team.leader",
            last_edited_by_username: "team.leader",
            updated_at: "2026-09-04T08:00:00Z",
          },
        }}
        manager
        onClose={onClose}
        onSaved={onSaved}
      />,
    );

    const dialog = screen.getByRole("dialog", { name: "Line 3 · 07:00–08:00" });
    expect(within(dialog).getByText("Recorded by team.leader")).toBeInTheDocument();
    await actor.clear(within(dialog).getByLabelText("Good units"));
    await actor.type(within(dialog).getByLabelText("Good units"), "795");
    await actor.type(
      within(dialog).getByLabelText("Correction reason"),
      "Checked against the physical counter",
    );
    await actor.click(within(dialog).getByRole("button", { name: "Save correction" }));

    await waitFor(() => expect(request).toHaveBeenCalledWith(
      "/hourly-outputs/31/",
      expect.objectContaining({
        method: "PATCH",
        body: expect.stringContaining("Checked against the physical counter"),
      }),
    ));
    const payload = JSON.parse(request.mock.calls[0][1]?.body as string);
    expect(payload).toMatchObject({
      actual_units: 795,
      correction_reason: "Checked against the physical counter",
    });
    expect(payload).not.toHaveProperty("assignment");
    expect(payload).not.toHaveProperty("hour_start_at");
    expect(onSaved).toHaveBeenCalledWith("Hourly production correction saved.");
    expect(onClose).toHaveBeenCalled();
  });
});
