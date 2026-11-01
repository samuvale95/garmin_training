import { getAccessToken } from "./auth";
import { trackApi } from "./tracker";
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
function requestSignal(signal?: AbortSignal, timeoutMs: number = REQUEST_TIMEOUT_MS): AbortSignal | undefined {
  const timeout =
    typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function"
      ? AbortSignal.timeout(timeoutMs)
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

/** `fetch` that tells the interaction log about failures and slow answers. A network
 * error or timeout has no response, so it is recorded here with status 0. */
async function timedFetch(input: URL, init: RequestInit): Promise<Response> {
  const startedAt = performance.now();
  try {
    const response = await fetch(input, init);
    trackApi(response.url || input.toString(), response.status, startedAt);
    return response;
  } catch (error) {
    trackApi(input.toString(), 0, startedAt);
    throw error;
  }
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
  if (BATCHING) return batchedGet<T>(url, signal);
  const response = await timedFetch(url, { cache: "no-store", signal: requestSignal(signal), headers: await authHeaders() });
  return handle<T>(response);
}

// ---- read batching ---------------------------------------------------------------------
//
// Reads started within the same few milliseconds (a screen mounting a dozen queries) go
// out as one `POST /batch`; the server answers each as an NDJSON line as soon as it is
// ready, so a slow one holds up only itself. Anything the batch could not answer --
// network error, older server without /batch, a line that never came -- falls back to
// its own plain request, so batching can only remove round trips, never lose a read.

const BATCHING = typeof window !== "undefined";
const BATCH_WINDOW_MS = 8;
const BATCH_MAX = 40;

interface PendingGet {
  url: URL;
  signal?: AbortSignal;
  resolve: (response: Response) => void;
  reject: (error: unknown) => void;
}

let queue: PendingGet[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;

function batchedGet<T>(url: URL, signal?: AbortSignal): Promise<T> {
  return new Promise<Response>((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason);
      return;
    }
    queue.push({ url, signal, resolve, reject });
    if (queue.length >= BATCH_MAX) flush();
    else if (!flushTimer) flushTimer = setTimeout(flush, BATCH_WINDOW_MS);
  }).then((response) => handle<T>(response));
}

async function single(item: PendingGet): Promise<void> {
  try {
    item.resolve(await timedFetch(item.url, { cache: "no-store", signal: requestSignal(item.signal), headers: await authHeaders() }));
  } catch (error) {
    item.reject(error);
  }
}

function flush(): void {
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = null;
  const items = queue.filter((item) => !item.signal?.aborted);
  for (const item of queue) if (item.signal?.aborted) item.reject(item.signal.reason);
  queue = [];
  if (items.length === 0) return;
  if (items.length === 1) {
    void single(items[0]);
    return;
  }
  void sendBatch(items);
}

async function sendBatch(items: PendingGet[]): Promise<void> {
  const settled = new Set<number>();
  try {
    const response = await timedFetch(new URL("/batch", API_BASE_URL), {
      method: "POST",
      headers: { ...(await authHeaders()), "Content-Type": "application/json" },
      body: JSON.stringify({ paths: items.map((item) => item.url.pathname + item.url.search) }),
      cache: "no-store",
      signal: requestSignal(undefined),
    });
    if (!response.ok || !response.body) throw new Error(`batch ${response.status}`);
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (value) buffer += decoder.decode(value, { stream: true });
      let newline: number;
      while ((newline = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        if (!line.trim()) continue;
        const { i, status, body } = JSON.parse(line) as { i: number; status: number; body: unknown };
        const item = items[i];
        if (!item || settled.has(i)) continue;
        settled.add(i);
        if (item.signal?.aborted) item.reject(item.signal.reason);
        else item.resolve(new Response(status === 204 ? null : JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }));
      }
      if (done) break;
    }
  } catch {
    // Fall through: whatever was not answered is fetched on its own below.
  }
  items.forEach((item, i) => {
    if (!settled.has(i)) void single(item);
  });
}

export async function apiGetBlob(
  path: string,
  params?: Record<string, string | undefined>
): Promise<Blob> {
  const url = new URL(path, API_BASE_URL);
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined) url.searchParams.set(key, value);
    }
  }
  const response = await timedFetch(url, { cache: "no-store", headers: await authHeaders() });
  if (!response.ok) {
    throw new Error(`Download failed with status ${response.status}`);
  }
  return await response.blob();
}

/** `timeoutMs` for the few calls that are slow by design (plan generation waits on a
 * model); everything else keeps the default above. */
export async function apiPost<T>(path: string, body?: unknown, signal?: AbortSignal, timeoutMs?: number): Promise<T> {
  const response = await timedFetch(new URL(path, API_BASE_URL), {
    method: "POST",
    headers: { ...(await authHeaders()), ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    cache: "no-store",
    signal: requestSignal(signal, timeoutMs),
  });
  return handle<T>(response);
}

export async function apiPut<T>(path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  const response = await timedFetch(new URL(path, API_BASE_URL), {
    method: "PUT",
    headers: { ...(await authHeaders()), ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    cache: "no-store",
    signal: requestSignal(signal),
  });
  return handle<T>(response);
}

export async function apiPostForm<T>(path: string, form: FormData): Promise<T> {
  const response = await timedFetch(new URL(path, API_BASE_URL), {
    method: "POST",
    headers: await authHeaders(),
    body: form,
    cache: "no-store",
    signal: requestSignal(),
  });
  return handle<T>(response);
}

export async function apiPatch<T>(path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  const response = await timedFetch(new URL(path, API_BASE_URL), {
    method: "PATCH",
    headers: { ...(await authHeaders()), ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    cache: "no-store",
    signal: requestSignal(signal),
  });
  return handle<T>(response);
}

export async function apiDelete<T>(path: string, signal?: AbortSignal): Promise<T> {
  const response = await timedFetch(new URL(path, API_BASE_URL), {
    method: "DELETE",
    headers: await authHeaders(),
    cache: "no-store",
    signal: requestSignal(signal),
  });
  return handle<T>(response);
}

/** Absolute URL for a server-relative path (e.g. a `FoodEntry.image_url`), for use
 * directly in an `<img src>` -- the API base is the host, not the app's own origin.
 * If path is already a data: URI or an absolute URL, returns it as-is. */
export function apiUrl(path: string): string {
  if (path.startsWith("data:") || path.startsWith("http://") || path.startsWith("https://")) {
    return path;
  }
  return new URL(path, API_BASE_URL).toString();
}

/** Whether a failed request is worth repeating by itself: the server was asleep or briefly
 * unreachable, not wrong. The free hosting tier sleeps after 15 idle minutes and takes
 * 30-60 s to wake, longer than one request's timeout, so the first screen after a pause
 * used to fail almost entirely with errors that a second attempt would not have had. */
export function isTransientError(error: unknown): boolean {
  if (error instanceof ApiError) return error.status === 502 || error.status === 503 || error.status === 504;
  if (error instanceof DOMException) return error.name === "TimeoutError";
  // fetch rejects with a TypeError when the connection itself fails.
  return error instanceof TypeError;
}

/** Starts waking the server the moment the app opens, before any screen asks for data,
 * and resolves when it answers. Long timeout on purpose: this is the one request that is
 * expected to wait out a cold start. */
export async function wakeServer(timeoutMs = 90_000): Promise<boolean> {
  try {
    const response = await fetch(new URL("/health", API_BASE_URL), {
      cache: "no-store",
      signal: requestSignal(undefined, timeoutMs),
    });
    return response.ok;
  } catch {
    return false;
  }
}
