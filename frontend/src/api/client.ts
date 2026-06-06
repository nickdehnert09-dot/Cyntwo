import { storage } from "@/src/utils/storage";

export const CYNLABS_BASE =
  process.env.EXPO_PUBLIC_CYNLABS_API_URL ||
  "https://www.cynlabs.app/api";

export const CYNLABS_WEB =
  process.env.EXPO_PUBLIC_CYNLABS_WEB_URL ||
  "https://www.cynlabs.app";

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

// --- Domain types ---
export type CynUser = {
  id: string;
  email: string;
  firstName?: string | null;
  lastName?: string | null;
  profileImageUrl?: string | null;
};

export type CynSong = {
  id: string;
  sunoId: string;
  title: string;
  artist?: string | null;
  genre?: string | null;
  tags?: string | null;
  lyrics?: string | null;
  audioUrl: string;
  imageUrl?: string | null;
  duration?: number | null;
  isPublic?: boolean;
  createdAt?: string | null;
};

export type ImportResult = {
  inserted: number;
  updated: number;
  total: number;
};

/** Convert a backend SongOut (snake_case) to the frontend CynSong (camelCase). */
export function mapSong(doc: any): CynSong {
  return {
    id: doc.id,
    sunoId: doc.id,
    title: doc.title || "Untitled",
    artist: doc.display_name || doc.handle || null,
    genre: null,
    tags: doc.tags || null,
    lyrics: doc.prompt || null,
    audioUrl: doc.audio_url || "",
    imageUrl: doc.image_url || null,
    duration: doc.duration ?? null,
    isPublic: doc.is_public || false,
    createdAt: doc.imported_at || doc.created_at || null,
  };
}
