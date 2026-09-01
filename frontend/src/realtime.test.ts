import { beforeEach, describe, expect, it, vi } from "vitest";

import { connectOperationalEvents } from "./realtime";

class FakeWebSocket {
  static OPEN = 1;
  static instances: FakeWebSocket[] = [];

  readyState = FakeWebSocket.OPEN;
  onopen: (() => void) | null = null;
  onmessage: ((message: MessageEvent) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;

  constructor(
    readonly url: string,
    readonly protocols: string[],
  ) {
    FakeWebSocket.instances.push(this);
  }

  send = vi.fn();

  close() {
    this.onclose?.();
  }

  emit(payload: unknown) {
    this.onmessage?.({ data: JSON.stringify(payload) } as MessageEvent);
  }
}

describe("operational event stream", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.setItem(
      "production-ops-session",
      JSON.stringify({ access: "signed.jwt.token", refresh: "refresh" }),
    );
    FakeWebSocket.instances = [];
    vi.stubGlobal("WebSocket", FakeWebSocket);
  });

  it("authenticates by subprotocol and advances a user-scoped cursor", () => {
    const onEvent = vi.fn();
    const onState = vi.fn();
    const stop = connectOperationalEvents({
      userId: 9,
      onEvent,
      onResync: vi.fn().mockResolvedValue(true),
      onState,
    });
    const socket = FakeWebSocket.instances[0];

    expect(socket.url).toContain("/ws/operations/?after=0");
    expect(socket.protocols).toEqual(["operations.v1", "jwt.signed.jwt.token"]);
    expect(socket.url).not.toContain("signed.jwt.token");

    socket.emit({
      type: "event",
      event: {
        id: 42,
        event_type: "line_update.changed",
        resource_type: "hourlylineupdate",
        resource_id: 3,
        assignment: 8,
        production_line: 2,
        actor: 9,
        severity: "warning",
        metadata: {},
        occurred_at: "2026-09-01T10:00:00Z",
      },
    });
    socket.emit({ type: "ready", cursor: 42 });

    expect(onEvent).toHaveBeenCalledTimes(1);
    expect(onState).toHaveBeenLastCalledWith("live");
    expect(localStorage.getItem("production-ops-event-cursor:9")).toBe("42");
    stop();
  });

  it("advances an overflow cursor only after an authoritative refresh", async () => {
    const onResync = vi.fn().mockResolvedValue(true);
    const stop = connectOperationalEvents({
      userId: 4,
      onEvent: vi.fn(),
      onResync,
      onState: vi.fn(),
    });

    FakeWebSocket.instances[0].emit({ type: "resync_required", cursor: 700 });

    await vi.waitFor(() => expect(onResync).toHaveBeenCalledWith(700));
    expect(localStorage.getItem("production-ops-event-cursor:4")).toBe("700");
    stop();
  });

  it("keeps the old cursor when authoritative refresh fails", async () => {
    localStorage.setItem("production-ops-event-cursor:5", "12");
    const stop = connectOperationalEvents({
      userId: 5,
      onEvent: vi.fn(),
      onResync: vi.fn().mockResolvedValue(false),
      onState: vi.fn(),
    });

    FakeWebSocket.instances[0].emit({ type: "resync_required", cursor: 900 });
    await new Promise((resolve) => window.setTimeout(resolve, 0));
    expect(localStorage.getItem("production-ops-event-cursor:5")).toBe("12");
    stop();
  });
});
