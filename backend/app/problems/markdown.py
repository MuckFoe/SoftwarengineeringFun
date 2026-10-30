"""Problem descriptions: Markdown source to safe HTML (spec 002 plan, Descriptions — Rendering).

Pure. CommonMark with raw HTML off, so anything tag-like in the source is escaped text.
Link targets are limited to http, https and mailto; image sources to `/api/images/<uuid>`,
which is the stored form and is emitted under the app's base path (spec 005).
A caller may pass `image_src` to map image sources its own way (spec 006 lessons); a `None`
from it refuses the image. A refused link keeps its text and a refused image shows its alt
text. This one renderer produces the participant view and the preview, and is the XSS
boundary: nothing is sanitised on the client.
"""

import re
import uuid
from collections.abc import Callable, Iterator
from urllib.parse import urlsplit

from markdown_it import MarkdownIt
from markdown_it.rules_core import StateCore
from markdown_it.token import Token

LINK_SCHEMES = frozenset({"http", "https", "mailto"})
LINK_REL = "noopener noreferrer nofollow"
_IMAGE_SRC = re.compile(
    r"/api/images/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})", re.I
)


def _parser() -> MarkdownIt:
    md = MarkdownIt("commonmark", {"html": False})
    # Accept every URL at parse time, so a refused link still parses as a link and can be
    # reduced to its text below, rather than left as literal `[x](javascript:…)` source.
    md.validateLink = lambda url: True  # type: ignore[method-assign]
    return md


def _attr(token: Token, name: str) -> str:
    return str(token.attrGet(name) or "")


def _image_id(src: str) -> uuid.UUID | None:
    match = _IMAGE_SRC.fullmatch(src)
    return uuid.UUID(match.group(1)) if match else None


def _problem_image_src(src: str) -> str | None:
    return src if _image_id(src) is not None else None


def _link_allowed(href: str) -> bool:
    try:
        return urlsplit(href).scheme.lower() in LINK_SCHEMES
    except ValueError:
        return False


def _restrict(state: StateCore) -> None:
    for block in state.tokens:
        if block.type == "inline" and block.children:
            block.children = _restrict_inline(state, block.children)


def _restrict_inline(state: StateCore, children: list[Token]) -> list[Token]:
    out: list[Token] = []
    dropping_link = False
    for token in children:
        if token.type == "link_open":
            if _link_allowed(_attr(token, "href")):
                token.attrSet("rel", LINK_REL)
                out.append(token)
            else:
                dropping_link = True  # links never nest, so the next close is this one's
        elif token.type == "link_close" and dropping_link:
            dropping_link = False
        elif token.type == "image":
            src = state.env["image_src"](_attr(token, "src"))
            if src is None:
                alt = Token("text", "", 0)
                alt.content = state.md.renderer.renderInlineAsText(
                    token.children or [], state.md.options, state.env
                )
                out.append(alt)
            else:
                token.attrSet("src", state.env.get("base_path", "") + src)
                out.append(token)
        else:
            out.append(token)
    return out


_analyse = _parser()
_render = _parser()
_render.core.ruler.push("restrict_urls", _restrict)


def render_description(
    source: str,
    base_path: str = "",
    *,
    image_src: Callable[[str], str | None] = _problem_image_src,
) -> str:
    return _render.render(source, {"base_path": base_path, "image_src": image_src})


def _image_sources(source: str) -> Iterator[str]:
    def walk(tokens: list[Token]) -> Iterator[str]:
        for token in tokens:
            if token.type == "image":
                yield _attr(token, "src")
            if token.children:
                yield from walk(token.children)

    return walk(_analyse.parse(source))


def image_ids(source: str) -> list[uuid.UUID]:
    """Distinct `/api/images/<uuid>` references, in order of appearance."""
    ids = (_image_id(src) for src in _image_sources(source))
    return list(dict.fromkeys(i for i in ids if i is not None))


def disallowed_image_sources(source: str) -> list[str]:
    """Distinct image sources other than `/api/images/<uuid>`, in order of appearance."""
    return list(dict.fromkeys(s for s in _image_sources(source) if _image_id(s) is None))
