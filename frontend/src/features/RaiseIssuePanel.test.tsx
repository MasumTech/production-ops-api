import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as api from "../api";
import type { Assignment, LineUpdate } from "../types";
import { RaiseIssuePanel } from "./RaiseIssuePanel";

const assignment: Assignment = {
  id: 12,
  team_leader: 2,
  team_leader_username: "demo.leader",
  production_line: 22,
  production_line_code: "DEMO-LINE-02",
  production_line_name: "Secondary Packing",
  date: "2026-09-04",
  shift_type: "day",
  notes: "",
};

const update: LineUpdate = {
  id: 31,
  assignment: assignment.id,
  production_line: assignment.production_line,
  production_line_code: assignment.production_line_code,
  production_line_name: assignment.production_line_name,
  status: "amber",
  current_product: "Oat Milk Chai",
  issue_summary: "Seal concern",
  action_taken: "Machine Minder checking",
  action_owner: null,
  action_owner_username: null,
  support_required: "Engineering",
  requires_follow_up: true,
  recorded_at: "2026-09-04T10:12:00Z",
  next_update_due_at: "2026-09-04T10:22:00Z",
};

const savedResponse = {
  line_update: update,
  escalation: null,
  evidence: null,
};

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

function renderPanel(
  overrides: Partial<React.ComponentProps<typeof RaiseIssuePanel>> = {},
) {
  const onSaved = vi.fn().mockResolvedValue(undefined);
  const onCancel = vi.fn();
  render(
    <RaiseIssuePanel
      assignments={[assignment]}
      updates={[update]}
      selectedAssignment={assignment.id}
      initialMode="escalation"
      initialEscalation={null}
      online
      onSaved={onSaved}
      onCancel={onCancel}
      {...overrides}
    />,
  );
  return { onSaved, onCancel };
}

describe("Raise Issue v2", () => {
  it("matches the structured three-step issue reference", () => {
    renderPanel();

    expect(screen.getByRole("heading", { name: "Raise issue" })).toBeInTheDocument();
    expect(screen.getByText("Describe", { exact: true })).toBeInTheDocument();
    expect(screen.getByText("Support", { exact: true })).toBeInTheDocument();
    expect(screen.getByText("Follow-up", { exact: true })).toBeInTheDocument();
    expect(screen.getByLabelText("Line")).toHaveDisplayValue(
      "Line 2 · Oat Milk Chai",
    );
    expect(screen.getByRole("button", { name: "AMBER" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByLabelText("Category")).toHaveDisplayValue(
      "Machine / seal",
    );
    expect(screen.getByLabelText("Support required")).toHaveDisplayValue(
      "Engineering",
    );
    expect(screen.getByLabelText("Action owner")).toHaveDisplayValue(
      "Engineering",
    );
    expect(screen.getByRole("button", { name: "Add evidence" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save draft" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Request support" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save & escalate" })).toBeInTheDocument();
    expect(
      screen.getByText(/does not replace the procedure/i),
    ).toBeInTheDocument();
  });

  it("saves an offline-safe local draft without creating an operational record", async () => {
    const postSpy = vi.spyOn(api, "postJson");
    const actor = userEvent.setup();
    const { onSaved } = renderPanel();

    await actor.type(screen.getByLabelText("Short problem"), "Seal concern");
    await actor.click(screen.getByRole("button", { name: "Save draft" }));

    expect(postSpy).not.toHaveBeenCalled();
    expect(onSaved).toHaveBeenCalledWith("Issue draft saved on this device.");
    const draft = JSON.parse(
      localStorage.getItem("team-leader-issue-draft:12") ?? "{}",
    ) as { shortProblem?: string };
    expect(draft.shortProblem).toBe("Seal concern");
  });

  it("records a support request through the atomic issue capture endpoint", async () => {
    const postSpy = vi
      .spyOn(api, "postJson")
      .mockResolvedValue(savedResponse as never);
    const actor = userEvent.setup();
    const { onSaved } = renderPanel();

    await actor.type(
      screen.getByLabelText("Short problem"),
      "Seal concern after former change",
    );
    await actor.type(
      screen.getByLabelText("Immediate control"),
      "Line slowed; Machine Minder checking",
    );
    await actor.click(screen.getByRole("button", { name: "Request support" }));

    await waitFor(() => expect(postSpy).toHaveBeenCalledOnce());
    expect(postSpy).toHaveBeenCalledWith(
      "/issue-captures/",
      expect.objectContaining({
        assignment: 12,
        status: "amber",
        category: "equipment",
        current_product: "Oat Milk Chai",
        short_problem: "Seal concern after former change",
        immediate_control: "Line slowed; Machine Minder checking",
        support_required: "engineering",
        action_owner_role: "engineering",
        next_update_minutes: 10,
        escalate: false,
      }),
    );
    expect(onSaved).toHaveBeenCalledWith("Support request recorded.");
  });

  it("saves and escalates a non-green issue", async () => {
    const postSpy = vi.spyOn(api, "postJson").mockResolvedValue({
      ...savedResponse,
      escalation: { id: 91 },
    } as never);
    const actor = userEvent.setup();
    const { onSaved } = renderPanel();

    await actor.type(screen.getByLabelText("Short problem"), "Seal concern");
    await actor.type(screen.getByLabelText("Immediate control"), "Line slowed");
    await actor.click(screen.getByRole("button", { name: "Save & escalate" }));

    await waitFor(() => expect(postSpy).toHaveBeenCalledOnce());
    expect(postSpy).toHaveBeenCalledWith(
      "/issue-captures/",
      expect.objectContaining({ escalate: true }),
    );
    expect(onSaved).toHaveBeenCalledWith(
      "Issue recorded and escalated to the attention queue.",
    );
  });

  it("uses multipart submission when evidence is attached", async () => {
    const postFormSpy = vi
      .spyOn(api, "postForm")
      .mockResolvedValue(savedResponse as never);
    const actor = userEvent.setup();
    renderPanel();

    await actor.type(screen.getByLabelText("Short problem"), "Seal concern");
    const evidence = new File(["photo"], "seal-photo.png", {
      type: "image/png",
    });
    await actor.upload(screen.getByLabelText("Evidence file"), evidence);
    expect(
      screen.getByRole("button", { name: /seal-photo\.png/i }),
    ).toBeInTheDocument();

    await actor.click(screen.getByRole("button", { name: "Request support" }));

    await waitFor(() => expect(postFormSpy).toHaveBeenCalledOnce());
    expect(postFormSpy.mock.calls[0][0]).toBe("/issue-captures/");
    expect(postFormSpy.mock.calls[0][1]).toBeInstanceOf(FormData);
  });

  it("returns to My Lines when Cancel is selected", async () => {
    const actor = userEvent.setup();
    const { onCancel } = renderPanel();

    await actor.click(screen.getByRole("button", { name: "Cancel" }));

    expect(onCancel).toHaveBeenCalledOnce();
  });
});
