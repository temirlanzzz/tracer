"""Tokenising, 5-gram shingles, exact Jaccard, MinHash, matched spans.

Mirrors assets/js/textsim.js bit-for-bit (same normalisation, FNV-1a hash,
mulberry32-seeded permutations), so the browser demo and the server agree.
tests/test_parity.py checks this against values produced by the JS module.
"""
from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass, field

K = 5
NUM_PERM = 128
P = 2147483647  # 2^31 - 1

WORD = re.compile(r"[^\W_]+(?:['’][^\W_]+)*", re.UNICODE)
T = {"exact": 0.9, "near": 0.4, "partial": 0.05, "para": 0.35, "unitCos": 0.6}
CLASS_LABEL = {
    "exact": "exact copy",
    "near": "near-duplicate",
    "paraphrase": "paraphrase",
    "partial": "partial quote",
    "unrelated": "unrelated",
}


def norm_word(w: str) -> str:
    w = unicodedata.normalize("NFKD", w)
    w = "".join(c for c in w if not unicodedata.category(c).startswith("M"))
    return w.lower().replace("'", "").replace("’", "")


def tokenize(text: str) -> list[tuple[str, int, int]]:
    out = []
    for m in WORD.finditer(text):
        t = norm_word(m.group(0))
        if t:
            out.append((t, m.start(), m.end()))
    return out


def shingles(tokens, k: int = K) -> dict[str, list[int]]:
    n = len(tokens)
    if n == 0:
        return {}
    if n < k:
        return {" ".join(t[0] for t in tokens): [0]}
    out: dict[str, list[int]] = {}
    for i in range(n - k + 1):
        s = " ".join(tokens[i + j][0] for j in range(k))
        out.setdefault(s, []).append(i)
    return out


def fnv1a(s: str) -> int:
    h = 0x811C9DC5
    for b in s.encode("utf-8"):
        h ^= b
        h = (h * 0x01000193) & 0xFFFFFFFF
    return h


def _imul(a: int, b: int) -> int:
    return (a * b) & 0xFFFFFFFF


def _mulberry32(seed: int):
    a = seed & 0xFFFFFFFF

    def nxt() -> int:
        nonlocal a
        a = (a + 0x6D2B79F5) & 0xFFFFFFFF
        t = a
        t = _imul(t ^ (t >> 15), t | 1)
        t ^= (t + _imul(t ^ (t >> 7), t | 61)) & 0xFFFFFFFF
        return (t ^ (t >> 14)) & 0xFFFFFFFF

    return nxt


def _perms():
    r = _mulberry32(42)
    A, B = [], []
    for _ in range(NUM_PERM):
        A.append(1 + (r() % (P - 1)))
        B.append(r() % P)
    return A, B


PERM_A, PERM_B = _perms()


def minhash(keys) -> list[int]:
    sig = [P] * NUM_PERM
    for s in keys:
        x = fnv1a(s) % P
        for i in range(NUM_PERM):
            v = (PERM_A[i] * x + PERM_B[i]) % P
            if v < sig[i]:
                sig[i] = v
    return sig


def minhash_sim(a, b) -> float:
    return sum(1 for x, y in zip(a, b) if x == y) / NUM_PERM


def overlap(A: dict, B: dict) -> dict:
    inter = sum(1 for k in A if k in B)
    union = len(A) + len(B) - inter
    return {
        "inter": inter,
        "jaccard": inter / union if union else 0.0,
        "containment": inter / len(A) if A else 0.0,
    }


def match_masks(tok_a, A, tok_b, B, k: int = K):
    ma, mb = [0] * len(tok_a), [0] * len(tok_b)
    kk = min(k, len(tok_a), len(tok_b)) or 1
    for s, starts in A.items():
        other = B.get(s)
        if not other:
            continue
        for i in starts:
            for j in range(kk):
                ma[i + j] = 1
        for i in other:
            for j in range(kk):
                mb[i + j] = 1
    return ma, mb


def longest_run(mask) -> int:
    best = cur = 0
    for v in mask:
        cur = cur + 1 if v else 0
        best = max(best, cur)
    return best


def mask_to_ranges(tokens, mask) -> list[list[int]]:
    out, i, n = [], 0, len(tokens)
    while i < n:
        if mask[i]:
            s, e = tokens[i][1], tokens[i][2]
            while i + 1 < n and mask[i + 1]:
                i += 1
                e = tokens[i][2]
            out.append([s, e])
        i += 1
    return out


_SENT = re.compile(r"[^.!?\n]+(?:[.!?]+[\"'”’)\]]*|\n|$)")


def sentences(text: str) -> list[dict]:
    out = []
    for m in _SENT.finditer(text):
        raw = m.group(0)
        lead = len(raw) - len(raw.lstrip())
        t = raw.strip()
        if len(t.split()) >= 4:
            s = m.start() + lead
            out.append({"text": t, "s": s, "e": s + len(t)})
    return out


def _wc(s: str) -> int:
    return len(s.split())


def units(text: str, min_w: int = 12) -> list[dict]:
    """Sentences merged until each unit has >= min_w words (mirrors textsim.js units)."""
    out, cur, w = [], [], 0
    for s in sentences(text):
        cur.append(s)
        w += _wc(s["text"])
        if w >= min_w:
            out.append(cur)
            cur, w = [], 0
    if cur:
        if out and w < min_w / 2:
            out[-1].extend(cur)
        else:
            out.append(cur)
    return [{"text": " ".join(x["text"] for x in c), "s": c[0]["s"], "e": c[-1]["e"],
             "w": sum(_wc(x["text"]) for x in c)} for c in out]


def windows(text: str, k: int = 3, limit: int = 700) -> list[dict]:
    ss = sentences(text)[:limit]
    out = []
    for i in range(len(ss)):
        for j in range(1, k + 1):
            if i + j > len(ss):
                break
            g = ss[i:i + j]
            out.append({"text": " ".join(x["text"] for x in g), "s": g[0]["s"], "e": g[-1]["e"]})
    return out


def coverage(A: list[dict], best: list[tuple[float, int]]) -> float:
    tot = sum(u["w"] for u in A)
    hit = sum(u["w"] for u, b in zip(A, best) if b[0] >= T["unitCos"])
    return hit / tot if tot else 0.0


def classify(containment: float, jaccard: float, semantic: float | None) -> str:
    if containment >= T["exact"]:
        return "exact"
    if containment >= T["near"] or jaccard >= T["near"]:
        return "near"
    if semantic is not None and semantic >= T["para"]:
        return "paraphrase"
    if containment >= T["partial"]:
        return "partial"
    return "unrelated"


@dataclass
class Prepared:
    text: str
    tokens: list = field(repr=False)
    sh: dict = field(repr=False)
    sig: list = field(repr=False)


def prepare(text: str) -> Prepared:
    tokens = tokenize(text)
    sh = shingles(tokens)
    return Prepared(text, tokens, sh, minhash(sh.keys()))


def compare(sus: Prepared, cand: Prepared) -> dict:
    ov = overlap(sus.sh, cand.sh)
    ma, mb = match_masks(sus.tokens, sus.sh, cand.tokens, cand.sh)
    return {
        **ov,
        "minhash": minhash_sim(sus.sig, cand.sig),
        "longestRun": longest_run(ma),
        "rangesA": mask_to_ranges(sus.tokens, ma),
        "rangesB": mask_to_ranges(cand.tokens, mb),
        "shinglesA": len(sus.sh),
        "shinglesB": len(cand.sh),
    }
