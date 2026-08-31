import { beforeEach, describe, expect, it, vi } from "vitest";

import { apiList, apiRequest, login } from "./api";

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("API session", () => {
  beforeEach(() => {
    sessionStorage.clear();
    vi.restoreAllMocks();
  });

  it("refreshes an expired access token once and retries the request", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ access: "old-access", refresh: "refresh-token" }))
      .mockResolvedValueOnce(jsonResponse({ detail: "expired" }, 401))
      .mockResolvedValueOnce(jsonResponse({ access: "new-access" }))
      .mockResolvedValueOnce(jsonResponse({ id: 2, username: "team.leader" }));
    vi.stubGlobal("fetch", fetchMock);

    await login("team.leader", "password");
    const profile = await apiRequest<{ id: number; username: string }>("/auth/me/");

    expect(profile.username).toBe("team.leader");
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(fetchMock.mock.calls[3]?.[1]?.headers).toEqual(
      expect.objectContaining({ Authorization: "Bearer new-access" }),
    );
  });

  it("follows trusted API pagination links", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ access: "access", refresh: "refresh" }))
      .mockResolvedValueOnce(
        jsonResponse({
          count: 2,
          next: "http://localhost/api/items/?page=2",
          previous: null,
          results: [{ id: 1 }],
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          count: 2,
          next: null,
          previous: "http://localhost/api/items/",
          results: [{ id: 2 }],
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    await login("team.leader", "password");
    const items = await apiList<{ id: number }>("/items/");

    expect(items).toEqual([{ id: 1 }, { id: 2 }]);
    expect(fetchMock.mock.calls[2]?.[0]).toBe("/api/items/?page=2");
  });
});
