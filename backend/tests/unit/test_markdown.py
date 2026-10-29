"""Spec 002 task 2: Markdown renderer (FR2, FR3, NFR Security)."""

import re
import uuid
from html.parser import HTMLParser

import pytest

from app.problems.markdown import disallowed_image_sources, image_ids, render_description

ID_A = uuid.UUID("0b8e6f4a-1c2d-4e5f-8a9b-0c1d2e3f4a5b")
ID_B = uuid.UUID("9f8e7d6c-5b4a-4321-8fed-cba987654321")


class _Tags(HTMLParser):
    """Every start tag in a rendered fragment, with its attributes."""

    def __init__(self) -> None:
        super().__init__()
        self.tags: list[tuple[str, dict[str, str | None]]] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        self.tags.append((tag, dict(attrs)))


def _tags(html: str) -> list[tuple[str, dict[str, str | None]]]:
    parser = _Tags()
    parser.feed(html)
    return parser.tags


def _names(html: str) -> list[str]:
    return [t for t, _ in _tags(html)]


@pytest.mark.parametrize("level", range(1, 7))
def test_fr2_headings_render_as_h1_to_h6(level: int) -> None:
    html = render_description("#" * level + " Task")
    assert f"<h{level}>Task</h{level}>" in html


def test_fr2_numbered_list_renders_as_ol_li() -> None:
    html = render_description("1. first\n2. second\n")
    assert "<ol>" in html
    assert re.findall(r"<li>(.*?)</li>", html) == ["first", "second"]


def test_fr2_bulleted_list_renders_as_ul_li() -> None:
    html = render_description("- first\n- second\n")
    assert "<ul>" in html
    assert re.findall(r"<li>(.*?)</li>", html) == ["first", "second"]


def test_fr2_inline_code_emphasis_and_paragraphs() -> None:
    html = render_description("Call `f(x)` with *care* and **force**.\n\nSecond paragraph.")
    assert "<code>f(x)</code>" in html
    assert "<em>care</em>" in html
    assert "<strong>force</strong>" in html
    assert html.count("<p>") == 2


def test_fr2_fenced_code_block_keeps_whitespace_byte_exact() -> None:
    body = "def f(x):\n    if x:\n\n        return  1\n\treturn 0\n"
    html = render_description(f"```python\n{body}```\n")
    match = re.search(r"<pre><code[^>]*>(.*?)</code></pre>", html, re.DOTALL)
    assert match is not None
    assert match.group(1) == body


def test_fr2_code_block_content_is_escaped() -> None:
    html = render_description("```\nif a < b and c > d: print('&')\n```\n")
    assert "if a &lt; b and c &gt; d: print('&amp;')" in html


@pytest.mark.parametrize(
    "href", ["https://example.com/x", "http://example.com/", "mailto:someone@example.com"]
)
def test_fr2_links_to_allowed_schemes_render_with_rel(href: str) -> None:
    html = render_description(f"[see this]({href})")
    links = [attrs for tag, attrs in _tags(html) if tag == "a"]
    assert links == [{"href": href, "rel": "noopener noreferrer nofollow"}]
    assert ">see this</a>" in html


def test_fr3_image_between_paragraphs_2_and_3_renders_there() -> None:
    source = f"One.\n\nTwo.\n\n![a diagram](/api/images/{ID_A})\n\nThree.\n"
    html = render_description(source)
    names = [n for n in _names(html) if n in ("p", "img")]
    # The image sits in its own paragraph, after the 2nd text paragraph and before the 3rd.
    assert names == ["p", "p", "p", "img", "p"]
    assert html.index("Two.") < html.index("<img") < html.index("Three.")
    imgs = [attrs for tag, attrs in _tags(html) if tag == "img"]
    assert imgs == [{"src": f"/api/images/{ID_A}", "alt": "a diagram"}]


