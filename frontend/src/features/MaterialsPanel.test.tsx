import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import * as api from "../api";
import type { Assignment, MaterialReadiness, UserChoice } from "../types";
import { MaterialsPanel } from "./MaterialsPanel";

const assignment: Assignment = {
  id: 7,
  team_leader: 2,
  team_leader_username: "team.leader",
  production_line: 3,
  production_line_code: "LINE-03",
  production_line_name: "Ready Meals",
  date: "2026-09-04",
  shift_type: "day",
  notes: "",
};

const users: UserChoice[] = [
  { id: 9, username: "materials.owner", display_name: "Materials Owner" },
];

const material: MaterialReadiness = {
  id: 21,
  assignment: assignment.id,
  production_line: assignment.production_line,
  production_line_code: assignment.production_line_code,
  sequence_number: 1,
  product_code: "FILM-01",
  product_name: "Film roll",
  planned_quantity: 500,
  status: "short",
  shortage_quantity: 80,
  owner: users[0].id,
  owner_username: users[0].username,
  expected_available_at: "2026-09-04T10:30:00Z",
  hold_reason: "",
  notes: "Stores contacted",
};

afterEach(() => vi.restoreAllMocks());

describe("Team Leader materials reference", () => {
  it("keeps the approved simple readiness table as the default view", () => {
    render(
      <MaterialsPanel
        assignments={[assignment]}
        materials={[material]}
        users={users}
        onSaved={vi.fn()}
      />,
    );

    expect(
      screen.getByRole("heading", { name: "Product & material readiness" }),
    ).toBeInTheDocument();
    expect(screen.getByText("FILM-01")).toBeInTheDocument();
    expect(screen.getByText("Film roll")).toBeInTheDocument();
    expect(screen.queryByRole("tab")).not.toBeInTheDocument();
    expect(
      screen.queryByLabelText("Filter by material status"),
    ).not.toBeInTheDocument();
  });

  it("updates the selected readiness record through PATCH instead of Add item", async () => {
    const requestSpy = vi
      .spyOn(api, "apiRequest")
      .mockResolvedValue({ ...material, status: "in_process" });
    const onSaved = vi.fn().mockResolvedValue(undefined);
    const actor = userEvent.setup();

    render(
      <MaterialsPanel
        assignments={[assignment]}
        materials={[material]}
        users={users}
        onSaved={onSaved}
      />,
    );

    await actor.click(screen.getByText("Film roll"));
    await actor.click(screen.getByRole("button", { name: "Update status" }));

    expect(screen.getByLabelText("Product code")).toHaveValue("FILM-01");
    expect(screen.getByLabelText("Product name")).toHaveValue("Film roll");
    expect(screen.getByLabelText("Status")).toHaveValue("short");

    await actor.selectOptions(screen.getByLabelText("Status"), "in_process");
    await actor.click(
      screen.getByRole("button", { name: "Update readiness item" }),
    );

    await waitFor(() => expect(requestSpy).toHaveBeenCalledOnce());
    expect(requestSpy).toHaveBeenCalledWith(
      "/product-material-readiness/21/",
      expect.objectContaining({
        method: "PATCH",
        body: expect.any(String),
      }),
    );
    expect(onSaved).toHaveBeenCalledWith("Material readiness item updated.");
  });

  it("does not let a Team Leader release an existing Held record", async () => {
    const actor = userEvent.setup();
    const held = {
      ...material,
      status: "held" as const,
      shortage_quantity: 0,
      expected_available_at: null,
      hold_reason: "QA hold",
    };

    render(
      <MaterialsPanel
        assignments={[assignment]}
        materials={[held]}
        users={users}
        onSaved={vi.fn()}
      />,
    );

    await actor.click(screen.getByText("Film roll"));
    await actor.click(screen.getByRole("button", { name: "Update status" }));

    expect(screen.getByLabelText("Status")).toBeDisabled();
    expect(screen.getByLabelText("Status")).toHaveValue("held");
  });
});
