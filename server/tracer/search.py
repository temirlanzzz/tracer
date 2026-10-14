"""Web search for candidate sources. DuckDuckGo HTML by default (no key);
Brave or SerpAPI when BRAVE_API_KEY / SERPAPI_KEY is set."""
from __future__ import annotations

import os
import re
from html import unescape
from urllib.parse import parse_qs, unquote, urlsplit

import httpx

from .textsim import sentences

UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"


def build_queries(text: str, n: int = 2, words: int = 12) -> list[str]:
    """Quoted phrases from the longest sentences: distinctive, and exact-match friendly."""
    sents = sorted(sentences(text), key=lambda s: -len(s["text"]))
    qs = []
    for s in sents[:n]:
        w = re.findall(r"[^\W_]+(?:['’][^\W_]+)*", s["text"])[:words]
        if len(w) >= 4:
            qs.append('"' + " ".join(w) + '"')
    if not qs:
        qs.append(" ".join(text.split()[:words]))
    return qs


_A = re.compile(r'<a[^>]+class="[^"]*result__a[^"]*"[^>]+href="([^"]+)"', re.I)


def parse_ddg(html: str) -> list[str]:
    out = []
    for href in _A.findall(html):
        href = unescape(href)
        if "uddg=" in href:
            href = unquote(parse_qs(urlsplit(href).query).get("uddg", [""])[0])
        if href.startswith("http") and "duckduckgo.com" not in href and href not in out:
            out.append(href)
    return out


def provider() -> str:
    forced = os.environ.get("TRACER_SEARCH")
    if forced:
        return forced
    if os.environ.get("BRAVE_API_KEY"):
        return "brave"
    if os.environ.get("SERPAPI_KEY"):
        return "serpapi"
    return "ddg"


async def search(client: httpx.AsyncClient, query: str, limit: int = 8) -> list[str]:
    p = provider()
    if p == "brave":
        r = await client.get("https://api.search.brave.com/res/v1/web/search",
                             params={"q": query, "count": limit},
                             headers={"X-Subscription-Token": os.environ["BRAVE_API_KEY"],
                                      "Accept": "application/json"}, timeout=20)
        r.raise_for_status()
        return [x["url"] for x in r.json().get("web", {}).get("results", [])][:limit]
    if p == "serpapi":
        r = await client.get("https://serpapi.com/search.json",
                             params={"q": query, "api_key": os.environ["SERPAPI_KEY"], "num": limit},
                             timeout=30)
        r.raise_for_status()
        return [x["link"] for x in r.json().get("organic_results", [])][:limit]
    r = await client.post("https://html.duckduckgo.com/html/", data={"q": query},
                          headers={"User-Agent": UA}, timeout=20)
    r.raise_for_status()
    return parse_ddg(r.text)[:limit]


async def find_candidates(client: httpx.AsyncClient, text: str, limit: int = 12) -> list[str]:
    urls: list[str] = []
    for q in build_queries(text):
        try:
            for u in await search(client, q):
                if u not in urls:
                    urls.append(u)
        except httpx.HTTPError:
            continue
    return urls[:limit]
