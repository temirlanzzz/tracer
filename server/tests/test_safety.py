import asyncio
import httpx
import pytest
from fastapi.testclient import TestClient
from tracer.main import app
from tracer.safety import validate_url, require_public_host
from tracer.fetch import fetch_page

@pytest.mark.parametrize('url', ['file:///etc/passwd','http://127.0.0.1','http://[::1]', 'http://169.254.169.254', 'http://localhost', 'https://a.local','https://user:secret@example.com','https://example.com:8080'])
def test_reject_non_public_urls(url):
    with pytest.raises(ValueError): validate_url(url)
    r = TestClient(app).post('/api/trace', json={'text':'word ' * 10, 'candidates':[{'url':url}]})
    assert r.status_code == 422

def test_reject_oversized_candidate():
    r = TestClient(app).post('/api/trace', json={'text':'word ' * 10, 'candidates':[{'text':'x' * 100001}]})
    assert r.status_code == 422

def test_mixed_public_private_dns_rejected(monkeypatch):
    async def run():
        async def lookup(*args, **kwargs): return [(2,1,6,'',('8.8.8.8',443)), (2,1,6,'',('10.0.0.1',443))]
        monkeypatch.setattr(asyncio.get_running_loop(), 'getaddrinfo', lookup)
        with pytest.raises(ValueError): await require_public_host('https://example.com')
    asyncio.run(run())

@pytest.mark.parametrize('response', [httpx.Response(200, content=b'x'*2_000_001), httpx.Response(200, headers={'content-type':'application/pdf'}, content=b'PDF')])
def test_bounded_text_response(monkeypatch, response):
    async def public(url): pass
    monkeypatch.setattr('tracer.fetch.require_public_host', public)
    async def run():
        async with httpx.AsyncClient(transport=httpx.MockTransport(lambda req: response)) as client:
            with pytest.raises(ValueError): await fetch_page(client, 'https://example.com')
    asyncio.run(run())

def test_redirect_revalidates_destination(monkeypatch):
    seen=[]
    async def public(url):
        seen.append(url)
        validate_url(url)
    monkeypatch.setattr('tracer.fetch.require_public_host',public)
    async def run():
        async with httpx.AsyncClient(transport=httpx.MockTransport(lambda req: httpx.Response(302,headers={'location':'http://127.0.0.1/secret'}))) as client:
            with pytest.raises(ValueError): await fetch_page(client,'https://example.com')
    asyncio.run(run())
    assert seen == ['https://example.com','http://127.0.0.1/secret']
