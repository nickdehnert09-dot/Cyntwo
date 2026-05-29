"""Suno Library mobile app backend.

Auth: JWT email/password.
Library: per-user store of Suno songs imported via the in-app WebView session capture.
"""
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, List, Optional
import logging
import os
import uuid

import bcrypt
import jwt
import secrets
from dotenv import load_dotenv
from fastapi import APIRouter, Depends, FastAPI, HTTPException, status
from fastapi.responses import HTMLResponse
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import BaseModel, EmailStr, Field
from starlette.middleware.cors import CORSMiddleware
from html import escape as h


ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

# --- Config ---
MONGO_URL = os.environ["MONGO_URL"]
DB_NAME = os.environ["DB_NAME"]
JWT_SECRET = os.environ.get("JWT_SECRET", "dev-secret-change-me-please")
JWT_ALG = "HS256"
JWT_EXPIRY_DAYS = 30

client = AsyncIOMotorClient(MONGO_URL)
db = client[DB_NAME]
bearer = HTTPBearer(auto_error=False)

app = FastAPI(title="Suno Library API")
api = APIRouter(prefix="/api")


# --- Utils ---
def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(password: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(password.encode("utf-8"), hashed.encode("utf-8"))
    except Exception:
        return False


def create_token(user_id: str) -> str:
    payload = {
        "sub": user_id,
        "iat": now_utc(),
        "exp": now_utc() + timedelta(days=JWT_EXPIRY_DAYS),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALG)


async def get_current_user(
    creds: Optional[HTTPAuthorizationCredentials] = Depends(bearer),
) -> dict:
    if not creds:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Missing token")
    try:
        payload = jwt.decode(creds.credentials, JWT_SECRET, algorithms=[JWT_ALG])
        user_id = payload.get("sub")
    except jwt.PyJWTError:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid token")
    user = await db.users.find_one({"id": user_id}, {"_id": 0, "password_hash": 0})
    if not user:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "User not found")
    return user


# --- Schemas ---
class RegisterIn(BaseModel):
    email: EmailStr
    password: str = Field(min_length=6, max_length=128)


class LoginIn(BaseModel):
    email: EmailStr
    password: str


class AuthOut(BaseModel):
    token: str
    user: dict


class UserOut(BaseModel):
    id: str
    email: str
    created_at: datetime


class SongIn(BaseModel):
    """Shape produced by the WebView injected JS, normalized from Suno's payload."""

    id: str
    title: Optional[str] = "Untitled"
    audio_url: Optional[str] = None
    image_url: Optional[str] = None
    video_url: Optional[str] = None
    tags: Optional[str] = ""
    prompt: Optional[str] = ""
    duration: Optional[float] = None
    play_count: Optional[int] = 0
    like_count: Optional[int] = 0
    created_at: Optional[str] = None
    handle: Optional[str] = None
    display_name: Optional[str] = None
    is_public: Optional[bool] = False


class ImportIn(BaseModel):
    songs: List[SongIn]


class ImportOut(BaseModel):
    inserted: int
    updated: int
    total: int


class SongOut(BaseModel):
    id: str
    title: str
    audio_url: Optional[str]
    image_url: Optional[str]
    video_url: Optional[str]
    tags: str
    prompt: str
    duration: Optional[float]
    play_count: int
    like_count: int
    created_at: Optional[str]
    handle: Optional[str]
    display_name: Optional[str]
    is_favorite: bool
    imported_at: datetime


# --- Auth routes ---
@api.post("/auth/register", response_model=AuthOut)
async def register(payload: RegisterIn):
    email = payload.email.lower().strip()
    existing = await db.users.find_one({"email": email})
    if existing:
        raise HTTPException(status.HTTP_409_CONFLICT, "Email already registered")
    user_id = str(uuid.uuid4())
    doc = {
        "id": user_id,
        "email": email,
        "password_hash": hash_password(payload.password),
        "created_at": now_utc(),
    }
    await db.users.insert_one(doc)
    token = create_token(user_id)
    return {
        "token": token,
        "user": {"id": user_id, "email": email, "created_at": doc["created_at"].isoformat()},
    }


@api.post("/auth/login", response_model=AuthOut)
async def login(payload: LoginIn):
    email = payload.email.lower().strip()
    user = await db.users.find_one({"email": email})
    if not user or not verify_password(payload.password, user["password_hash"]):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid credentials")
    token = create_token(user["id"])
    return {
        "token": token,
        "user": {
            "id": user["id"],
            "email": user["email"],
            "created_at": user["created_at"].isoformat(),
        },
    }


