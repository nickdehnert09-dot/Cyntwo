/**
 * CynLabs API client.
 *
 * Backend: https://cynlabs-production.up.railway.app/api  (Railway, single domain serving both web + API)
 * Auth: Bearer token (returned by mobile OAuth flow as the deep-link `token` query param).
 *
 * The base URL is baked into the bundle at build time from EXPO_PUBLIC_CYNLABS_API_URL
 * in the active EAS profile's env. Falls back to the Railway prod URL if unset.
 */
import { storage } from "@/src/utils/storage";

export const CYNLABS_BASE =
  process.env.EXPO_PUBLIC_CYNLABS_API_URL ||
  "https://cynlabs-production.up.railway.app/api";
const TOKEN_KEY = "cynlabs_token";

export type ApiError = { message: string; status: number };

async function getToken(): Promise<string | null> {
  return await storage.secureGet<string>(TOKEN_KEY, "");
}

export async function setToken(token: string): Promise<void> {
  await storage.secureSet(TOKEN_KEY, token);
}

export async function clearToken(): Promise<void> {
  await storage.secureRemove(TOKEN_KEY);
}

export async function api<T = any>(
  path: string,
  options: { method?: string; body?: any; auth?: boolean } = {},
): Promise<T> {
  const { method = "GET", body, auth = true } = options;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (auth) {
    const token = await getToken();
    if (token) headers.Authorization = `Bearer ${token}`;
  }
  const res = await fetch(`${CYNLABS_BASE}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const data = text
    ? (() => { try { return JSON.parse(text); } catch { return text; } })()
    : null;
  if (!res.ok) {
    const message =
      (data && typeof data === "object" && (data.message || data.error || data.detail)) ||
      `Request failed (${res.status})`;
    const err: ApiError = { message: String(message), status: res.status };
    throw err;
  }
  return data as T;
}

// --- Domain types matching CynLabs schema ---
export type CynUser = {
  id: string;
  email: string;
  firstName?: string | null;
  lastName?: string | null;
  profileImageUrl?: string | null;
};

export type CynSong = {
  id: string;            // CynLabs internal id
  sunoId: string;
  title: string;
  artist?: string | null;
  genre?: string | null;
  tags?: string | null;
  lyrics?: string | null;
  audioUrl: string;
  imageUrl?: string | null;
  duration?: number | null;
  bpm?: number | null;
  key?: string | null;
  style?: string | null;
  model?: string | null;
  isPublic?: boolean;
  status?: string | null;
  createdAt?: string | null;
};

export type ImportResult = {
  imported: number;
  skipped: number;
  total: number;
  errors?: { sunoId?: string; message?: string }[];
};
