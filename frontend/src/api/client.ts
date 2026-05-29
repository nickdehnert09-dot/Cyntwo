import { storage } from "@/src/utils/storage";

const BASE = process.env.EXPO_PUBLIC_BACKEND_URL ?? "";
const TOKEN_KEY = "auth_token";

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
  const res = await fetch(`${BASE}/api${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const data = text ? (() => { try { return JSON.parse(text); } catch { return text; } })() : null;
  if (!res.ok) {
    const message =
      (data && typeof data === "object" && (data.detail || data.message)) ||
      `Request failed (${res.status})`;
    const err: ApiError = { message: String(message), status: res.status };
    throw err;
  }
  return data as T;
}

export type Song = {
  id: string;
  title: string;
  audio_url: string | null;
  image_url: string | null;
  video_url: string | null;
  tags: string;
  prompt: string;
  duration: number | null;
  play_count: number;
  like_count: number;
  created_at: string | null;
  handle: string | null;
  display_name: string | null;
  is_favorite: boolean;
  is_public: boolean;
  imported_at: string;
};

export type User = { id: string; email: string; created_at: string };
