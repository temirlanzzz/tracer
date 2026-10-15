"""URL and response limits for the self-hosted fetcher.

DNS preflight is defense in depth, not a replacement for an outbound firewall:
DNS can change between preflight and connection. Do not expose this API publicly.
"""
import asyncio
import ipaddress
import socket
from urllib.parse import urlsplit


def validate_url(url: str) -> str:
    p = urlsplit(url)
    if p.scheme not in ('http', 'https') or not p.hostname or p.username or p.password:
        raise ValueError('Use an HTTP(S) URL without credentials')
    if p.port not in (None, 80, 443):
        raise ValueError('Only standard HTTP(S) ports are supported')
    host = p.hostname.lower().rstrip('.')
    if host == 'localhost' or host.endswith(('.localhost', '.local', '.internal')):
        raise ValueError('Local network addresses are not supported')
    try:
        address = ipaddress.ip_address(host)
    except ValueError:
        return url
    if not address.is_global:
        raise ValueError('Non-public addresses are not supported')
    return url


async def require_public_host(url: str) -> None:
    validate_url(url)
    p = urlsplit(url)
    records = await asyncio.get_running_loop().getaddrinfo(
        p.hostname, p.port or (443 if p.scheme == 'https' else 80), type=socket.SOCK_STREAM)
    if not records or any(not ipaddress.ip_address(r[4][0]).is_global for r in records):
        raise ValueError('Host must resolve only to public addresses')
