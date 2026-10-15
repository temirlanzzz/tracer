"""Fetch a page, extract its main text (trafilatura) and what it claims about its own date (htmldate)."""
from __future__ import annotations

from urllib.parse import urljoin

import httpx
from .safety import require_public_host
import trafilatura
from htmldate import find_date

UA = "Mozilla/5.0 (compatible; TracerBot/1.0; +https://github.com/temirlanzzz/tracer)"


def extract(html: str, url: str | None = None) -> str:
    text = trafilatura.extract(html, url=url, include_comments=False, include_tables=False,
                               favor_recall=True)
    return text or ""


def claimed_dates(html: str, url: str | None = None) -> dict:
    """What the page says about itself. Not evidence — just a claim to compare against."""
    out = {}
    for key, original in (("published", True), ("updated", False)):
        try:
            d = find_date(html, url=url, original_date=original, extensive_search=True,
                          outputformat="%Y-%m-%d")
        except Exception:  # htmldate can choke on odd markup
            d = None
        if d:
            out[key] = d
    return out


async def fetch_page(client: httpx.AsyncClient, url: str) -> dict:
    for _ in range(6):
        await require_public_host(url)
        async with client.stream('GET', url, headers={"User-Agent": UA}, timeout=25,
                                 follow_redirects=False) as r:
            if r.is_redirect:
                location = r.headers.get('location')
                if not location:
                    raise ValueError('Redirect has no location')
                url = urljoin(url, location)
                continue
            r.raise_for_status()
            content_type = r.headers.get('content-type', '').lower()
            if content_type and not any(t in content_type for t in ('text/', 'application/xhtml+xml')):
                raise ValueError('Source is not a text or HTML document')
            chunks, size = [], 0
            async for chunk in r.aiter_bytes():
                size += len(chunk)
                if size > 2_000_000:
                    raise ValueError('Source exceeds 2 MB decoded response limit')
                chunks.append(chunk)
            html = b''.join(chunks).decode(r.encoding or 'utf-8', errors='replace')
            return {
                "url": str(r.url),
                "text": extract(html, str(r.url))[:100_000],
                "claimed": claimed_dates(html, str(r.url)),
                "lastModified": r.headers.get("last-modified"),
            }
    raise ValueError('Too many redirects')
