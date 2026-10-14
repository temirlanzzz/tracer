"""The browser (assets/js/textsim.js) and the server must agree exactly.
fixtures/parity.json is written by `node scripts/parity.mjs`."""
import json
from pathlib import Path

from tracer.textsim import (PERM_A, PERM_B, compare, fnv1a, minhash, prepare, sentences, shingles, tokenize,
                            units, windows)

FIX = json.loads((Path(__file__).parent / "fixtures" / "parity.json").read_text("utf-8"))


def test_tokens_hash_and_permutations_match_js():
    assert [list(t) for t in tokenize(FIX["a"])] == FIX["tokens"]
    assert [[s, fnv1a(s)] for s, _ in FIX["fnv"]] == FIX["fnv"]
    assert PERM_A[:4] == FIX["permA"] and PERM_B[:4] == FIX["permB"]
    assert minhash(shingles(tokenize(FIX["a"])).keys())[:8] == FIX["sigA"]


def test_compare_and_sentences_match_js():
    c = compare(prepare(FIX["a"]), prepare(FIX["b"]))
    for k, v in FIX["compare"].items():
        assert c[k] == v, k
    assert sentences(FIX["a"]) == FIX["sentences"]
    assert units(FIX["a"] + " " + FIX["b"], 12) == FIX["units"]
    assert windows(FIX["b"] + " " + FIX["a"], 3) == FIX["windows"]
