import httpx
import respx
from fastapi.testclient import TestClient

from tracer.main import app
from tracer.pipeline import pick_origin
from tracer.wayback import CDX

P1 = ("It is a truth universally acknowledged, that a single man in possession of a good fortune "
      "must be in want of a wife. However little known the feelings or views of such a man may be on "
      "his first entering a neighbourhood, this truth is so well fixed in the minds of the surrounding "
      "families, that he is considered as the rightful property of some one or other of their daughters.")
NEW = f"""<html><head><meta property="article:published_time" content="2024-02-01"></head>
<body><article><p>{P1}</p><p>Posted in classics.</p></article></body></html>"""


def test_origin_prefers_independent_archive_date_over_earlier_claim():
    cands = [
        {"id": "a", "cls": "exact", "claimed": {"published": "1990-01-01"}},
        {"id": "b", "cls": "near", "archive": {"iso": "1998-12-02T08:54:41Z"}},
        {"id": "c", "cls": "exact", "archive": {"iso": "2008-09-20T08:28:04Z"}},
        {"id": "d", "cls": "unrelated", "archive": {"iso": "1996-01-01T00:00:00Z"}},
    ]
    assert pick_origin(cands) == {"id": "b", "date": "1998-12-02", "basis": "archive"}


@respx.mock
def test_trace_endpoint_end_to_end(tmp_path, monkeypatch):
    monkeypatch.setenv("TRACER_CACHE_DIR", str(tmp_path))
    async def public_host(url):
        pass
    monkeypatch.setattr("tracer.fetch.require_public_host", public_host)
    respx.get("https://blog.example/post").mock(return_value=httpx.Response(200, html=NEW))

    def cdx(request):
        u = request.url.params["url"]
        ts = "20240305000000" if "blog.example" in u else "19981202085441"
        return httpx.Response(200, json=[["timestamp", "original", "statuscode"], [ts, "http://" + u, "200"]])

    respx.get(CDX).mock(side_effect=cdx)
    body = {"text": P1, "candidates": [
        {"url": "https://blog.example/post"},
        {"url": "https://old.example/ch1", "text": "Chapter 1. " + P1, "label": "old site"},
        {"text": "Call me Ishmael. Some years ago, never mind how long precisely, I went to sea."},
    ]}
    r = TestClient(app).post("/api/trace", json=body)
    assert r.status_code == 200
    d = r.json()
    by = {c["id"]: c for c in d["candidates"]}
    assert by["c0"]["cls"] == "exact" and by["c0"]["source"] == "fetched"
    assert by["c0"]["claimed"]["published"] == "2024-02-01"
    assert by["c1"]["cls"] == "exact" and by["c2"]["cls"] == "unrelated"
    assert d["origin"] == {"id": "c1", "date": "1998-12-02", "basis": "archive"}
    assert d["candidates"][0]["metrics"]["semantic"] is None  # embeddings off in tests


def test_trace_rejects_empty_request_and_health_reports_config():
    c = TestClient(app)
    assert c.post("/api/trace", json={"text": P1}).status_code == 400
    h = c.get("/api/health").json()
    assert h["ok"] and h["search"] in {"ddg", "brave", "serpapi"}