@api.get("/auth/me")
async def me(user: dict = Depends(get_current_user)):
    return {
        "id": user["id"],
        "email": user["email"],
        "created_at": user["created_at"].isoformat() if isinstance(user["created_at"], datetime) else user["created_at"],
    }


# --- Library routes ---
@api.post("/library/import", response_model=ImportOut)
async def import_library(payload: ImportIn, user: dict = Depends(get_current_user)):
    inserted = 0
    updated = 0
    user_id = user["id"]
    for s in payload.songs:
        if not s.id:
            continue
        existing = await db.songs.find_one({"user_id": user_id, "id": s.id}, {"_id": 0})
        doc = {
            "user_id": user_id,
            "id": s.id,
            "title": s.title or "Untitled",
            "audio_url": s.audio_url,
            "image_url": s.image_url,
            "video_url": s.video_url,
            "tags": s.tags or "",
            "prompt": s.prompt or "",
            "duration": s.duration,
            "play_count": s.play_count or 0,
            "like_count": s.like_count or 0,
            "created_at": s.created_at,
            "handle": s.handle,
            "display_name": s.display_name,
        }
        if existing:
            doc["is_favorite"] = existing.get("is_favorite", False)
            doc["imported_at"] = existing.get("imported_at", now_utc())
            await db.songs.update_one(
                {"user_id": user_id, "id": s.id}, {"$set": doc}
            )
            updated += 1
        else:
            doc["is_favorite"] = False
            doc["imported_at"] = now_utc()
            await db.songs.insert_one(doc)
            inserted += 1
    total = await db.songs.count_documents({"user_id": user_id})
    return {"inserted": inserted, "updated": updated, "total": total}


def _project_song(doc: dict) -> dict:
    return {
        "id": doc["id"],
        "title": doc.get("title", "Untitled"),
        "audio_url": doc.get("audio_url"),
        "image_url": doc.get("image_url"),
        "video_url": doc.get("video_url"),
        "tags": doc.get("tags", ""),
        "prompt": doc.get("prompt", ""),
        "duration": doc.get("duration"),
        "play_count": doc.get("play_count", 0),
        "like_count": doc.get("like_count", 0),
        "created_at": doc.get("created_at"),
        "handle": doc.get("handle"),
        "display_name": doc.get("display_name"),
        "is_favorite": doc.get("is_favorite", False),
        "is_public": doc.get("is_public", False),
        "imported_at": doc.get("imported_at", now_utc()).isoformat()
        if isinstance(doc.get("imported_at"), datetime)
        else doc.get("imported_at"),
    }


@api.get("/library")
async def list_library(
    favorites_only: bool = False,
    user: dict = Depends(get_current_user),
) -> list:
    q: dict[str, Any] = {"user_id": user["id"]}
    if favorites_only:
        q["is_favorite"] = True
    cursor = db.songs.find(q, {"_id": 0, "user_id": 0, "password_hash": 0}).sort(
        "created_at", -1
    )
    docs = await cursor.to_list(length=2000)
    return [_project_song(d) for d in docs]


@api.post("/library/favorite/{song_id}")
async def toggle_favorite(song_id: str, user: dict = Depends(get_current_user)):
    song = await db.songs.find_one({"user_id": user["id"], "id": song_id}, {"_id": 0})
    if not song:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Song not found")
    new_val = not song.get("is_favorite", False)
    await db.songs.update_one(
        {"user_id": user["id"], "id": song_id}, {"$set": {"is_favorite": new_val}}
    )
    return {"id": song_id, "is_favorite": new_val}


@api.delete("/library/song/{song_id}")
async def delete_song(song_id: str, user: dict = Depends(get_current_user)):
    res = await db.songs.delete_one({"user_id": user["id"], "id": song_id})
    if res.deleted_count == 0:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Song not found")
    return {"ok": True}


@api.delete("/library")
async def clear_library(user: dict = Depends(get_current_user)):
    res = await db.songs.delete_many({"user_id": user["id"]})
    return {"deleted": res.deleted_count}


@api.delete("/library/unpublished")
async def clear_unpublished(user: dict = Depends(get_current_user)):
    """Remove songs that aren't flagged is_public=true (drafts / discarded versions)."""
    res = await db.songs.delete_many(
        {"user_id": user["id"], "is_public": {"$ne": True}}
    )
    return {"deleted": res.deleted_count}


