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
from dotenv import load_dotenv
from fastapi import APIRouter, Depends, FastAPI, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import BaseModel, EmailStr, Field
from starlette.middleware.cors import CORSMiddleware


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
    logger.info("Indexes ready")


@app.on_event("shutdown")
async def _shutdown():
    client.close()
