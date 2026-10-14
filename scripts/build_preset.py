"""Build assets/data/preset.json — the one-click example — and record server evidence for it.

    .venv/Scripts/python scripts/build_preset.py

1. Downloads the public-domain texts (pemberley.com chapter page, Project Gutenberg #1342 and #2701).
2. Runs the *server* pipeline on the same inputs (live fetch + trafilatura + htmldate + Wayback CDX),
   twice: cold cache, then warm cache, and stores timings and the CDX first-capture dates.
The browser demo shows these recorded CDX dates next to its own live Wayback probes, labelled as such.
"""
from __future__ import annotations

import asyncio
import json
import re
from html import unescape
import shutil
import sys
import tempfile
import time
from datetime import date
from pathlib import Path

import httpx

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "server"))
from tracer.fetch import UA, extract  # noqa: E402
from tracer.pipeline import trace  # noqa: E402
from tracer.wayback import WaybackClient  # noqa: E402

PEMBERLEY = "https://www.pemberley.com/janeinfo/ppv1n01.html"
GUTENBERG = "https://www.gutenberg.org/files/1342/1342-h/1342-h.htm"
WIKIPEDIA = "https://en.wikipedia.org/wiki/Pride_and_Prejudice"

STUDY_GUIDE = (
    "Pride and Prejudice, Chapter 1: summary and key quotes\n\n"
    "The novel opens with one of the most famous lines in English literature: \u201cIt is a truth universally "
    "acknowledged, that a single man in possession of a good fortune must be in want of a wife. However little "
    "known the feelings or views of such a man may be on his first entering a neighborhood, this truth is so "
    "well fixed in the minds of the surrounding families, that he is considered as the rightful property of "
    "some one or other of their daughters.\u201d\n\n"
    "\u201cMy dear Mr. Bennet,\u201d said his lady to him one day, \u201chave you heard that Netherfield Park is "
    "let at last?\u201d Mr. Bennet replied that he had not. \u201cBut it is,\u201d returned she; \u201cfor Mrs. "
    "Long has just been here, and she told me all about it.\u201d Mr. Bennet made no answer. \u201cDon\u2019t you "
    "want to know who has taken it?\u201d cried his wife impatiently. \u201cYou want to tell me, and I have no "
    "objection to hearing it.\u201d This was invitation enough.\n\n"
    "Mrs. Bennet explains that Netherfield has been taken by a young man of large fortune from the north of "
    "England, a Mr. Bingley, who is single and has four or five thousand a year. She hopes he will marry one "
    "of their five daughters and insists that her husband call on him as soon as he arrives. Mr. Bennet teases "
    "her, as usual.\n\nKey themes: marriage and money, irony, the Bennets\u2019 mismatched marriage."
)

PARAPHRASE = (
    "Everyone seems to agree that a rich bachelor must be on the lookout for a bride. Whatever such a "
    "man actually thinks or wants when he moves into a new area, the local families are so convinced of "
    "this that they treat him as the rightful prize of one of their own daughters.\n\n"
    "One day Mrs. Bennet asked her husband whether he had heard that Netherfield Park had finally been "
    "rented. He said he had not. She insisted it had: Mrs. Long had just visited and told her everything. "
    "Mr. Bennet said nothing. “Don’t you want to know who rented it?” she asked impatiently. "
    "“You clearly want to tell me, and I don’t mind listening.”\n\n"
    "That was all the encouragement she needed. A wealthy young man from the north had taken the house, "
    "she explained; he had driven over on Monday in a carriage, liked the place so much that he agreed "
    "terms with Mr. Morris on the spot, and would move in before Michaelmas, with some of his servants "
    "arriving within days. His name was Bingley, he was unmarried, and he had four or five thousand a "
    "year. What a stroke of luck for their girls!\n\n"
    "Mr. Bennet asked how that could possibly concern them. She told him not to be so tiresome: she was "
    "plainly hoping Bingley would marry one of them, so her husband must call on the newcomer the moment "
    "he arrived."
)


def get(url: str) -> str:
    r = httpx.get(url, headers={"User-Agent": UA}, timeout=60, follow_redirects=True)
    r.raise_for_status()
    return r.text


