"""
Backend API tests for Suno Library.

Covers:
- Auth: register / login / me / duplicate email / unauth access
- Library: import (insert + dedupe + update), list (sort + projection + favorites filter),
  favorite toggle, delete single, delete all
"""
import os
import time
import uuid

import pytest
import requests

BASE_URL = os.environ["EXPO_PUBLIC_BACKEND_URL"].rstrip("/") if os.environ.get("EXPO_PUBLIC_BACKEND_URL") else None
if not BASE_URL:
    # Fallback to frontend .env publicly-known URL only if not in env, otherwise fail-fast.
    BASE_URL = "https://music-player-sync-2.preview.emergentagent.com"

DEMO_EMAIL = "demo@suno.app"
DEMO_PASSWORD = "demopass123"


@pytest.fixture(scope="session")
def api():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture(scope="session")
def new_user(api):
    email = f"test_{uuid.uuid4().hex[:10]}@test.app"
    password = "testpass123"
    r = api.post(f"{BASE_URL}/api/auth/register", json={"email": email, "password": password})
    assert r.status_code == 200, r.text
    data = r.json()
    assert "token" in data and "user" in data
    assert data["user"]["email"] == email.lower()
    return {"email": email, "password": password, "token": data["token"], "id": data["user"]["id"]}


@pytest.fixture(scope="session")
def auth_headers(new_user):
    return {"Authorization": f"Bearer {new_user['token']}", "Content-Type": "application/json"}


# --- Auth ---
class TestAuth:
    def test_root(self, api):
        r = api.get(f"{BASE_URL}/api/")
        assert r.status_code == 200
        assert r.json().get("ok") is True

    def test_register_duplicate_returns_409(self, api, new_user):
        r = api.post(
            f"{BASE_URL}/api/auth/register",
            json={"email": new_user["email"], "password": "anotherpass"},
        )
        assert r.status_code == 409

    def test_login_demo_account(self, api):
        r = api.post(
            f"{BASE_URL}/api/auth/login",
            json={"email": DEMO_EMAIL, "password": DEMO_PASSWORD},
        )
        # Demo may or may not exist; only assert structure if 200
        if r.status_code == 200:
            data = r.json()
            assert data["user"]["email"] == DEMO_EMAIL
            assert "token" in data
        else:
            pytest.skip(f"Demo account not available: {r.status_code}")

    def test_login_invalid_credentials(self, api, new_user):
        r = api.post(
            f"{BASE_URL}/api/auth/login",
            json={"email": new_user["email"], "password": "wrongpass"},
        )
        assert r.status_code == 401

    def test_me_returns_user(self, api, auth_headers, new_user):
        r = api.get(f"{BASE_URL}/api/auth/me", headers=auth_headers)
        assert r.status_code == 200
        data = r.json()
        assert data["email"] == new_user["email"]
        assert data["id"] == new_user["id"]

    def test_me_without_token_401(self, api):
        r = requests.get(f"{BASE_URL}/api/auth/me")
        assert r.status_code == 401

    def test_library_without_token_401(self, api):
        r = requests.get(f"{BASE_URL}/api/library")
        assert r.status_code == 401


# --- Library ---
SAMPLE_SONGS = [
    {
        "id": "song-A",
        "title": "TEST Track A",
        "audio_url": "https://example.com/a.mp3",
        "image_url": "https://example.com/a.jpg",
        "tags": "lofi, chill",
        "prompt": "lofi chill",
        "duration": 180.5,
        "play_count": 10,
        "like_count": 2,
        "created_at": "2025-01-01T10:00:00Z",
        "handle": "tester",
        "display_name": "Tester",
    },
    {
        "id": "song-B",
        "title": "TEST Track B",
        "audio_url": "https://example.com/b.mp3",
        "tags": "ambient",
        "duration": 240.0,
        "created_at": "2025-03-01T10:00:00Z",
    },
    {
        "id": "song-C",
        "title": "TEST Track C",
        "audio_url": "https://example.com/c.mp3",
        "tags": "rock",
        "created_at": "2025-02-01T10:00:00Z",
    },
]


