"""The provenance pipeline: (search) -> fetch + extract -> compare -> date -> pick the origin."""
from __future__ import annotations

import asyncio
import time
from typing import Any

import httpx

from . import embed
from .fetch import fetch_page
from .search import find_candidates
from .textsim import CLASS_LABEL, classify, compare, prepare
from .wayback import WaybackClient


def evidence_date(c: dict) -> tuple[str | None, str]:
    """Earliest *independent* date (archive capture), else the page's own claim."""
    arch = (c.get("archive") or {}).get("iso")
    if arch:
        return arch[:10], "archive"
    claimed = (c.get("claimed") or {}).get("published")
    if claimed:
        return claimed[:10], "claimed"
    return None, "none"


def pick_origin(cands: list[dict]) -> dict | None:
    """Independent evidence beats self-reported dates: if any related candidate has an
    archive date, only archive-dated candidates compete."""
    related = [c for c in cands if c["cls"] in ("exact", "near", "paraphrase")]
    if not related:  # fall back to partial quotes only when nothing stronger matched
        related = [c for c in cands if c["cls"] == "partial"]
    dated = [(evidence_date(c), c) for c in related]
    dated = [((d, basis), c) for (d, basis), c in dated if d]
    if not dated:
        return None
    if any(b == "archive" for (_, b), _ in dated):
        dated = [x for x in dated if x[0][1] == "archive"]
    (d, basis), c = min(dated, key=lambda x: x[0][0])
    return {"id": c["id"], "date": d, "basis": basis}


async def trace(text: str, candidates: list[dict] | None = None, do_search: bool = False,
                client: httpx.AsyncClient | None = None, wayback: WaybackClient | None = None,
                use_embeddings: bool = True) -> dict[str, Any]:
    t0 = time.perf_counter()
    own = client is None
    client = client or httpx.AsyncClient()
    wayback = wayback or WaybackClient(client)
    timings: dict[str, float] = {}
    try:
        cands = [dict(c, id=c.get("id") or f"c{i}") for i, c in enumerate(candidates or [])]
        if do_search:
            ts = time.perf_counter()
            known = {c.get("url") for c in cands}
            for u in await find_candidates(client, text):
                if u not in known:
                    cands.append({"id": f"s{len(cands)}", "url": u, "found": "search"})
            timings["search"] = time.perf_counter() - ts

        async def load(c):
            if c.get("url") and not c.get("text"):
                try:
                    page = await fetch_page(client, c["url"])
                    c.update(text=page["text"], claimed=page["claimed"], source="fetched")
                except Exception as e:  # noqa: BLE001 — report per-candidate failures
                    c.update(text="", error=f"fetch failed: {e.__class__.__name__}")
            else:
                c.setdefault("source", "pasted")
            if c.get("url"):
                try:
                    c["archive"] = await wayback.first_seen(c["url"])
                except Exception as e:  # noqa: BLE001
                    c["archive"] = None
                    c["archiveError"] = str(e)

        ts = time.perf_counter()
        await asyncio.gather(*(load(c) for c in cands))
        timings["fetch_and_wayback"] = time.perf_counter() - ts

        ts = time.perf_counter()
        sus = prepare(text)
        emb_on = use_embeddings and embed.available()
        for c in cands:
            cp = prepare(c.get("text") or "")
            m = compare(sus, cp)
            semantic, pairs = None, []
            if emb_on and c.get("text"):
                semantic, pairs = embed.semantic(text, c["text"])
            c["metrics"] = {k: m[k] for k in ("jaccard", "containment", "minhash", "longestRun",
                                               "inter", "shinglesA", "shinglesB")}
            c["metrics"]["semantic"] = semantic
            c["rangesA"], c["rangesB"], c["paraPairs"] = m["rangesA"], m["rangesB"], pairs
            c["cls"] = classify(m["containment"], m["jaccard"], semantic)
            c["noText"] = not c.get("text")
            c["clsLabel"] = CLASS_LABEL[c["cls"]]
        timings["compare"] = time.perf_counter() - ts
        timings["total"] = time.perf_counter() - t0
        return {
            "engine": "server",
            "embeddings": emb_on,
            "suspect": {"text": text},
            "candidates": cands,
            "origin": pick_origin(cands),
            "timings": {k: round(v, 3) for k, v in timings.items()},
        }
    finally:
        if own:
            await client.aclose()
