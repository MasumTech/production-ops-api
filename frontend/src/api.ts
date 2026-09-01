import type { Paginated } from "./types";

const API_ROOT = (import.meta.env.VITE_API_BASE_URL ?? "/api").replace(/\/$/, "");
const SESSION_KEY = "production-ops-session";
const OUTBOX_KEY = "production-ops-offline-outbox";
const OUTBOX_EVENT = "production-ops:outbox-changed";

interface SessionTokens {
  access: string;
  refresh: string;
  userId?: number;
}

interface RequestOptions extends RequestInit {
  retryAfterRefresh?: boolean;
}

export interface OfflineAction {
  id: string;
  userId: number;
  path: string;
  body: unknown;
  createdAt: string;
  state: "queued" | "needs_review";
  lastError?: string;
}

export interface OfflineSyncResult {
  synced: number;
  queued: number;
  needsReview: number;
}

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly details: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export class OfflineQueuedError extends Error {
  constructor(public readonly queueId: string) {
    super("Saved in the offline outbox. It will sync after the connection returns.");
    this.name = "OfflineQueuedError";
  }
}

function readSession(): SessionTokens | null {
  const raw = sessionStorage.getItem(SESSION_KEY);
  if (!raw) return null;

  try {
    return JSON.parse(raw) as SessionTokens;
  } catch {
    sessionStorage.removeItem(SESSION_KEY);
    return null;
  }
}

export function getAccessToken(): string | null {
  return readSession()?.access ?? null;
}

export function bindSessionUser(userId: number): void {
  const session = readSession();
  if (session) writeSession({ ...session, userId });
}

function writeSession(tokens: SessionTokens): void {
  sessionStorage.setItem(SESSION_KEY, JSON.stringify(tokens));
}

function errorMessage(payload: unknown, fallback: string): string {
  if (typeof payload === "string") return payload;
  if (!payload || typeof payload !== "object") return fallback;

  const values = Object.values(payload as Record<string, unknown>);
  const messages = values.flatMap((value) => {
    if (Array.isArray(value)) return value.map(String);
    if (typeof value === "string") return [value];
    return [];
  });

  return messages.length ? messages.join(" ") : fallback;
}

