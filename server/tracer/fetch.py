"""Fetch a page, extract its main text (trafilatura) and what it claims about its own date (htmldate)."""
from __future__ import annotations

import httpx
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
    r = await client.get(url, headers={"User-Agent": UA}, timeout=25, follow_redirects=True)
    r.raise_for_status()
    html = r.text
    return {
        "url": str(r.url),
        "text": extract(html, str(r.url)),
        "claimed": claimed_dates(html, str(r.url)),
        "lastModified": r.headers.get("last-modified"),
    }