# --- Share routes ---
def _make_slug() -> str:
    # 8-char url-safe slug from secrets (≈ 47 bits, plenty for a non-guessable share link)
    return secrets.token_urlsafe(6)[:8]


@api.post("/library/share/{song_id}")
async def create_share(song_id: str, user: dict = Depends(get_current_user)):
    song = await db.songs.find_one({"user_id": user["id"], "id": song_id}, {"_id": 0})
    if not song:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Song not found")
    if not song.get("audio_url"):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Song has no playable audio")
    existing = await db.shares.find_one({"user_id": user["id"], "song_id": song_id}, {"_id": 0})
    if existing:
        slug = existing["slug"]
    else:
        # try a few times for uniqueness
        for _ in range(5):
            slug = _make_slug()
            if not await db.shares.find_one({"slug": slug}):
                break
        else:
            raise HTTPException(500, "Could not allocate share slug")
        await db.shares.insert_one(
            {
                "slug": slug,
                "user_id": user["id"],
                "song_id": song_id,
                "created_at": now_utc(),
                "views": 0,
            }
        )
    return {"slug": slug, "path": f"/api/share/{slug}"}


@api.delete("/library/share/{song_id}")
async def revoke_share(song_id: str, user: dict = Depends(get_current_user)):
    res = await db.shares.delete_one({"user_id": user["id"], "song_id": song_id})
    return {"ok": True, "deleted": res.deleted_count}


async def _resolve_share(slug: str) -> dict:
    share = await db.shares.find_one({"slug": slug}, {"_id": 0})
    if not share:
        raise HTTPException(404, "Share not found")
    song = await db.songs.find_one(
        {"user_id": share["user_id"], "id": share["song_id"]},
        {"_id": 0, "user_id": 0},
    )
    if not song:
        raise HTTPException(404, "Song no longer available")
    await db.shares.update_one({"slug": slug}, {"$inc": {"views": 1}})
    return {"share": share, "song": song}


@api.get("/share/{slug}/info")
async def share_info(slug: str):
    """Public JSON endpoint for in-app preview before sharing."""
    data = await _resolve_share(slug)
    s = data["song"]
    return {
        "slug": slug,
        "title": s.get("title", "Untitled"),
        "audio_url": s.get("audio_url"),
        "image_url": s.get("image_url"),
        "tags": s.get("tags", ""),
        "duration": s.get("duration"),
        "display_name": s.get("display_name"),
        "handle": s.get("handle"),
        "views": data["share"].get("views", 0) + 1,
    }


def _share_html(slug: str, song: dict, share_url: str) -> str:
    title = song.get("title") or "Untitled"
    audio_url = song.get("audio_url") or ""
    image_url = song.get("image_url") or ""
    artist = song.get("display_name") or song.get("handle") or "Suno artist"
    tags = song.get("tags") or ""
    duration = song.get("duration") or 0
    duration_s = int(duration) if duration else 0
    return f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover" />
