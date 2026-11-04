"""Spec 013: the frame document a presentation is shown in, and its headers.

Plan "Isolation" 1 and 4, "Slides vs. single page": the presentation's HTML gets one
<style> (hides every slide mark but the current one) and one <script> (bridge.js,
told the kind and the initial slide) inserted right after a leading doctype, or at
the very start, so bridge.js runs before any script of the presentation.
"""

import json
import re
from html.parser import HTMLParser
from pathlib import Path

BRIDGE_JS = (Path(__file__).parent / "bridge.js").read_text(encoding="utf-8")

FRAME_HEADERS: dict[str, str] = {
    "Content-Security-Policy": (
        "sandbox allow-scripts; default-src 'none'; "
        "script-src 'unsafe-inline' 'unsafe-eval'; style-src 'unsafe-inline'; "
        "img-src data: blob:; media-src data: blob:; font-src data:; "
        "connect-src 'none'; frame-src 'none'; child-src 'none'; worker-src 'none'; "
        "form-action 'none'; base-uri 'none'"
    ),
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "Cache-Control": "no-store",
}

_DATA_SLIDE_CSS = "[data-slide]:not([data-sdd-current]){display:none!important}"
_SECTION_CSS = "body>section:not([data-sdd-current]){display:none!important}"

_LEADING_DOCTYPE = re.compile(r"\A(﻿?\s*<!doctype\b[^>]*>)", re.IGNORECASE)


class _Found(Exception):
    pass


class _DataSlideFinder(HTMLParser):
    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if any(name == "data-slide" for name, _ in attrs):
            raise _Found

    handle_startendtag = handle_starttag


def _has_data_slide(html: str) -> bool:
    """The slide rule's first form: any element carrying a data-slide attribute."""
    finder = _DataSlideFinder()
    try:
        finder.feed(html)
        finder.close()
    except _Found:
        return True
    return False


def _script_json(value: object) -> str:
    """JSON that cannot close or confuse the surrounding <script> element."""
    return json.dumps(value).replace("<", "\\u003c").replace(">", "\\u003e").replace("&", "\\u0026")


def build_frame(html: str, kind: str, slide: int | None) -> str:
    if kind == "slides":
        css = _DATA_SLIDE_CSS if _has_data_slide(html) else _SECTION_CSS
    else:
        css = ""
    config = _script_json({"kind": kind, "slide": slide})
    injection = f"<style>{css}</style><script>window.__SDD = {config};\n{BRIDGE_JS}</script>"
    match = _LEADING_DOCTYPE.match(html)
    if match:
        end = match.end()
        return html[:end] + injection + html[end:]
    return injection + html
