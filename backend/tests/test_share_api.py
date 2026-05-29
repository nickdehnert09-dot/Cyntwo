"""
Backend API tests for the 'Share track' viral discovery feature.

Covers:
- POST /api/library/share/{song_id} — auth required, idempotent slug creation
- POST /api/library/share/{song_id} — 404 unknown song, 400 missing audio, 401 unauth
- GET  /api/share/{slug}/info     — public, returns metadata + increments views
- GET  /api/share/{slug}/info     — 404 unknown slug
- GET  /api/share/{slug}          — public HTML with og:audio / og:image / twitter:player meta
- GET  /api/share/{slug}          — view counter increments on each call
- DELETE /api/library/share/{song_id} — auth required, makes slug 404
- Per-user share scoping (User B cannot delete User A's share; same song gets distinct slugs)
- Re-import does not invalidate existing share slug
"""
import os
import re
import uuid

import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://music-player-sync-2.preview.emergentagent.com").rstrip("/")


@pytest.fixture(scope="module")
def api():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


def _register(api, suffix):
    email = f"test_share_{suffix}_{uuid.uuid4().hex[:8]}@test.app"
    r = api.post(f"{BASE_URL}/api/auth/register", json={"email": email, "password": "passpass"})
    assert r.status_code == 200, r.text
    d = r.json()
    return {
        "email": email,
        "token": d["token"],
        "id": d["user"]["id"],
        "headers": {"Authorization": f"Bearer {d['token']}", "Content-Type": "application/json"},
    }


@pytest.fixture(scope="module")
def user_a(api):
    u = _register(api, "a")
    # import 2 songs: one with audio, one without
    songs = [
        {
            "id": "share-song-1",
            "title": "TEST Share Song 1",
            "audio_url": "https://example.com/share1.mp3",
            "image_url": "https://example.com/share1.jpg",
            "tags": "lofi, share",
            "duration": 123.4,
            "display_name": "Share Artist",
            "handle": "shareartist",
            "created_at": "2025-06-01T10:00:00Z",
        },
        {
            "id": "share-song-no-audio",
            "title": "TEST No Audio",
            "audio_url": None,
            "created_at": "2025-06-02T10:00:00Z",
        },
    ]
    r = api.post(f"{BASE_URL}/api/library/import", json={"songs": songs}, headers=u["headers"])
    assert r.status_code == 200, r.text
    yield u
    # cleanup
    api.delete(f"{BASE_URL}/api/library", headers=u["headers"])


@pytest.fixture(scope="module")
def user_b(api):
    u = _register(api, "b")
    # user B imports same id to confirm per-user scoping
    songs = [
        {
            "id": "share-song-1",
            "title": "TEST B Same ID",
            "audio_url": "https://example.com/b.mp3",
            "image_url": "https://example.com/b.jpg",
            "created_at": "2025-06-03T10:00:00Z",
        }
    ]
    r = api.post(f"{BASE_URL}/api/library/import", json={"songs": songs}, headers=u["headers"])
    assert r.status_code == 200, r.text
    yield u
    api.delete(f"{BASE_URL}/api/library", headers=u["headers"])


# ---------- POST /api/library/share/{song_id} ----------
class TestCreateShare:
    def test_requires_auth(self, api):
        r = api.post(f"{BASE_URL}/api/library/share/share-song-1")
        assert r.status_code == 401

    def test_404_unknown_song(self, api, user_a):
        r = api.post(f"{BASE_URL}/api/library/share/does-not-exist", headers=user_a["headers"])
        assert r.status_code == 404

    def test_400_when_song_has_no_audio(self, api, user_a):
        r = api.post(
            f"{BASE_URL}/api/library/share/share-song-no-audio",
            headers=user_a["headers"],
        )
        assert r.status_code == 400

    def test_create_returns_slug_and_path(self, api, user_a):
        r = api.post(f"{BASE_URL}/api/library/share/share-song-1", headers=user_a["headers"])
        assert r.status_code == 200, r.text
        data = r.json()
        assert "slug" in data and isinstance(data["slug"], str) and len(data["slug"]) >= 6
        assert data["path"] == f"/api/share/{data['slug']}"
        # stash for later tests
        pytest.share_slug_a = data["slug"]

    def test_create_is_idempotent(self, api, user_a):
        # calling twice should yield same slug
        r1 = api.post(f"{BASE_URL}/api/library/share/share-song-1", headers=user_a["headers"])
        r2 = api.post(f"{BASE_URL}/api/library/share/share-song-1", headers=user_a["headers"])
        assert r1.status_code == 200 and r2.status_code == 200
        assert r1.json()["slug"] == r2.json()["slug"] == pytest.share_slug_a


# ---------- GET /api/share/{slug}/info ----------
class TestShareInfo:
    def test_info_public_no_auth(self, api):
        # no Authorization header
        r = requests.get(f"{BASE_URL}/api/share/{pytest.share_slug_a}/info")
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["slug"] == pytest.share_slug_a
        assert data["title"] == "TEST Share Song 1"
        assert data["audio_url"] == "https://example.com/share1.mp3"
        assert data["image_url"] == "https://example.com/share1.jpg"
        assert data["display_name"] == "Share Artist"
        assert data["handle"] == "shareartist"
        assert isinstance(data["views"], int) and data["views"] >= 1

    def test_info_increments_view_counter(self, api):
        r1 = requests.get(f"{BASE_URL}/api/share/{pytest.share_slug_a}/info")
        v1 = r1.json()["views"]
        r2 = requests.get(f"{BASE_URL}/api/share/{pytest.share_slug_a}/info")
        v2 = r2.json()["views"]
        assert v2 == v1 + 1, f"views did not increment ({v1} -> {v2})"

    def test_info_404_for_invalid_slug(self, api):
        r = requests.get(f"{BASE_URL}/api/share/totally-bogus-slug/info")
        assert r.status_code == 404


