import { getAccessToken } from "./auth";
import type { ApiErrorBody } from "./types";

export const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://127.0.0.1:8000";

/** Every route on the backend now requires a signed-in caller (see `api/app.py`'s
 * auth-gated routers) -- this is the one place that attaches the header, so no call
 * site can forget it. `null` (signed out) still sends the request rather than short-
 * circuiting: the backend's 401 is the single source of truth for "not authenticated,"
 * so the UI's redirect-to-login logic only has to react to `ApiError` with
 * `category === "auth_failed"`, not duplicate a client-side check here too. */
async function authHeaders(): Promise<Record<string, string>> {
  const token = await getAccessToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export class ApiError extends Error {
  category: ApiErrorBody["category"];
  details: string[];
  retryAfterSeconds: number | null;
  status: number;

  constructor(status: number, body: ApiErrorBody) {
    super(body.message);
    this.name = "ApiError";
    this.status = status;
    this.category = body.category;
    this.details = body.details ?? [];
    this.retryAfterSeconds = body.retry_after_seconds ?? null;
  }
}

/** Longest we'll wait on the backend before giving up.
 *
 * Every endpoint here fans out to Garmin or Strava, and a hung upstream call used to
 * hang the query forever -- there was no timeout and no abort, so a screen could wait
 * indefinitely with nothing to show. */
const REQUEST_TIMEOUT_MS = 25_000;

/** Combines the caller's abort signal (TanStack Query passes one per query, aborted when
 * the query is cancelled or its component unmounts) with the timeout above.
 *
 * Combined by hand rather than with `AbortSignal.any`, which needs Safari 17.4+ -- this
 * runs as an installed iOS PWA, where the browser is whatever the phone is on. Likewise
 * `AbortSignal.timeout` is only used when present: losing the timeout on an old browser
 * is a degradation, but a `TypeError` would fail every single request.
 */
function requestSignal(signal?: AbortSignal): AbortSignal | undefined {
  const timeout =
    typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function"
      ? AbortSignal.timeout(REQUEST_TIMEOUT_MS)
      : undefined;
  if (!signal) return timeout;
  if (!timeout) return signal;

  const controller = new AbortController();
  for (const source of [signal, timeout]) {
    if (source.aborted) {
      controller.abort(source.reason);
      break;
    }
    source.addEventListener("abort", () => controller.abort(source.reason), { once: true });
  }
  return controller.signal;
}

async function handle<T>(response: Response): Promise<T> {
  if (!response.ok) {
    let body: ApiErrorBody;
    try {
      body = await response.json();
    } catch {
      body = { category: "server_error", message: response.statusText, details: [] };
    }
    throw new ApiError(response.status, body);
  }
  if (response.status === 204) {
    return undefined as T;
  }
  return (await response.json()) as T;
}

export async function apiGet<T>(
  path: string,
  params?: Record<string, string | undefined>,
  signal?: AbortSignal
): Promise<T> {
  const url = new URL(path, API_BASE_URL);
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined) url.searchParams.set(key, value);
    }
  }
  const response = await fetch(url, { cache: "no-store", signal: requestSignal(signal), headers: await authHeaders() });
  return handle<T>(response);
}

export async function apiPost<T>(path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  const response = await fetch(new URL(path, API_BASE_URL), {
    method: "POST",
    headers: { ...(await authHeaders()), ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    cache: "no-store",
    signal: requestSignal(signal),
  });
  return handle<T>(response);
}

export async function apiPut<T>(path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  const response = await fetch(new URL(path, API_BASE_URL), {
    method: "PUT",
    headers: { ...(await authHeaders()), ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    cache: "no-store",
    signal: requestSignal(signal),
  });
  return handle<T>(response);
}

export async function apiPostForm<T>(path: string, form: FormData): Promise<T> {
  const response = await fetch(new URL(path, API_BASE_URL), {
    method: "POST",
    headers: await authHeaders(),
    body: form,
    cache: "no-store",
    signal: requestSignal(),
  });
  return handle<T>(response);
}

export async function apiPatch<T>(path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  const response = await fetch(new URL(path, API_BASE_URL), {
    method: "PATCH",
    headers: { ...(await authHeaders()), ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    cache: "no-store",
    signal: requestSignal(signal),
  });
  return handle<T>(response);
}

export async function apiDelete<T>(path: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(new URL(path, API_BASE_URL), {
    method: "DELETE",
    headers: await authHeaders(),
    cache: "no-store",
    signal: requestSignal(signal),
  });
  return handle<T>(response);
}

/** Absolute URL for a server-relative path (e.g. a `FoodEntry.image_url`), for use
 * directly in an `<img src>` -- the API base is the host, not the app's own origin. */
export function apiUrl(path: string): string {
  return new URL(path, API_BASE_URL).toString();
}
