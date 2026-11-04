"""Spec 013 task 2: html_check — size, HTML test, slide rule (FR-2, FR-3, NFR-4; AC-2, AC-3)."""

import dataclasses
from pathlib import Path

import pytest

from app.present.html_check import MAX_BYTES, Analysis, Rejected, analyze

FIXTURES = Path(__file__).resolve().parent.parent / "fixtures" / "presentations"


def _fixture(name: str) -> bytes:
    return (FIXTURES / name).read_bytes()


def _rejected_code(data: bytes) -> str:
    with pytest.raises(Rejected) as excinfo:
        analyze(data)
    return excinfo.value.code


# --- AC-2: the slide rule ---------------------------------------------------------------


@pytest.mark.parametrize(
    ("fixture", "kind", "count"),
    [
        ("four-data-slides.html", "slides", 4),  # non-nested data-slide; wins over sections
        ("four-sections.html", "slides", 4),  # body > section only, nested ones ignored
        ("nested-data-slide.html", "slides", 1),  # data-slide inside data-slide counts once
        ("single-page.html", "page", 0),  # no marks
        ("doctype-and-bom.html", "slides", 2),  # BOM accepted, body > section
    ],
)
def test_slide_rule_fixtures(fixture: str, kind: str, count: int) -> None:
    result = analyze(_fixture(fixture))
    assert isinstance(result, Analysis)
    assert (result.kind, result.slide_count) == (kind, count)


def test_data_slide_wins_over_sections() -> None:
    html = (
        b"<html><body><section>a</section><section>b</section>"
        b"<section><div data-slide>only mark</div></section></body></html>"
    )
    assert analyze(html) == Analysis(kind="slides", slide_count=1, html=html.decode())


def test_sibling_data_slides_after_nested_one_still_count() -> None:
    html = b"<body><div data-slide><p data-slide>x</p></div><div data-slide>y</div><br></body>"
    assert analyze(html).slide_count == 2


def test_sections_without_explicit_body_tag_are_body_children() -> None:
    assert analyze(b"<section>1</section><section>2</section>").slide_count == 2


def test_void_and_self_closing_tags_do_not_break_nesting() -> None:
    html = b'<body><img src="x.png"><br/><input><section>1</section><section>2</section></body>'
    assert analyze(html).slide_count == 2


def test_markup_inside_script_is_not_counted() -> None:
    html = b'<body><p>page</p><script>document.write("<div data-slide>x</div>")</script></body>'
    assert analyze(html) == Analysis(kind="page", slide_count=0, html=html.decode())


def test_analysis_carries_decoded_html_without_bom() -> None:
    raw = _fixture("doctype-and-bom.html")
    result = analyze(raw)
    assert result.html == raw[3:].decode("utf-8")
    assert result.html.startswith("<!DOCTYPE html>")


def test_analysis_is_frozen() -> None:
    result = analyze(b"<p>x</p>")
    with pytest.raises(dataclasses.FrozenInstanceError):
        result.kind = "slides"  # type: ignore[misc]


# --- AC-3: size and "is this HTML" -----------------------------------------------------


def test_max_bytes_is_five_megabytes() -> None:
    assert MAX_BYTES == 5 * 1024 * 1024


def _padded(size: int) -> bytes:
    head = b"<!doctype html><html><body><p>"
    tail = b"</p></body></html>"
    return head + b"a" * (size - len(head) - len(tail)) + tail


def test_exactly_five_megabytes_is_accepted() -> None:
    data = _padded(MAX_BYTES)
    assert len(data) == MAX_BYTES
    assert analyze(data).kind == "page"


def test_five_megabytes_plus_one_byte_is_too_large() -> None:
    data = _padded(MAX_BYTES + 1)
    assert _rejected_code(data) == "too_large"


def test_six_megabytes_is_too_large() -> None:
    assert _rejected_code(_padded(6 * 1024 * 1024)) == "too_large"


def test_png_bytes_are_not_html() -> None:
    png = b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x06\x00\x00\x00"
    assert _rejected_code(png) == "not_html"


def test_nul_byte_is_not_html() -> None:
    assert _rejected_code(b"<html><body>\x00</body></html>") == "not_html"


def test_invalid_utf8_is_not_html() -> None:
    assert _rejected_code(b"<html><body>\xff\xfe</body></html>") == "not_html"


@pytest.mark.parametrize(
    "data",
    [
        b"just some plain text, no markup at all",
        b"1 < 2 and 3 > 2",
        b"<!doctype html>",
        b"<!-- only a comment -->",
    ],
)
def test_text_with_no_element_start_tag_is_not_html(data: bytes) -> None:
    assert _rejected_code(data) == "not_html"


@pytest.mark.parametrize("data", [b"", b"\xef\xbb\xbf"])
def test_empty_is_empty(data: bytes) -> None:
    assert _rejected_code(data) == "empty"


def test_utf8_bom_is_accepted() -> None:
    assert analyze(b"\xef\xbb\xbf<p>hello</p>") == Analysis(
        kind="page", slide_count=0, html="<p>hello</p>"
    )


def test_rejected_is_an_exception_with_code() -> None:
    err = Rejected("not_html")
    assert isinstance(err, Exception)
    assert err.code == "not_html"
