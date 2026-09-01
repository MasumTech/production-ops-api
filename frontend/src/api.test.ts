import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  apiList,
  apiRequest,
  bindSessionUser,
  flushOfflineActions,
  getOfflineActions,
  login,
  OfflineQueuedError,
  postJson,
} from "./api";

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("API session", () => {
  beforeEach(() => {
    sessionStorage.clear();
    localStorage.clear();
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

  it("queues an offline POST and replays it with the same idempotency key", async () => {
    sessionStorage.setItem(
      "production-ops-session",
      JSON.stringify({ access: "access", refresh: "refresh" }),
    );
    bindSessionUser(7);
    const online = vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);

    await expect(postJson("/hourly-line-updates/", { assignment: 7 })).rejects.toBeInstanceOf(
      OfflineQueuedError,
    );
    const [queued] = getOfflineActions();
    expect(queued.path).toBe("/hourly-line-updates/");

    online.mockReturnValue(true);
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ id: 22 }, 201));
    vi.stubGlobal("fetch", fetchMock);
    const result = await flushOfflineActions();

    expect(result).toEqual({ synced: 1, queued: 0, needsReview: 0 });
    expect(fetchMock.mock.calls[0]?.[1]?.headers).toEqual(
      expect.objectContaining({ "Idempotency-Key": queued.id }),
    );
  });

  it("keeps rejected offline actions for human review", async () => {
    sessionStorage.setItem(
      "production-ops-session",
      JSON.stringify({ access: "access", refresh: "refresh" }),
    );
    bindSessionUser(7);
    const online = vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    await expect(postJson("/break-recoveries/1/start/")).rejects.toBeInstanceOf(
      OfflineQueuedError,
    );
    online.mockReturnValue(true);
    vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ detail: "stale" }, 400)));

    const result = await flushOfflineActions();

    expect(result.needsReview).toBe(1);
    expect(getOfflineActions()[0]?.state).toBe("needs_review");
  });
});
