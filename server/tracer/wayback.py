"""First-seen dates from the Wayback Machine CDX API (server side: no CORS limits).

CDX returns captures oldest-first, so `limit=1` is the first capture. Results are
cached on disk (TRACER_CACHE_DIR) because the archive is slow and rate-limited.
"""
from __future__ import annotations

import json
import os
import re
from pathlib import Path
from urllib.parse import urlsplit

import httpx

CDX = "https://web.archive.org/cdx/search/cdx"


def cdx_key(url: str) -> str:
    """Strip scheme and leading www. so http/https/www variants share captures."""
    parts = urlsplit(url if "://" in url else "http://" + url)
    host = re.sub(r"^www\.", "", parts.netloc.lower())
    path = parts.path or "/"
    q = ("?" + parts.query) if parts.query else ""
    return host + path + q


def ts_to_iso(ts: str) -> str:
    ts = (ts + "00000000000000")[:14]
    return f"{ts[0:4]}-{ts[4:6]}-{ts[6:8]}T{ts[8:10]}:{ts[10:12]}:{ts[12:14]}Z"


class WaybackClient:
    def __init__(self, client: httpx.AsyncClient, cache_dir: str | None = None):
        self.client = client
        d = cache_dir or os.environ.get("TRACER_CACHE_DIR")
        self.cache_path = Path(d) / "wayback.json" if d else None
        self._cache: dict[str, dict | None] = {}
        if self.cache_path and self.cache_path.exists():
            self._cache = json.loads(self.cache_path.read_text("utf-8"))

    def _save(self):
        if self.cache_path:
            self.cache_path.parent.mkdir(parents=True, exist_ok=True)
            self.cache_path.write_text(json.dumps(self._cache, indent=1), "utf-8")

    async def first_seen(self, url: str) -> dict | None:
        """Return {timestamp, iso, original, snapshot, source} or None if never archived."""
        key = cdx_key(url)
        if key in self._cache:
            hit = self._cache[key]
            return {**hit, "cached": True} if hit else None
        params = {"url": key, "output": "json", "limit": "1",
                  "fl": "timestamp,original,statuscode", "filter": "statuscode:200"}
        last_err = None
        for _ in range(3):
            try:
                r = await self.client.get(CDX, params=params, timeout=40)
                if r.status_code == 200:
                    break
                last_err = f"HTTP {r.status_code}"
            except httpx.HTTPError as e:  # archive.org is flaky; retry
                last_err = str(e)
        else:
            raise RuntimeError(f"wayback cdx failed: {last_err}")
        rows = r.json() if r.text.strip() else []
        if len(rows) < 2:
            self._cache[key] = None
            self._save()
            return None
        ts, original, _status = rows[1][:3]
        hit = {
            "timestamp": ts,
            "iso": ts_to_iso(ts),
            "original": original,
            "snapshot": f"https://web.archive.org/web/{ts}/{original}",
            "source": "wayback-cdx",
        }
        self._cache[key] = hit
        self._save()
        return {**hit, "cached": False}