@pytest.mark.parametrize(
    "source",
    [
        "<script>alert(1)</script>",
        "<img src=x onerror=alert(1)>",
        "[x](javascript:alert(1))",
        "[x](JaVaScRiPt:alert(1))",
        "<javascript:alert(1)>",
        "[x](data:text/html,<script>alert(1)</script>)",
        "![x](data:image/png;base64,AAAA)",
        "![x](https://example.com/a.png)",
        "[x](vbscript:msgbox)",
        '<a href="javascript:alert(1)">x</a>',
        "[ref]\n\n[ref]: javascript:alert(1)",
    ],
)
def test_nfr_security_injection_vectors_are_neutralised(source: str) -> None:
    html = render_description(source)
    tags = _tags(html)
    names = [t for t, _ in tags]
    assert "script" not in names
    for _, attrs in tags:
        assert not any(name.startswith("on") for name in attrs), html
        for value in attrs.values():
            assert not re.match(r"\s*(javascript|data|vbscript):", value or "", re.I), html
    assert all(attrs.get("src", "").startswith("/api/images/") for t, attrs in tags if t == "img")


def test_nfr_security_raw_html_is_escaped_text() -> None:
    html = render_description("<script>alert(1)</script>")
    assert "&lt;script&gt;alert(1)&lt;/script&gt;" in html


def test_nfr_security_disallowed_link_keeps_its_text() -> None:
    html = render_description("Click [here](javascript:alert(1)) now.")
    assert "<a" not in html
    assert "<p>Click here now.</p>" in html


def test_nfr_security_external_image_shows_its_alt_text() -> None:
    html = render_description("Look: ![a cat](https://example.com/a.png)")
    assert "<img" not in html
    assert "<p>Look: a cat</p>" in html


def test_image_with_malformed_id_is_not_rendered() -> None:
    html = render_description("![x](/api/images/not-a-uuid)")
    assert "<img" not in html


def test_image_ids_are_distinct_in_order_of_appearance() -> None:
    source = (
        f"![b](/api/images/{ID_B}) text ![a](/api/images/{ID_A})\n\n"
        f"![b again](/api/images/{ID_B})\n\n"
        "![ext](https://example.com/a.png)\n\n"
        f"![ref][r]\n\n[r]: /api/images/{ID_A}\n"
    )
    assert image_ids(source) == [ID_B, ID_A]


def test_image_ids_of_text_without_images_is_empty() -> None:
    assert image_ids("# Task\n\n[link](https://example.com)") == []


def test_disallowed_image_sources_lists_every_other_source() -> None:
    source = (
        f"![ok](/api/images/{ID_A})\n\n"
        "![ext](https://example.com/a.png)\n\n"
        "![rel](/static/b.png)\n\n"
        "![bad](/api/images/not-a-uuid)\n"
    )
    assert disallowed_image_sources(source) == [
        "https://example.com/a.png",
        "/static/b.png",
        "/api/images/not-a-uuid",
    ]


def test_disallowed_image_sources_of_allowed_images_is_empty() -> None:
    assert disallowed_image_sources(f"![ok](/api/images/{ID_A})") == []


# Spec 005 task 2: image sources are served under the app's base path (FR1).


def test_fr1_allowed_image_src_is_prefixed_with_base_path() -> None:
    html = render_description(f"![a diagram](/api/images/{ID_A})", "/collab")
    imgs = [attrs for tag, attrs in _tags(html) if tag == "img"]
    assert imgs == [{"src": f"/collab/api/images/{ID_A}", "alt": "a diagram"}]


def test_fr1_reference_style_image_is_prefixed_too() -> None:
    html = render_description(f"![r][r]\n\n[r]: /api/images/{ID_A}\n", "/collab")
    assert f'src="/collab/api/images/{ID_A}"' in html


def test_fr1_default_base_path_leaves_output_unchanged() -> None:
    source = f"# T\n\nOne ![a](/api/images/{ID_A}) [l](https://example.com)\n"
    assert render_description(source) == render_description(source, "")
    prefixed = render_description(source, "/collab")
    assert prefixed.replace("/collab/api/images/", "/api/images/") == render_description(source)


@pytest.mark.parametrize(
    "src",
    [
        "https://example.com/a.png",
        "data:image/png;base64,AAAA",
        "/static/b.png",
        "/api/images/not-a-uuid",
        f"/collab/api/images/{ID_A}",
        f"/other/api/images/{ID_A}",
        f"//evil.example/api/images/{ID_A}",
        f"https://evil.example/api/images/{ID_A}",
    ],
)
def test_fr1_disallowed_image_sources_stay_refused_with_base_path(src: str) -> None:
    html = render_description(f"Look: ![alt]({src})", "/collab")
    assert "<img" not in html
    assert "<p>Look: alt</p>" in html