async function refreshAccessToken(): Promise<boolean> {
  const session = readSession();
  if (!session?.refresh) return false;

  const response = await fetch(`${API_ROOT}/auth/token/refresh/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refresh: session.refresh }),
  });

  if (!response.ok) {
    clearSession();
    return false;
  }

  const payload = (await response.json()) as { access: string; refresh?: string };
  writeSession({
    access: payload.access,
    refresh: payload.refresh ?? session.refresh,
  });
  return true;
}

export function hasSession(): boolean {
  return Boolean(readSession()?.access);
}

export function clearSession(): void {
  sessionStorage.removeItem(SESSION_KEY);
}

function readOutbox(): OfflineAction[] {
  const raw = localStorage.getItem(OUTBOX_KEY);
  if (!raw) return [];
  try {
    const items = JSON.parse(raw) as OfflineAction[];
    return Array.isArray(items) ? items : [];
  } catch {
    localStorage.removeItem(OUTBOX_KEY);
    return [];
  }
}

function writeOutbox(items: OfflineAction[]): void {
  localStorage.setItem(OUTBOX_KEY, JSON.stringify(items));
  window.dispatchEvent(new CustomEvent(OUTBOX_EVENT));
}

function requestId(): string {
  return crypto.randomUUID();
}

function enqueueOfflineAction(path: string, body: unknown, id = requestId()): string {
  const userId = readSession()?.userId;
  if (!userId) {
    throw new ApiError("Refresh your signed-in session before saving offline.", 401, null);
  }
  const items = readOutbox();
  if (items.length >= 50) {
    throw new ApiError(
      "The offline outbox is full. Reconnect and sync before recording another action.",
      507,
      null,
    );
  }
  items.push({
    id,
    userId,
    path,
    body,
    createdAt: new Date().toISOString(),
    state: "queued",
  });
  writeOutbox(items);
  return id;
}

export function getOfflineActions(userId?: number): OfflineAction[] {
  const items = readOutbox();
  return userId ? items.filter((item) => item.userId === userId) : items;
}

export function subscribeToOutbox(listener: () => void): () => void {
  window.addEventListener(OUTBOX_EVENT, listener);
  return () => window.removeEventListener(OUTBOX_EVENT, listener);
}

export async function flushOfflineActions(): Promise<OfflineSyncResult> {
  const items = readOutbox();
  const userId = readSession()?.userId;
  if (!userId) {
    return {
      synced: 0,
      queued: 0,
      needsReview: 0,
    };
  }
  const remaining: OfflineAction[] = [];
  let synced = 0;

  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    if (item.userId !== userId) {
      remaining.push(item);
      continue;
    }
    if (item.state === "needs_review") {
      remaining.push(item);
      continue;
    }

    try {
      await apiRequest(item.path, {
        method: "POST",
        body: JSON.stringify(item.body),
        headers: { "Idempotency-Key": item.id },
      });
      synced += 1;
    } catch (caught) {
      if (caught instanceof ApiError && caught.status >= 400 && caught.status < 500) {
        remaining.push({
          ...item,
          state: "needs_review",
          lastError: caught.message,
        });
        continue;
      }
      remaining.push(item, ...items.slice(index + 1));
      break;
    }
  }

  writeOutbox(remaining);
  return {
    synced,
    queued: remaining.filter(
      (item) => item.userId === userId && item.state === "queued",
    ).length,
    needsReview: remaining.filter(
      (item) => item.userId === userId && item.state === "needs_review",
    ).length,
  };
}

export async function login(username: string, password: string): Promise<void> {
  const response = await fetch(`${API_ROOT}/auth/token/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;

  if (!response.ok) {
    throw new ApiError(
      errorMessage(payload, "Sign-in failed. Check your username and password."),
      response.status,
      payload,
    );
  }

  writeSession({
    access: String(payload.access),
    refresh: String(payload.refresh),
  });
}

export async function apiRequest<T>(
  path: string,
  options: RequestOptions = {},
): Promise<T> {
  const { retryAfterRefresh = true, headers, ...requestOptions } = options;
  const session = readSession();
  const response = await fetch(`${API_ROOT}${path}`, {
    ...requestOptions,
    headers: {
      Accept: "application/json",
      ...(requestOptions.body ? { "Content-Type": "application/json" } : {}),
      ...(session?.access ? { Authorization: `Bearer ${session.access}` } : {}),
      ...headers,
    },
  });

  if (response.status === 401 && retryAfterRefresh && (await refreshAccessToken())) {
    return apiRequest<T>(path, { ...options, retryAfterRefresh: false });
  }

  if (response.status === 204) return undefined as T;

  const payload = (await response.json().catch(() => null)) as unknown;
  if (!response.ok) {
    throw new ApiError(
      errorMessage(payload, `Request failed with status ${response.status}.`),
      response.status,
      payload,
    );
  }

  return payload as T;
}

export async function apiList<T>(path: string): Promise<T[]> {
  const items: T[] = [];
  let currentPath: string | null = path;
  let pages = 0;

  while (currentPath) {
    const payload: Paginated<T> | T[] = await apiRequest<Paginated<T> | T[]>(
      currentPath,
    );
    if (Array.isArray(payload)) return [...items, ...payload];

    items.push(...payload.results);
    currentPath = payload.next ? relativeApiPath(payload.next) : null;
    pages += 1;

    if (pages >= 100 && currentPath) {
      throw new ApiError("Pagination exceeded the safe page limit.", 500, null);
    }
  }

  return items;
}

function relativeApiPath(nextUrl: string): string {
  const root = new URL(`${API_ROOT}/`, window.location.origin);
  const next = new URL(nextUrl, root);
  const rootPath = root.pathname.replace(/\/$/, "");

  if (!next.pathname.startsWith(`${rootPath}/`)) {
    throw new ApiError("The API returned an invalid pagination link.", 500, nextUrl);
  }

  return `${next.pathname.slice(rootPath.length)}${next.search}`;
}

export function postJson<T>(path: string, body?: unknown): Promise<T> {
  const id = requestId();
  if (!navigator.onLine) {
    enqueueOfflineAction(path, body, id);
    return Promise.reject(new OfflineQueuedError(id));
  }

  return apiRequest<T>(path, {
    method: "POST",
    headers: { "Idempotency-Key": id },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }).catch((caught) => {
    if (caught instanceof ApiError) throw caught;
    enqueueOfflineAction(path, body, id);
    throw new OfflineQueuedError(id);
  });
}
