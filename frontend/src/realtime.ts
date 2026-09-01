import { getAccessToken } from "./api";
import type { OperationalEvent } from "./types";

export type LiveConnectionState = "connecting" | "live" | "retrying" | "offline";

type ServerMessage =
  | { type: "event"; event: OperationalEvent }
  | { type: "ready"; cursor: number }
  | { type: "resync_required"; cursor: number }
  | { type: "pong" };

function cursorKey(userId: number): string {
  return `production-ops-event-cursor:${userId}`;
}

function readCursor(userId: number): number {
  const value = Number(localStorage.getItem(cursorKey(userId)) ?? "0");
  return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

function writeCursor(userId: number, cursor: number): void {
  localStorage.setItem(cursorKey(userId), String(cursor));
}

function websocketUrl(after: number): string {
  const configured = import.meta.env.VITE_WS_BASE_URL?.replace(/\/$/, "");
  if (configured) return `${configured}/ws/operations/?after=${after}`;
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}/ws/operations/?after=${after}`;
}

export function connectOperationalEvents({
  userId,
  onEvent,
  onResync,
  onState,
}: {
  userId: number;
  onEvent: (event: OperationalEvent) => void;
  onResync: (cursor: number) => Promise<boolean>;
  onState: (state: LiveConnectionState) => void;
}): () => void {
  let socket: WebSocket | null = null;
  let stopped = false;
  let retryTimer: number | null = null;
  let heartbeat: number | null = null;
  let attempts = 0;

  const clearTimers = () => {
    if (retryTimer !== null) window.clearTimeout(retryTimer);
    if (heartbeat !== null) window.clearInterval(heartbeat);
    retryTimer = null;
    heartbeat = null;
  };

  const scheduleReconnect = () => {
    if (stopped) return;
    if (!navigator.onLine) {
      onState("offline");
      return;
    }
    onState("retrying");
    const delay = Math.min(30_000, 1_000 * 2 ** Math.min(attempts, 5));
    attempts += 1;
    retryTimer = window.setTimeout(connect, delay);
  };

  const connect = () => {
    const token = getAccessToken();
    if (!token || stopped) return;
    onState(attempts ? "retrying" : "connecting");
    socket = new WebSocket(websocketUrl(readCursor(userId)), [
      "operations.v1",
      `jwt.${token}`,
    ]);

    socket.onmessage = async (message) => {
      const payload = JSON.parse(message.data) as ServerMessage;
      if (payload.type === "event") {
        const current = readCursor(userId);
        if (payload.event.id <= current) return;
        writeCursor(userId, payload.event.id);
        onEvent(payload.event);
      } else if (payload.type === "resync_required") {
        const refreshed = await onResync(payload.cursor);
        if (refreshed) {
          writeCursor(userId, payload.cursor);
          attempts = 0;
          onState("live");
        } else {
          socket?.close();
        }
      } else if (payload.type === "ready") {
        writeCursor(userId, Math.max(readCursor(userId), payload.cursor));
        attempts = 0;
        onState("live");
      }
    };

    socket.onopen = () => {
      heartbeat = window.setInterval(() => {
        if (socket?.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify({ type: "ping" }));
        }
      }, 30_000);
    };
    socket.onerror = () => socket?.close();
    socket.onclose = () => {
      clearTimers();
      scheduleReconnect();
    };
  };

  connect();
  return () => {
    stopped = true;
    clearTimers();
    socket?.close();
  };
}
