import hashlib
import time
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from pathlib import Path

API = "https://boardgamegeek.com/xmlapi2"
MIN_DELAY = 5.0


class BGGError(RuntimeError):
    pass


class BGG:
    def __init__(self, token: str, cache_dir: Path, delay: float = MIN_DELAY):
        if not token:
            raise BGGError("BGG_API_TOKEN is not set (env var or admin/.env). Register an app at boardgamegeek.com/applications.")
        self.token = token
        self.cache_dir = cache_dir
        self.delay = max(delay, MIN_DELAY)
        cache_dir.mkdir(parents=True, exist_ok=True)

    def _get(self, endpoint: str, **params) -> ET.Element:
        url = f"{API}/{endpoint}?{urllib.parse.urlencode(params)}"
        cached = self.cache_dir / (hashlib.sha1(url.encode()).hexdigest() + ".xml")
        if cached.exists():
            return ET.fromstring(cached.read_bytes())

        req = urllib.request.Request(url, headers={"Authorization": f"Bearer {self.token}", "User-Agent": "shelf-admin"})
        for attempt in range(6):
            time.sleep(self.delay)
            try:
                with urllib.request.urlopen(req, timeout=30) as resp:
                    if resp.status == 202:
                        time.sleep(3 * (attempt + 1))
                        continue
                    body = resp.read()
                    break
            except urllib.error.HTTPError as e:
                if e.code == 401:
                    raise BGGError("BGG returned 401: token missing or invalid") from e
                if e.code in (429, 500, 502, 503):
                    time.sleep(5 * (attempt + 1))
                    continue
                raise
        else:
            raise BGGError(f"BGG did not answer: {url}")

        cached.write_bytes(body)
        return ET.fromstring(body)

    def search(self, name: str) -> list[int]:
        root = self._get("search", query=name, type="boardgame", exact=1)
        ids = [int(i.get("id")) for i in root.iter("item")]
        if not ids:
            root = self._get("search", query=name, type="boardgame")
            ids = [int(i.get("id")) for i in root.iter("item")][:10]
        return ids

    def things(self, ids: list[int]) -> list[dict]:
        out = []
        for i in range(0, len(ids), 20):
            root = self._get("thing", id=",".join(map(str, ids[i:i + 20])), stats=1)
            out += [_parse_thing(item) for item in root.iter("item")]
        return out


def _value(item: ET.Element, path: str, default=None):
    el = item.find(path)
    return el.get("value") if el is not None else default


def _parse_thing(item: ET.Element) -> dict:
    name = next((n.get("value") for n in item.findall("name") if n.get("type") == "primary"), None)
    year = _value(item, "yearpublished")
    rated = _value(item, "statistics/ratings/usersrated", "0")
    thumb = item.findtext("thumbnail")
    return {
        "bgg": int(item.get("id")),
        "name": name,
        "year": int(year) if year and year.isdigit() else None,
        "usersrated": int(rated) if rated.isdigit() else 0,
        "thumbnail": thumb.strip() if thumb else None,
        "expansions": [
            link.get("value")
            for link in item.findall("link")
            if link.get("type") == "boardgameexpansion" and link.get("inbound") != "true"
        ],
    }


def resolve(client: BGG, name: str, pinned: int | None) -> tuple[dict | None, str]:
    if pinned:
        found = client.things([pinned])
        return (found[0], "pinned") if found else (None, f"pinned id {pinned} not found")
    ids = client.search(name)
    if not ids:
        return None, "no match"
    candidates = sorted(client.things(ids), key=lambda t: t["usersrated"], reverse=True)
    best = candidates[0]
    how = "exact" if len(candidates) == 1 else f"most rated of {len(candidates)}"
    return best, how
