from tracer.fetch import claimed_dates, extract
from tracer.search import build_queries, parse_ddg

ARTICLE = """<html><head><title>Study notes</title>
<meta property="article:published_time" content="2024-03-05T10:00:00Z"></head>
<body><nav>Home Blog About</nav><article><h1>Chapter one, explained</h1>
<p>It is a truth universally acknowledged, that a single man in possession of a good fortune
must be in want of a wife. However little known the feelings or views of such a man may be on his
first entering a neighbourhood, this truth is so well fixed in the minds of the surrounding families,
that he is considered as the rightful property of some one or other of their daughters.</p>
<p>Austen opens with irony: the sentence says the opposite of what the families believe.</p>
</article><footer>Copyright 2024</footer></body></html>"""


def test_extract_main_text_and_claimed_date():
    text = extract(ARTICLE, "https://notes.example/p-and-p")
    assert "truth universally acknowledged" in text and "Home Blog About" not in text
    assert claimed_dates(ARTICLE, "https://notes.example/p-and-p")["published"] == "2024-03-05"


def test_parse_duckduckgo_html_results():
    html = ('<a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fwww.gutenberg.org'
            '%2Febooks%2F1342&amp;rut=abc">P&amp;P</a>'
            '<a class="result__a" href="https://pemberley.com/janeinfo/ppv1n01.html">Pemberley</a>')
    assert parse_ddg(html) == ["https://www.gutenberg.org/ebooks/1342", "https://pemberley.com/janeinfo/ppv1n01.html"]


def test_queries_are_quoted_distinctive_phrases():
    qs = build_queries("Short one here. It is a truth universally acknowledged, that a single man in "
                       "possession of a good fortune must be in want of a wife.")
    assert qs[0] == '"It is a truth universally acknowledged that a single man in possession"'