# ---------- GET /api/share/{slug} (HTML) ----------
class TestShareHTML:
    def test_html_public_and_has_meta_tags(self, api):
        r = requests.get(f"{BASE_URL}/api/share/{pytest.share_slug_a}")
        assert r.status_code == 200, r.text
        assert "text/html" in r.headers.get("content-type", "").lower()
        body = r.text
        # OpenGraph + Twitter player meta tags
        assert 'property="og:audio"' in body
        assert "https://example.com/share1.mp3" in body
        assert 'property="og:image"' in body
        assert "https://example.com/share1.jpg" in body
        assert 'name="twitter:player"' in body
        assert 'property="og:title"' in body
        assert "TEST Share Song 1" in body
        # <audio> element pointing at the audio url
        assert re.search(r"<audio[^>]+src=\"https://example\.com/share1\.mp3\"", body)

    def test_html_view_counter_increments(self, api):
        # snapshot from /info
        before = requests.get(f"{BASE_URL}/api/share/{pytest.share_slug_a}/info").json()["views"]
        # hit the HTML twice
        requests.get(f"{BASE_URL}/api/share/{pytest.share_slug_a}")
        requests.get(f"{BASE_URL}/api/share/{pytest.share_slug_a}")
        after = requests.get(f"{BASE_URL}/api/share/{pytest.share_slug_a}/info").json()["views"]
        # 2 HTML hits + 1 info hit = +3, info returns views+1 so diff should be >= 3
        assert after - before >= 3, f"expected >=3 increment, got {before} -> {after}"

    def test_html_404_for_invalid_slug(self, api):
        r = requests.get(f"{BASE_URL}/api/share/totally-bogus-slug")
        assert r.status_code == 404


# ---------- Re-import does not invalidate share ----------
class TestReimportPersistence:
    def test_share_slug_persists_after_reimport(self, api, user_a):
        # re-import same song with updated title
        songs = [
            {
                "id": "share-song-1",
                "title": "TEST Share Song 1 (re-imported)",
                "audio_url": "https://example.com/share1.mp3",
                "image_url": "https://example.com/share1.jpg",
                "tags": "lofi, share, updated",
                "created_at": "2025-06-01T10:00:00Z",
            }
        ]
        r = api.post(f"{BASE_URL}/api/library/import", json={"songs": songs}, headers=user_a["headers"])
        assert r.status_code == 200
        assert r.json()["updated"] == 1
        # share slug should still resolve, and title should now reflect update
        r2 = requests.get(f"{BASE_URL}/api/share/{pytest.share_slug_a}/info")
        assert r2.status_code == 200
        assert r2.json()["title"] == "TEST Share Song 1 (re-imported)"


# ---------- Per-user scoping ----------
class TestShareScoping:
    def test_user_b_gets_own_slug_for_same_song_id(self, api, user_b):
        r = api.post(f"{BASE_URL}/api/library/share/share-song-1", headers=user_b["headers"])
        assert r.status_code == 200
        data = r.json()
        assert data["slug"] != pytest.share_slug_a, "User B must get a distinct slug"
        pytest.share_slug_b = data["slug"]
        # Resolves to User B's song
        info = requests.get(f"{BASE_URL}/api/share/{pytest.share_slug_b}/info").json()
        assert info["title"] == "TEST B Same ID"

    def test_user_b_cannot_revoke_user_a_share(self, api, user_b):
        # User B attempts to delete by song_id — should not affect User A's share
        r = api.delete(f"{BASE_URL}/api/library/share/share-song-1", headers=user_b["headers"])
        assert r.status_code == 200  # deletes B's own
        # A's share still works
        r2 = requests.get(f"{BASE_URL}/api/share/{pytest.share_slug_a}/info")
        assert r2.status_code == 200, "User A's share must be untouched"


# ---------- DELETE /api/library/share/{song_id} ----------
class TestRevokeShare:
    def test_revoke_requires_auth(self, api):
        r = api.delete(f"{BASE_URL}/api/library/share/share-song-1")
        assert r.status_code == 401

    def test_revoke_removes_share(self, api, user_a):
        r = api.delete(f"{BASE_URL}/api/library/share/share-song-1", headers=user_a["headers"])
        assert r.status_code == 200
        assert r.json()["deleted"] == 1
        # subsequent GETs should 404
        r_info = requests.get(f"{BASE_URL}/api/share/{pytest.share_slug_a}/info")
        assert r_info.status_code == 404
        r_html = requests.get(f"{BASE_URL}/api/share/{pytest.share_slug_a}")
        assert r_html.status_code == 404

    def test_revoke_noop_when_no_share(self, api, user_a):
        r = api.delete(f"{BASE_URL}/api/library/share/share-song-1", headers=user_a["headers"])
        assert r.status_code == 200
        assert r.json()["deleted"] == 0
