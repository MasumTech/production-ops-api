import type { Paginated } from "./types";

const API_ROOT = (import.meta.env.VITE_API_BASE_URL ?? "/api").replace(/\/$/, "");
const SESSION_KEY = "production-ops-session";

interface SessionTokens {
  access: string;
  refresh: string;
}

interface RequestOptions extends RequestInit {
  retryAfterRefresh?: boolean;
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
  return apiRequest<T>(path, {
    method: "POST",
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
