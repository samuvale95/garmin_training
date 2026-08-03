import type { ApiErrorBody } from "./types";

export const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://127.0.0.1:8000";

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

export async function apiGet<T>(path: string, params?: Record<string, string | undefined>): Promise<T> {
  const url = new URL(path, API_BASE_URL);
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined) url.searchParams.set(key, value);
    }
  }
  const response = await fetch(url, { cache: "no-store" });
  return handle<T>(response);
}

export async function apiPost<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(new URL(path, API_BASE_URL), {
    method: "POST",
    headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    cache: "no-store",
  });
  return handle<T>(response);
}

export async function apiPostForm<T>(path: string, form: FormData): Promise<T> {
  const response = await fetch(new URL(path, API_BASE_URL), {
    method: "POST",
    body: form,
    cache: "no-store",
  });
  return handle<T>(response);
}
