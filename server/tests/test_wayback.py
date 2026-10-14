import asyncio

import httpx
import respx

from tracer.wayback import CDX, WaybackClient, cdx_key, ts_to_iso

ROWS = [["timestamp", "original", "statuscode"],
        ["19981202085441", "http://pemberley.com:80/janeinfo/ppv1n01.html", "200"]]


def test_cdx_key_and_timestamp_helpers():
    assert cdx_key("https://www.Pemberley.com/janeinfo/ppv1n01.html") == "pemberley.com/janeinfo/ppv1n01.html"
    assert cdx_key("example.org") == "example.org/"
    assert ts_to_iso("19981202085441") == "1998-12-02T08:54:41Z"


@respx.mock
def test_first_seen_parses_cdx_and_caches_on_disk(tmp_path):
    route = respx.get(CDX).mock(return_value=httpx.Response(200, json=ROWS))

    async def run():
        async with httpx.AsyncClient() as c:
            first = await WaybackClient(c, str(tmp_path)).first_seen("https://www.pemberley.com/janeinfo/ppv1n01.html")
            again = await WaybackClient(c, str(tmp_path)).first_seen("http://pemberley.com/janeinfo/ppv1n01.html")
            return first, again

    first, again = asyncio.run(run())
    assert first["iso"] == "1998-12-02T08:54:41Z" and first["cached"] is False
    assert first["snapshot"].startswith("https://web.archive.org/web/19981202085441/")
    assert again["cached"] is True and route.call_count == 1


@respx.mock
def test_never_archived_and_retry_on_503(tmp_path):
    respx.get(CDX).mock(side_effect=[httpx.Response(503), httpx.Response(200, json=[])])

    async def run():
        async with httpx.AsyncClient() as c:
            return await WaybackClient(c, str(tmp_path)).first_seen("https://new.example/page")

    assert asyncio.run(run()) is None
