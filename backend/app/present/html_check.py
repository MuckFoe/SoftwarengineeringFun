"""Validate presentation bytes and apply the slide rule (spec 013 FR-2, FR-3, NFR-4).

Slide marks: elements with a ``data-slide`` attribute not inside another ``data-slide``
element; if there are none, the ``<section>`` elements that are direct children of
``<body>``. One or more marks -> ``slides``; none -> ``page``. bridge.js applies the same
rule in the browser, and tests/fixtures/presentations proves the two agree.
"""

from dataclasses import dataclass
from html.parser import HTMLParser
from typing import Literal

MAX_BYTES = 5 * 1024 * 1024

RejectCode = Literal["too_large", "not_html", "empty"]

_BOM = b"\xef\xbb\xbf"

# Elements that never have an end tag, so never go on the open-element stack.
_VOID = frozenset(
    {
        "area",
        "base",
        "br",
        "col",
        "embed",
        "hr",
        "img",
        "input",
        "link",
        "meta",
        "param",
        "source",
        "track",
        "wbr",
    }
)
# Ancestors that don't stop a <section> from being a child of <body> (body may be implicit).
_ROOT = frozenset({"html", "body"})


class Rejected(Exception):
    def __init__(self, code: RejectCode) -> None:
        super().__init__(code)
        self.code: RejectCode = code


@dataclass(frozen=True)
class Analysis:
    kind: Literal["slides", "page"]
    slide_count: int
    html: str


class _SlideCounter(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.saw_element = False
        self.data_slides = 0
        self.body_sections = 0
        # Open elements: (tag, carries data-slide).
        self._stack: list[tuple[str, bool]] = []

    def _start(self, tag: str, attrs: list[tuple[str, str | None]], *, closes: bool) -> None:
        self.saw_element = True
        is_slide = any(name == "data-slide" for name, _ in attrs)
        if is_slide and not any(slide for _, slide in self._stack):
            self.data_slides += 1
        if tag == "section" and all(t in _ROOT for t, _ in self._stack):
            self.body_sections += 1
        if not closes and tag not in _VOID:
            self._stack.append((tag, is_slide))

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        self._start(tag, attrs, closes=False)

    def handle_startendtag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        self._start(tag, attrs, closes=True)

    def handle_endtag(self, tag: str) -> None:
        # Close up to the matching open element; ignore stray end tags.
        for i in range(len(self._stack) - 1, -1, -1):
            if self._stack[i][0] == tag:
                del self._stack[i:]
                return


def analyze(data: bytes) -> Analysis:
    """Return the slide analysis of ``data``, or raise ``Rejected``."""
    if len(data) > MAX_BYTES:
        raise Rejected("too_large")
    if data.startswith(_BOM):
        data = data[len(_BOM) :]
    if not data.strip():
        raise Rejected("empty")
    if b"\x00" in data:
        raise Rejected("not_html")
    try:
        html = data.decode("utf-8")
    except UnicodeDecodeError:
        raise Rejected("not_html") from None

    counter = _SlideCounter()
    counter.feed(html)
    counter.close()
    if not counter.saw_element:
        raise Rejected("not_html")

    count = counter.data_slides or counter.body_sections
    return Analysis(kind="slides" if count else "page", slide_count=count, html=html)
