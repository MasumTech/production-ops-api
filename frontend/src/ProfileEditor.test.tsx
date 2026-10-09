import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";

import * as api from "./api";
import { ProfileEditor } from "./ProfileEditor";
import type { UserSummary } from "./types";

afterEach(() => vi.restoreAllMocks());

it("updates all editable profile fields without allowing role changes", async () => {
  const actor = userEvent.setup();
  const profile: UserSummary = {
    id: 7,
    username: "team.leader",
    display_name: "Team Leader",
    first_name: "Team",
    last_name: "Leader",
    email: "leader@example.com",
    phone_number: "+44 7700 900111",
    is_staff: false,
    workspace: "team_leader",
  };
  const updated = { ...profile, first_name: "Imran", display_name: "Imran Leader" };
  const request = vi.spyOn(api, "apiRequest").mockResolvedValue(updated);
  const onSaved = vi.fn();
  const onClose = vi.fn();

  render(<ProfileEditor profile={profile} open onClose={onClose} onSaved={onSaved} />);
  await actor.clear(screen.getByLabelText("First name"));
  await actor.type(screen.getByLabelText("First name"), "Imran");
  await actor.click(screen.getByRole("button", { name: "Save profile" }));

  expect(request).toHaveBeenCalledWith("/auth/me/", expect.objectContaining({ method: "PATCH" }));
  const submitted = JSON.parse(String(request.mock.calls[0][1]?.body));
  expect(submitted).toEqual({
    first_name: "Imran",
    last_name: "Leader",
    username: "team.leader",
    email: "leader@example.com",
    phone_number: "+44 7700 900111",
  });
  expect(submitted).not.toHaveProperty("workspace");
  expect(onSaved).toHaveBeenCalledWith(updated);
  expect(onClose).toHaveBeenCalled();
});