<title>{h(title)} — Suno Library</title>
<meta name="description" content="{h(artist)} on Suno Library. Listen now." />
<meta property="og:type" content="music.song" />
<meta property="og:title" content="{h(title)}" />
<meta property="og:description" content="By {h(artist)} · Listen on Suno Library" />
<meta property="og:image" content="{h(image_url)}" />
<meta property="og:audio" content="{h(audio_url)}" />
<meta property="og:audio:type" content="audio/mpeg" />
<meta property="music:duration" content="{duration_s}" />
<meta property="music:musician" content="{h(artist)}" />
<meta name="twitter:card" content="player" />
<meta name="twitter:title" content="{h(title)}" />
<meta name="twitter:description" content="By {h(artist)} · Listen on Suno Library" />
<meta name="twitter:image" content="{h(image_url)}" />
<meta name="twitter:player" content="{h(share_url)}" />
<meta name="twitter:player:width" content="480" />
<meta name="twitter:player:height" content="600" />
<link rel="icon" href="data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><circle cx=%2250%22 cy=%2250%22 r=%2240%22 fill=%22%23FF8C00%22/></svg>" />
<style>
  :root {{ color-scheme: dark; }}
  * {{ box-sizing: border-box; }}
  html, body {{ margin: 0; height: 100%; background: #0A0A0A; color: #F5F5F5; font-family: -apple-system, system-ui, sans-serif; -webkit-font-smoothing: antialiased; }}
  body {{ position: relative; overflow-x: hidden; }}
  .bg {{ position: fixed; inset: 0; background-image: url("{h(image_url)}"); background-size: cover; background-position: center; filter: blur(60px) saturate(1.3); opacity: 0.55; transform: scale(1.15); z-index: 0; }}
  .scrim {{ position: fixed; inset: 0; background: linear-gradient(180deg, rgba(10,10,10,0.4) 0%, rgba(10,10,10,0.85) 60%, #0A0A0A 100%); z-index: 1; }}
  .wrap {{ position: relative; z-index: 2; min-height: 100vh; display: flex; flex-direction: column; padding: 24px; max-width: 520px; margin: 0 auto; }}
  .brand {{ display: flex; align-items: center; gap: 8px; font-size: 12px; letter-spacing: 2.5px; font-weight: 700; }}
  .brand .dot {{ width: 8px; height: 8px; border-radius: 4px; background: #FF8C00; box-shadow: 0 0 16px #FF8C00; }}
  .art {{ width: 100%; aspect-ratio: 1; max-width: 360px; align-self: center; margin: 28px auto 22px; border-radius: 22px; overflow: hidden; background: #181818; box-shadow: 0 30px 60px rgba(0,0,0,0.55); }}
  .art img {{ width: 100%; height: 100%; object-fit: cover; display: block; }}
  .title {{ font-size: 28px; font-weight: 800; letter-spacing: -0.5px; line-height: 1.15; }}
  .artist {{ color: #A3A3A3; font-size: 15px; margin-top: 6px; }}
  .tags {{ color: #737373; font-size: 12px; margin-top: 10px; }}
  audio {{ width: 100%; margin-top: 22px; accent-color: #FF8C00; }}
  audio::-webkit-media-controls-panel {{ background-color: rgba(255,255,255,0.04); }}
  .cta {{ display: flex; align-items: center; justify-content: center; gap: 8px; margin-top: 28px; padding: 14px 18px; border-radius: 28px; background: #FF8C00; color: #0A0A0A; text-decoration: none; font-weight: 800; font-size: 15px; box-shadow: 0 14px 30px rgba(255,140,0,0.35); }}
  .cta:hover {{ filter: brightness(1.05); }}
  .footer {{ margin-top: auto; padding-top: 32px; color: #737373; font-size: 12px; text-align: center; line-height: 1.5; }}
  .footer a {{ color: #A3A3A3; text-decoration: none; }}
</style>
</head>
<body>
<div class="bg" aria-hidden="true"></div>
<div class="scrim" aria-hidden="true"></div>
<main class="wrap">
  <div class="brand"><span class="dot"></span><span>SUNO LIBRARY</span></div>
  <div class="art">{"<img src='" + h(image_url) + "' alt='" + h(title) + "' />" if image_url else ""}</div>
  <div class="title">{h(title)}</div>
  <div class="artist">By {h(artist)}</div>
  {"<div class='tags'>" + h(tags) + "</div>" if tags else ""}
  <audio controls preload="metadata" src="{h(audio_url)}"></audio>
  <a class="cta" href="/" >Build your own library →</a>
  <div class="footer">
    Shared via <a href="/">Suno Library</a> · A native audio player for Suno creators
  </div>
</main>
</body>
</html>"""


@api.get("/share/{slug}", response_class=HTMLResponse)
async def share_page(slug: str):
    """Public HTML page for share link recipients."""
    data = await _resolve_share(slug)
    song = data["song"]
    share_url = f"/api/share/{slug}"
    return HTMLResponse(_share_html(slug, song, share_url))


@api.get("/")
async def root():
    return {"name": "Suno Library API", "ok": True}


# --- App wiring ---
app.include_router(api)
app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
logger = logging.getLogger(__name__)


@app.on_event("startup")
async def _startup():
    await db.users.create_index("email", unique=True)
    await db.songs.create_index([("user_id", 1), ("id", 1)], unique=True)
    await db.songs.create_index("user_id")
    await db.shares.create_index("slug", unique=True)
    await db.shares.create_index([("user_id", 1), ("song_id", 1)], unique=True)
    logger.info("Indexes ready")


@app.on_event("shutdown")
async def _shutdown():
    client.close()