def pemberley_chapter() -> tuple[str, str]:
    html = get(PEMBERLEY)
    page = extract(html, PEMBERLEY)
    # suspect = the opening of the chapter, with the site's ``TeX quotes'' turned into curly quotes
    raw = re.sub(r"(?i)<p[^>]*>", "\n\n", html)
    raw = re.sub(r"<[^>]+>", "", raw)
    raw = unescape(raw).replace("\xa0", " ")
    raw = re.sub(r"[ \t]+", " ", raw)
    i = raw.index("IT is a truth")
    j = raw.index("as soon as he comes.", i) + len("as soon as he comes.''")
    body = raw[i:j].replace("IT is", "It is", 1)
    body = body.replace("``", "“").replace("''", "”").replace("`", "‘").replace("'", "’")
    paras = [re.sub(r"\s+", " ", p).strip() for p in re.split(r"\n\s*\n", body)]
    paras = [re.sub(r"\s+([,.;:!?”])", r"\1", p) for p in paras]
    suspect = "\n\n".join(p for p in paras if p)
    return suspect, page


def gutenberg_chapter() -> str:
    """Chapter I exactly as the Gutenberg HTML edition at GUTENBERG serves it (trafilatura text)."""
    txt = extract(get(GUTENBERG), GUTENBERG)
    i = txt.index("IT is a truth universally acknowledged")
    j = txt.index("CHAPTER II", i)
    return re.sub(r"\{\d+\}", "", txt[i:j]).strip()


def moby_opening() -> str:
    txt = get("https://www.gutenberg.org/cache/epub/2701/pg2701.txt").replace("\r\n", "\n")
    i = txt.index("Call me Ishmael.")
    paras = re.split(r"\n\s*\n", txt[i:])[:2]
    return "\n\n".join(re.sub(r"\s+", " ", p).strip() for p in paras)


async def record(suspect: str) -> dict:
    cands = [{"url": PEMBERLEY}, {"url": GUTENBERG}, {"url": WIKIPEDIA}]
    cache = Path(tempfile.mkdtemp())
    runs = {}
    try:
        for name in ("cold", "warm"):
            async with httpx.AsyncClient() as client:
                t = time.perf_counter()
                res = await trace(suspect, [dict(c) for c in cands], client=client,
                                  wayback=WaybackClient(client, str(cache)), use_embeddings=False)
                runs[name] = round(time.perf_counter() - t, 2)
    finally:
        shutil.rmtree(cache, ignore_errors=True)
    out = {"date": date.today().isoformat(), "seconds": runs, "byUrl": {}}
    for c in res["candidates"]:
        out["byUrl"][c["url"]] = {
            "archive": c.get("archive"),
            "claimed": c.get("claimed"),
            "cls": c["cls"],
            "metrics": c["metrics"],
            "extractedWords": len((c.get("text") or "").split()),
            "error": c.get("error"),
        }
    return out


def main():
    suspect, pem_page = pemberley_chapter()
    preset = {
        "suspect": suspect,
        "candidates": [
            {"label": "pemberley.com — chapter I page", "url": PEMBERLEY, "text": pem_page,
             "note": "page text captured from the live site; browsers can't fetch it (no CORS)"},
            {"label": "Project Gutenberg #1342 — chapter I", "url": GUTENBERG, "text": gutenberg_chapter(),
             "note": "chapter I as gutenberg.org serves it today (1894 George Allen edition); browsers cannot fetch it (no CORS)"},
            {"label": "Wikipedia — Pride and Prejudice", "url": WIKIPEDIA, "text": "",
             "note": "fetched live in your browser through the Wikipedia API"},
            {"label": "study-guide copy (written for this demo)", "url": "", "text": STUDY_GUIDE,
             "note": "quotes the first paragraphs with small edits, then summarises: a typical near-duplicate"},
            {"label": "modern retelling (written for this demo)", "url": "", "text": PARAPHRASE,
             "note": "my own paraphrase of the same passage, sharing almost no 5-word runs"},
            {"label": "Moby-Dick — chapter 1 opening", "url": "", "text": moby_opening(),
             "note": "public-domain control text; should come out unrelated"},
        ],
    }
    preset["recorded"] = asyncio.run(record(suspect))
    out = ROOT / "assets" / "data" / "preset.json"
    out.write_text(json.dumps(preset, indent=1, ensure_ascii=False), "utf-8")
    print(json.dumps(preset["recorded"], indent=1)[:4000])


if __name__ == "__main__":
    main()