class TestLibrary:
    def test_import_inserts(self, api, auth_headers):
        r = api.post(
            f"{BASE_URL}/api/library/import",
            json={"songs": SAMPLE_SONGS},
            headers=auth_headers,
        )
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["inserted"] == 3
        assert data["updated"] == 0
        assert data["total"] == 3

    def test_import_dedupes_and_updates(self, api, auth_headers):
        modified = [{**SAMPLE_SONGS[0], "title": "TEST Track A (updated)"}]
        r = api.post(
            f"{BASE_URL}/api/library/import",
            json={"songs": modified},
            headers=auth_headers,
        )
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["inserted"] == 0
        assert data["updated"] == 1
        assert data["total"] == 3  # still 3, no duplicates

    def test_list_library_sorted_and_no_internal_fields(self, api, auth_headers):
        r = api.get(f"{BASE_URL}/api/library", headers=auth_headers)
        assert r.status_code == 200
        songs = r.json()
        assert isinstance(songs, list)
        assert len(songs) == 3
        ids = [s["id"] for s in songs]
        # sorted by created_at desc -> B (2025-03), C (2025-02), A (2025-01)
        assert ids == ["song-B", "song-C", "song-A"]
        # verify update propagated and projection clean
        a = next(s for s in songs if s["id"] == "song-A")
        assert a["title"] == "TEST Track A (updated)"
        assert "_id" not in a
        assert "user_id" not in a
        assert a["is_favorite"] is False

    def test_favorite_toggle(self, api, auth_headers):
        r = api.post(f"{BASE_URL}/api/library/favorite/song-A", headers=auth_headers)
        assert r.status_code == 200
        assert r.json()["is_favorite"] is True
        # GET and verify
        r2 = api.get(f"{BASE_URL}/api/library", headers=auth_headers)
        a = next(s for s in r2.json() if s["id"] == "song-A")
        assert a["is_favorite"] is True

    def test_favorites_only_filter(self, api, auth_headers):
        r = api.get(f"{BASE_URL}/api/library?favorites_only=true", headers=auth_headers)
        assert r.status_code == 200
        songs = r.json()
        assert len(songs) == 1
        assert songs[0]["id"] == "song-A"
        assert songs[0]["is_favorite"] is True

    def test_favorite_toggle_again_unfavorites(self, api, auth_headers):
        r = api.post(f"{BASE_URL}/api/library/favorite/song-A", headers=auth_headers)
        assert r.status_code == 200
        assert r.json()["is_favorite"] is False

    def test_favorite_unknown_song_404(self, api, auth_headers):
        r = api.post(f"{BASE_URL}/api/library/favorite/does-not-exist", headers=auth_headers)
        assert r.status_code == 404

    def test_delete_single_song(self, api, auth_headers):
        r = api.delete(f"{BASE_URL}/api/library/song/song-C", headers=auth_headers)
        assert r.status_code == 200
        assert r.json()["ok"] is True
        # Verify
        r2 = api.get(f"{BASE_URL}/api/library", headers=auth_headers)
        ids = [s["id"] for s in r2.json()]
        assert "song-C" not in ids
        assert len(ids) == 2

    def test_delete_song_404(self, api, auth_headers):
        r = api.delete(f"{BASE_URL}/api/library/song/song-C", headers=auth_headers)
        assert r.status_code == 404

    def test_clear_library_zzz(self, api, auth_headers):
        # named _zzz so it runs last (pytest preserves file order, but be safe)
        r = api.delete(f"{BASE_URL}/api/library", headers=auth_headers)
        assert r.status_code == 200
        assert r.json()["deleted"] == 2
        # Verify empty
        r2 = api.get(f"{BASE_URL}/api/library", headers=auth_headers)
        assert r2.json() == []


# --- User scoping ---
class TestUserScoping:
    def test_other_user_cannot_see_first_user_songs(self, api):
        # create user A, import a song
        emailA = f"TEST_{uuid.uuid4().hex[:8]}@a.app"
        emailB = f"TEST_{uuid.uuid4().hex[:8]}@b.app"
        rA = api.post(f"{BASE_URL}/api/auth/register", json={"email": emailA, "password": "passpass"})
        rB = api.post(f"{BASE_URL}/api/auth/register", json={"email": emailB, "password": "passpass"})
        assert rA.status_code == 200 and rB.status_code == 200
        hA = {"Authorization": f"Bearer {rA.json()['token']}", "Content-Type": "application/json"}
        hB = {"Authorization": f"Bearer {rB.json()['token']}", "Content-Type": "application/json"}
        api.post(
            f"{BASE_URL}/api/library/import",
            json={"songs": [{"id": "private-1", "title": "private", "audio_url": "x"}]},
            headers=hA,
        )
        # User B should see empty
        rL = api.get(f"{BASE_URL}/api/library", headers=hB)
        assert rL.status_code == 200
        assert rL.json() == []
        # cleanup
        api.delete(f"{BASE_URL}/api/library", headers=hA)
