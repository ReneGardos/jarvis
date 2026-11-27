"""Internetadgang: søgning (SearXNG lokalt + Brave valgfrit) og sikker hentning af sider."""
from __future__ import annotations

import asyncio
import ipaddress
import re
import socket
from html.parser import HTMLParser
from urllib.parse import urlparse

from app.core.config import get_settings

_s = get_settings()
MAX_BYTES = 3_000_000
UA = "Mozilla/5.0 (compatible; JarvisAssistant/1.0)"


class _TextExtractor(HTMLParser):
    SKIP = {"script", "style", "noscript", "svg", "nav", "footer", "header", "form", "iframe"}
    BLOCK = {"p", "div", "br", "li", "h1", "h2", "h3", "h4", "h5", "tr", "section", "article"}

    def __init__(self):
        super().__init__()
        self.parts: list[str] = []
        self.skip = 0
        self.title = ""
        self._in_title = False
        self.links: list[str] = []

    def handle_starttag(self, tag, attrs):
        if tag in self.SKIP:
            self.skip += 1
        if tag == "title":
            self._in_title = True
        if tag in self.BLOCK:
            self.parts.append("\n")
        if tag == "a":
            href = dict(attrs).get("href")
            if href and href.startswith("http"):
                self.links.append(href)

    def handle_endtag(self, tag):
        if tag in self.SKIP and self.skip:
            self.skip -= 1
        if tag == "title":
            self._in_title = False

    def handle_data(self, data):
        if self._in_title:
            self.title += data
        elif not self.skip:
            self.parts.append(data)


def html_to_text(html: str) -> tuple[str, str]:
    p = _TextExtractor()
    p.feed(html)
    text = re.sub(r"[ \t]+", " ", "".join(p.parts))
    text = re.sub(r"\n\s*\n+", "\n\n", text).strip()
    return p.title.strip(), text


async def assert_public_url(url: str) -> None:
    """Beskytter mod SSRF: AI'en må ikke hente interne adresser (router, database, cloud-metadata)."""
    u = urlparse(url)
    if u.scheme not in ("http", "https") or not u.hostname:
        raise PermissionError("Kun http(s)-adresser er tilladt")
    infos = await asyncio.get_running_loop().getaddrinfo(u.hostname, None, type=socket.SOCK_STREAM)
    for info in infos:
        ip = ipaddress.ip_address(info[4][0])
        if ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved or ip.is_multicast:
            raise PermissionError(f"{u.hostname} peger på en intern adresse")


async def search(query: str, limit: int = 8, lang: str = "da") -> list[dict]:
    import httpx
    results: list[dict] = []
    async with httpx.AsyncClient(timeout=20, headers={"User-Agent": UA}) as c:
        try:
            r = await c.get(f"{_s.searxng_url}/search", params={"q": query, "format": "json", "language": lang})
            r.raise_for_status()
            for x in r.json().get("results", [])[:limit]:
                results.append({"title": x.get("title", ""), "url": x.get("url", ""),
                                "snippet": x.get("content", ""), "engine": x.get("engine", "searxng")})
        except Exception:
            pass
        if len(results) < 3 and _s.brave_api_key:
            r = await c.get("https://api.search.brave.com/res/v1/web/search", params={"q": query, "count": limit},
                            headers={"X-Subscription-Token": _s.brave_api_key, "Accept": "application/json"})
            if r.status_code == 200:
                for x in r.json().get("web", {}).get("results", [])[:limit]:
                    results.append({"title": x.get("title", ""), "url": x.get("url", ""),
                                    "snippet": re.sub("<[^>]+>", "", x.get("description", "")), "engine": "brave"})
    if not results:
        raise RuntimeError("Ingen søgeresultater – kører SearXNG? (docker compose ps)")
    seen, uniq = set(), []
    for x in results:
        if x["url"] not in seen:
            seen.add(x["url"])
            uniq.append(x)
    return uniq[:limit]


async def fetch(url: str, max_chars: int = 15000) -> dict:
    import httpx
    await assert_public_url(url)
    async with httpx.AsyncClient(timeout=25, follow_redirects=False, headers={"User-Agent": UA}) as c:
        for _ in range(5):  # følg redirects manuelt så hver destination SSRF-tjekkes
            r = await c.get(url)
            if r.is_redirect and "location" in r.headers:
                url = str(r.url.join(r.headers["location"]))
                await assert_public_url(url)
                continue
            break
        r.raise_for_status()
        ctype = r.headers.get("content-type", "")
        content = r.content[:MAX_BYTES]
    if "pdf" in ctype or url.lower().endswith(".pdf"):
        from app.documents.parsers import parse_bytes
        text = parse_bytes(content, "application/pdf", "download.pdf")
        return {"url": url, "title": url.rsplit("/", 1)[-1], "text": text[:max_chars], "type": "pdf"}
    if "html" in ctype or not ctype:
        title, text = html_to_text(content.decode(r.encoding or "utf-8", errors="replace"))
    else:
        title, text = "", content.decode(errors="replace")
    return {"url": url, "title": title, "text": text[:max_chars], "type": "html"}
