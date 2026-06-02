# Suno Library — Product Requirements

## Vision
Mobile app (Expo/React Native) that imports a Suno creator's **published** catalog into the **existing CynLabs backend** (`https://cynlabs.xyz/api`) and plays it back natively. **No new backend, no new database.** The local FastAPI under `/app/backend` is unused and kept only as dead code.

## Backend (existing, NOT modified)
- Host: `https://cynlabs.xyz/api`
- Auth: Passport + Google OAuth, **session token returned to mobile via deep link**
  - Start: `GET /api/login?mobile=1&returnUrl=suno-mobile://auth-callback`
  - Server completes Google OAuth, redirects to `suno-mobile://auth-callback?token=<SESSION_ID>`
  - App stores token, sends `Authorization: Bearer <token>` on every request
- Endpoints used by app:
  - `GET /api/auth/user` → `{ user: {...} | null }`
  - `GET /api/songs` → list of `CynSong` (camelCase)
  - `POST /api/songs/import` → body `{ songs: [...] }` → `{ imported, skipped, total, errors }`

## Song schema (CynLabs)
```
sunoId, title, artist, genre, tags, lyrics, audioUrl, imageUrl,
duration, bpm, key, style, model, isPublic, status
```
Mapping from Suno's clip payload happens inside the WebView sniffer (see `app/connect-suno.tsx`).

## Frontend (Expo)
- `app.json` scheme: `suno-mobile` (matches backend's allowed list)
- `(auth)/login` — single "Sign in with Google" button; uses `expo-web-browser` `openAuthSessionAsync`
- `(tabs)/index` — Library list from `GET /api/songs` (artwork, search, sync button)
- `(tabs)/account` — user info, sync, sign-out
- `connect-suno` — WebView at `suno.com/me` with injected `fetch`/`XHR` sniffer; filters strict `is_public === true`; remaps to CynLabs schema; POSTs to `/api/songs/import`
- `player` — full-screen audio player (seek / shuffle / repeat / next / prev); built on `expo-audio`
- `MiniPlayer` — sticky above tab bar

## Why the WebView capture works
Injected JS runs inside `suno.com` origin, so Suno's own Clerk-authenticated cookies are automatically sent on `fetch` calls — we just patch `window.fetch`/`XHR` to clone responses and look for clip arrays with `is_public === true`. Zero copy-paste, zero session-cookie handling for Suno.

## What was removed in this iteration
- Local FastAPI auth (JWT, register/login) — unwired
- Local FastAPI library + favorites + share endpoints — unwired
- Favorites tab — backend doesn't have favorites yet (skipped for v1)
- Public share-link feature — backend doesn't have shares (skipped for v1)
- Signup screen — replaced by single Google sign-in

## Known constraints
- `cynlabs.xyz` DNS does not resolve from the Emergent preview pod — the OAuth flow can only be verified on a real device (or a network with public DNS access).
- Background audio playback (lock-screen controls) needs a native build; preview / Expo Go is foreground only.
