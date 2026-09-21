import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import * as api from "../api";
import type { Assignment, MaterialReadiness, UserChoice } from "../types";
import { MaterialsPanel } from "./MaterialsPanel";

const assignments: Assignment[] = [
  {
    id: 7,
    team_leader: 2,
    team_leader_username: "team.leader",
    production_line: 1,
    production_line_code: "DEMO-LINE-01",
    production_line_name: "Primary Filling",
    date: "2026-09-04",
    shift_type: "day",
    notes: "",
  },
  {
    id: 8,
    team_leader: 2,
    team_leader_username: "team.leader",
    production_line: 2,
    production_line_code: "DEMO-LINE-02",
    production_line_name: "Secondary Packing",
    date: "2026-09-04",
    shift_type: "day",
    notes: "",
  },
];

const users: UserChoice[] = [
  { id: 9, username: "demo.manager", display_name: "Amina Rahman" },
];

const materials: MaterialReadiness[] = [
  {
    id: 21,
    assignment: 7,
    production_line: 1,
    production_line_code: "DEMO-LINE-01",
    sequence_number: 1,
    product_code: "SPC-01",
    product_name: "Salt & Pepper Chicken",
    planned_quantity: 8400,
    status: "ready",
    shortage_quantity: 0,
    owner: null,
    owner_username: null,
    expected_available_at: null,
    needed_by_at: "2026-09-04T08:00:00Z",
    risk_summary: "",
    responsible_role: "Operations",
    expected_action: "Available",
    next_action: "Continue normal checks",
    hold_reason: "",
    notes: "Ingredients, packaging and release checks are complete.",
  },
  {
    id: 22,
    assignment: 7,
    production_line: 1,
    production_line_code: "DEMO-LINE-01",
    sequence_number: 2,
    product_code: "SSC-02",
    product_name: "Sweet & Sour Chicken",
    planned_quantity: 2600,
    status: "in_process",
    shortage_quantity: 0,
    owner: 9,
    owner_username: "demo.manager",
    expected_available_at: "2026-09-04T10:30:00Z",
    needed_by_at: "2026-09-04T11:00:00Z",
    risk_summary: "120 kg",
    responsible_role: "Batcher",
    expected_action: "ETA 11:30",
    next_action: "Confirm batch release",
    hold_reason: "",
    notes: "Final sauce batch is being prepared for the next run.",
  },
  {
    id: 23,
    assignment: 8,
    production_line: 2,
    production_line_code: "DEMO-LINE-02",
    sequence_number: 2,
    product_code: "OMC-01",
    product_name: "Oat Milk Chai",
    planned_quantity: 6000,
    status: "short",
    shortage_quantity: 640,
    owner: 9,
    owner_username: "demo.manager",
    expected_available_at: "2026-09-04T10:30:00Z",
    needed_by_at: "2026-09-04T09:30:00Z",
    risk_summary: "640 packs",
    responsible_role: "Materials",
    expected_action: "Decision due 10:20",
    next_action: "Confirm replenishment",
    hold_reason: "",
    notes: "Carton stock below next-hour demand.",
  },
  {
    id: 24,
    assignment: 8,
    production_line: 2,
    production_line_code: "DEMO-LINE-02",
    sequence_number: 3,
    product_code: "BBQ-02",
    product_name: "BBQ Chicken Bites",
    planned_quantity: 2200,
    status: "held",
    shortage_quantity: 0,
    owner: 9,
    owner_username: "demo.manager",
    expected_available_at: null,
    needed_by_at: "2026-09-04T13:00:00Z",
    risk_summary: "QA label release",
    responsible_role: "QA",
    expected_action: "Do not use",
    next_action: "Await authorised release",
    hold_reason: "QA label verification is pending.",
    notes: "QA release is required before the planned product change.",
  },
];

afterEach(() => vi.restoreAllMocks());

