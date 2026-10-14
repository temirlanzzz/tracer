"""Optional sentence embeddings (all-MiniLM-L6-v2) for paraphrase detection.

Install requirements-embeddings.txt to enable; without it the server runs the
lexical pipeline only and reports `semantic: null`, never a made-up score.
"""
from __future__ import annotations

from functools import lru_cache

import numpy as np

MODEL = "sentence-transformers/all-MiniLM-L6-v2"


@lru_cache(maxsize=1)
def _model():
    try:
        from sentence_transformers import SentenceTransformer
    except ImportError:
        return None
    return SentenceTransformer(MODEL)


def available() -> bool:
    return _model() is not None


def encode(texts: list[str]) -> np.ndarray | None:
    m = _model()
    if m is None or not texts:
        return None
    return np.asarray(m.encode(texts, normalize_embeddings=True, batch_size=32))


def semantic(suspect_text: str, cand_text: str):
    """Semantic coverage (same definition as the browser): share of suspect words in units whose best
    cosine to any 1-3 sentence window of the candidate is >= 0.6. A window vector is the word-weighted
    mean of its sentence vectors, re-normalised. Returns (coverage, pairs) or (None, [])."""
    from .textsim import T, coverage, sentences, units

    A, ss = units(suspect_text), sentences(cand_text)[:2000]
    va, vs = encode([u["text"] for u in A]), encode([s["text"] for s in ss])
    if va is None or vs is None or not len(va) or not len(vs):
        return None, []
    w = np.array([len(s["text"].split()) for s in ss], dtype=np.float32)[:, None]
    wins, spans = [], []
    for i in range(len(ss)):
        for n in range(1, 4):
            if i + n > len(ss):
                break
            v = (vs[i:i + n] * w[i:i + n]).sum(axis=0)
            wins.append(v / (np.linalg.norm(v) or 1.0))
            spans.append((ss[i]["s"], ss[i + n - 1]["e"]))
    sims = va @ np.stack(wins).T
    bj = sims.argmax(axis=1)
    best = [(float(sims[i, j]), int(j)) for i, j in enumerate(bj)]
    pairs = [{"a": [A[i]["s"], A[i]["e"]], "b": list(spans[j]), "cos": round(c, 3)}
             for i, (c, j) in enumerate(best) if c >= T["unitCos"]]
    return coverage(A, best), pairs
