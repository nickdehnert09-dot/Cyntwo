# Suno Library — Product Requirements

## Vision
A native-feeling mobile audio player for Suno AI creators. Users sign in, then import their entire public Suno catalog in one tap via an in-app WebView and play it back with a real audio player (mini + full-screen).

## Why this approach
Suno deprecated the legacy `studio-api.suno.ai/api/profile/v2/{username}` endpoint (now HTTP 503). Public profile pages are React Server Components that no longer ship song data in HTML, and all current API calls require a Clerk-authenticated session. So the only sane way to fetch a user's library is to let them sign in inside a WebView and capture their already-authenticated traffic.

## Architecture

### Backend (FastAPI + MongoDB)
- `POST /api/auth/register`, `POST /api/auth/login`, `GET /api/auth/me` — JWT (30d) + bcrypt
- `POST /api/library/import` — bulk upsert of song dicts (dedupes by `(user_id, song_id)`)
- `GET /api/library?favorites_only=` — list user's songs, newest first
- `POST /api/library/favorite/{song_id}` — toggle
- `DELETE /api/library/song/{song_id}`, `DELETE /api/library` — remove
- `POST /api/library/share/{song_id}` — create/get short share slug (idempotent, per-user)
- `DELETE /api/library/share/{song_id}` — revoke share
- `GET /api/share/{slug}/info` — **public** JSON metadata, increments view counter
- `GET /api/share/{slug}` — **public** SSR'd HTML listen page with og/twitter:player meta tags + native `<audio>` element + signup funnel CTA

### Frontend (Expo Router, expo-audio, react-native-webview)
- `(auth)/login`, `(auth)/signup`
- `(tabs)/index` Library, `(tabs)/favorites`, `(tabs)/account`
- `connect-suno` modal — WebView pointed at `suno.com/me`, injected JS hooks `window.fetch` + `XMLHttpRequest` before content load and posts captured clip arrays back to RN
- `player` modal — full-screen Now Playing with seek, shuffle, repeat, favorite
- `MiniPlayer` — sticky above tab bar
- `PlayerContext` — expo-audio based with queue, shuffle, repeat, seek

## Key technical notes
- Background audio: `expo-audio` is configured with `shouldPlayInBackground: true` + `UIBackgroundModes:["audio"]` in app.json. **Requires a native build to actually play in the background** — won't work in Expo Go.
- WebView importer: works because the injected JS runs inside `suno.com` origin, so Clerk's HttpOnly session cookie is automatically attached by the browser to every fetch — we never have to touch the cookie ourselves.