describe("Team Leader Materials v2", () => {
  it("matches the readiness table and selected short-item reference", () => {
    render(
      <MaterialsPanel
        assignments={assignments}
        materials={materials}
        users={users}
        onRaiseIssue={vi.fn()}
        onSaved={vi.fn()}
      />,
    );

    expect(screen.getByRole("heading", { name: "Materials" })).toBeInTheDocument();
    expect(
      screen.getByText(
        "Readiness, shortages, holds and safe expected times for assigned lines",
      ),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Filter by assigned line")).toHaveValue("all");
    expect(screen.getByLabelText("Filter by material status")).toHaveValue("all");
    expect(screen.getByLabelText("Search product or material")).toBeInTheDocument();

    const table = screen.getByRole("table");
    expect(within(table).getAllByRole("row")).toHaveLength(5);
    for (const status of ["READY", "IN PROCESS", "SHORT", "HELD"]) {
      expect(within(table).getByText(status, { exact: true })).toBeInTheDocument();
    }

    const detail = screen.getByLabelText("Selected material details");
    expect(within(detail).getByRole("heading", { name: /Oat Milk Chai · Line 2/ })).toBeInTheDocument();
    expect(within(detail).getByText("640 packs short")).toBeInTheDocument();
    expect(within(detail).getByText("Responsible: Materials")).toBeInTheDocument();
    expect(within(detail).getByText("ETA 10:30")).toBeInTheDocument();
    expect(within(detail).getByText("Next action: Confirm replenishment")).toBeInTheDocument();
    expect(within(detail).getByText("Carton stock below next-hour demand.")).toBeInTheDocument();
    expect(
      within(detail).getByText(/Team Leaders cannot release held product/i),
    ).toBeInTheDocument();
  });

  it("filters materials by line, status and product search", async () => {
    const actor = userEvent.setup();
    render(
      <MaterialsPanel
        assignments={assignments}
        materials={materials}
        users={users}
        onRaiseIssue={vi.fn()}
        onSaved={vi.fn()}
      />,
    );

    await actor.selectOptions(screen.getByLabelText("Filter by material status"), "held");
    expect(screen.getByText("BBQ Chicken Bites")).toBeInTheDocument();
    expect(screen.queryByText("Sweet & Sour Chicken")).not.toBeInTheDocument();

    await actor.selectOptions(screen.getByLabelText("Filter by material status"), "all");
    await actor.selectOptions(screen.getByLabelText("Filter by assigned line"), "7");
    expect(screen.getByText("Salt & Pepper Chicken")).toBeInTheDocument();
    expect(screen.queryByText("Oat Milk Chai")).not.toBeInTheDocument();

    await actor.selectOptions(screen.getByLabelText("Filter by assigned line"), "all");
    await actor.type(screen.getByLabelText("Search product or material"), "oat");
    expect(screen.getByText("Oat Milk Chai")).toBeInTheDocument();
    expect(screen.queryByText("Salt & Pepper Chicken")).not.toBeInTheDocument();
  });

  it("updates a selected readiness record through PATCH", async () => {
    const requestSpy = vi
      .spyOn(api, "apiRequest")
      .mockResolvedValue({ ...materials[2], status: "in_process" });
    const onSaved = vi.fn().mockResolvedValue(undefined);
    const actor = userEvent.setup();

    render(
      <MaterialsPanel
        assignments={assignments}
        materials={materials}
        users={users}
        onRaiseIssue={vi.fn()}
        onSaved={onSaved}
      />,
    );

    await actor.click(screen.getByRole("button", { name: "Update status" }));
    expect(screen.getByLabelText("Product code")).toHaveValue("OMC-01");
    expect(screen.getByLabelText("Product name")).toHaveValue("Oat Milk Chai");
    expect(screen.getByLabelText("Status")).toHaveValue("short");
    expect(screen.getByLabelText("Responsible role")).toHaveValue("Materials");

    await actor.selectOptions(screen.getByLabelText("Status"), "in_process");
    await actor.click(
      screen.getByRole("button", { name: "Update readiness item" }),
    );

    await waitFor(() => expect(requestSpy).toHaveBeenCalledOnce());
    expect(requestSpy).toHaveBeenCalledWith(
      "/product-material-readiness/23/",
      expect.objectContaining({
        method: "PATCH",
        body: expect.any(String),
      }),
    );
    const body = JSON.parse(
      (requestSpy.mock.calls[0][1] as { body: string }).body,
    ) as Record<string, unknown>;
    expect(body).toMatchObject({
      responsible_role: "Materials",
      risk_summary: "640 packs",
      expected_action: "Decision due 10:20",
      next_action: "Confirm replenishment",
    });
    expect(onSaved).toHaveBeenCalledWith("Material readiness item updated.");
  });

  it("requires needed-by and responsibility fields in the readiness form", async () => {
    const actor = userEvent.setup();
    render(
      <MaterialsPanel
        assignments={assignments}
        materials={materials}
        users={users}
        onRaiseIssue={vi.fn()}
        onSaved={vi.fn()}
      />,
    );

    await actor.click(screen.getByRole("button", { name: "Add item" }));
    expect(screen.getByLabelText("Needed by")).toBeRequired();
    expect(screen.getByLabelText("Responsible role")).toBeRequired();
  });

  it("does not let a Team Leader release an existing Held record", async () => {
    const actor = userEvent.setup();

    render(
      <MaterialsPanel
        assignments={assignments}
        materials={materials}
        users={users}
        onRaiseIssue={vi.fn()}
        onSaved={vi.fn()}
      />,
    );

    const heldRow = screen.getByRole("row", { name: /BBQ Chicken Bites/i });
    await actor.click(heldRow);
    await actor.click(screen.getByRole("button", { name: "Update status" }));

    expect(screen.getByLabelText("Status")).toBeDisabled();
    expect(screen.getByLabelText("Status")).toHaveValue("held");
  });

  it("routes the selected material into the material escalation workflow", async () => {
    const actor = userEvent.setup();
    const onRaiseIssue = vi.fn();

    render(
      <MaterialsPanel
        assignments={assignments}
        materials={materials}
        users={users}
        onRaiseIssue={onRaiseIssue}
        onSaved={vi.fn()}
      />,
    );

    await actor.click(
      screen.getByRole("button", { name: "Raise material issue" }),
    );

    expect(onRaiseIssue).toHaveBeenCalledOnce();
    expect(onRaiseIssue).toHaveBeenCalledWith(materials[2]);
  });
});
