from tracer.textsim import (classify, coverage, units, windows, compare, minhash, minhash_sim, overlap, prepare, shingles,
                            tokenize)

P1 = ("It is a truth universally acknowledged, that a single man in possession of a good "
      "fortune must be in want of a wife. However little known the feelings or views of such "
      "a man may be on his first entering a neighbourhood, this truth is so well fixed in the "
      "minds of the surrounding families, that he is considered as the rightful property of "
      "some one or other of their daughters.")
MOBY = ("Call me Ishmael. Some years ago, never mind how long precisely, having little or no "
        "money in my purse, and nothing particular to interest me on shore, I thought I would "
        "sail about a little and see the watery part of the world.")


def test_tokenize_normalises_case_diacritics_apostrophes_and_keeps_offsets():
    text = "Naïve CAFÉ owners don’t"
    toks = tokenize(text)
    assert [t[0] for t in toks] == ["naive", "cafe", "owners", "dont"]
    assert [text[s:e] for _, s, e in toks] == ["Naïve", "CAFÉ", "owners", "don’t"]


def test_identical_text_is_exact_copy():
    c = compare(prepare(P1), prepare(P1))
    assert c["jaccard"] == 1.0 and c["containment"] == 1.0 and c["minhash"] == 1.0
    assert classify(c["containment"], c["jaccard"], None) == "exact"


def test_copy_inside_a_longer_page_is_exact_by_containment():
    page = "Home | Books | Contact. Volume I. " + P1 + " Go to next chapter. Copyright notice."
    c = compare(prepare(P1), prepare(page))
    assert c["containment"] == 1.0 and c["jaccard"] < 1.0
    assert classify(c["containment"], c["jaccard"], None) == "exact"


def test_edited_copy_is_near_duplicate_and_minhash_tracks_jaccard():
    edited = P1.replace("universally acknowledged", "widely accepted").replace("daughters", "girls")
    c = compare(prepare(P1), prepare(edited))
    assert 0.4 <= c["containment"] < 0.9
    assert classify(c["containment"], c["jaccard"], None) == "near"
    assert abs(c["minhash"] - c["jaccard"]) < 0.15


def test_unrelated_text_scores_zero():
    c = compare(prepare(P1), prepare(MOBY))
    assert c["inter"] == 0 and c["minhash"] < 0.05
    assert classify(c["containment"], c["jaccard"], None) == "unrelated"


def test_paraphrase_needs_semantic_signal():
    assert classify(0.0, 0.0, 0.81) == "paraphrase"
    assert classify(0.0, 0.0, None) == "unrelated"


def test_short_quote_is_partial():
    quote = "As Austen put it: it is a truth universally acknowledged, that a single man. " + MOBY * 3
    c = compare(prepare(P1), prepare(quote))
    assert classify(c["containment"], c["jaccard"], None) == "partial"


def test_match_ranges_map_back_to_original_spans():
    b = "Preface. " + P1[:120]
    c = compare(prepare(P1), prepare(b))
    s, e = c["rangesB"][0]
    assert b[s:e].startswith("It is a truth") and P1.startswith(b[s:e])


def test_short_texts_and_empty_sets():
    assert list(shingles(tokenize("two words"))) == ["two words"]
    assert overlap({}, {})["jaccard"] == 0.0
    assert minhash_sim(minhash([]), minhash([])) == 1.0


def test_semantic_units_windows_and_coverage():
    A = units(P1 + " " + MOBY, 12)
    assert all(u["w"] >= 6 for u in A) and P1.startswith(A[0]["text"][:40])
    W = windows("One two three four. Five six seven eight. Nine ten eleven twelve.", 3)
    assert len(W) == 6 and W[-1]["text"] == "Nine ten eleven twelve."
    best = [(0.9, 0)] + [(0.1, 0)] * (len(A) - 1)
    assert 0 < coverage(A, best) < 1 and coverage(A, [(0.7, 0)] * len(A)) == 1.0
