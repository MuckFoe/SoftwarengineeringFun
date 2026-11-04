"""Spec 013 task 4: frame document and its headers (FR-10, FR-17, NFR-2, AC-16)."""

import json
import re

from app.present.frame import FRAME_HEADERS, build_frame

PREFIX = "window.__SDD = "


def _sdd(doc: str) -> dict:
    """The JSON object assigned to window.__SDD in the injected script."""
    start = doc.index(PREFIX) + len(PREFIX)
    obj, _ = json.JSONDecoder().raw_decode(doc[start:])
    return obj


def _csp() -> list[str]:
    return [d.strip() for d in FRAME_HEADERS["Content-Security-Policy"].split(";")]


def test_csp_sandboxes_and_blocks_network() -> None:
    directives = _csp()
    for expected in (
        "sandbox allow-scripts",
        "default-src 'none'",
        "connect-src 'none'",
        "frame-src 'none'",
        "form-action 'none'",
    ):
        assert expected in directives


def test_headers_exactly_as_plan() -> None:
    assert FRAME_HEADERS == {
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


def test_doctype_stays_first_and_bridge_runs_before_presentation_scripts() -> None:
    html = "<!DOCTYPE html><html><head><script>var mine = 1;</script></head><body></body></html>"
    doc = build_frame(html, "page", None)
    assert doc.startswith("<!DOCTYPE html>")
    injected = doc.index(PREFIX)
    assert injected < doc.index("var mine = 1;")
    # The injection sits right after the doctype, before <html>.
    assert injected < doc.index("<html>")
    assert doc.endswith(html[len("<!DOCTYPE html>") :])


def test_lowercase_doctype_is_recognised() -> None:
    doc = build_frame("<!doctype html>\n<p>hi</p>", "page", None)
    assert doc.startswith("<!doctype html>")
    assert doc.index(PREFIX) < doc.index("<p>hi</p>")


def test_without_doctype_injection_is_first() -> None:
    html = "<p>hello</p><script>var mine = 1;</script>"
    doc = build_frame(html, "page", None)
    assert doc.startswith("<style") or doc.startswith("<script")
    assert doc.endswith(html)
    assert doc.index(PREFIX) < doc.index("var mine = 1;")


def test_exactly_one_style_and_one_script_injected() -> None:
    html = "<body><div data-slide>a</div><div data-slide>b</div></body>"
    doc = build_frame(html, "slides", 0)
    injected = doc[: len(doc) - len(html)]
    assert doc.endswith(html)
    assert injected.count("<style") == 1
    assert injected.count("<script") == 1


def test_kind_and_initial_slide_in_window_sdd() -> None:
    doc = build_frame("<body><section>a</section><section>b</section></body>", "slides", 1)
    assert _sdd(doc) == {"kind": "slides", "slide": 1}
    doc = build_frame("<p>page</p>", "page", None)
    assert _sdd(doc) == {"kind": "page", "slide": None}


def test_script_end_tag_in_value_cannot_break_out() -> None:
    doc = build_frame("<p>x</p>", "</script><script>alert(1)</script>", None)
    injected = doc[: doc.index("<p>x</p>")]
    # Only the injected script's own closing tag appears.
    assert injected.lower().count("</script") == 1
    assert "\\u003c" in injected
    assert _sdd(doc)["kind"] == "</script><script>alert(1)</script>"


def test_data_slide_form_hides_non_current_marks() -> None:
    doc = build_frame("<body><div data-slide>a</div></body>", "slides", 0)
    style = re.search(r"<style>(.*?)</style>", doc, re.S)
    assert style is not None
    assert "[data-slide]:not([data-sdd-current]){display:none!important}" in style.group(1)
    assert "body>section" not in style.group(1)


def test_section_form_hides_non_current_sections() -> None:
    doc = build_frame("<body><section>a</section><section>b</section></body>", "slides", 0)
    style = re.search(r"<style>(.*?)</style>", doc, re.S)
    assert style is not None
    assert "body>section:not([data-sdd-current]){display:none!important}" in style.group(1)
    assert "[data-slide]" not in style.group(1)


def test_page_gets_no_slide_css() -> None:
    doc = build_frame("<body><p>long page</p></body>", "page", None)
    style = re.search(r"<style>(.*?)</style>", doc, re.S)
    assert style is not None
    assert style.group(1) == ""


def test_bridge_contents_are_in_the_injected_script() -> None:
    from app.present import frame

    doc = build_frame("<p>x</p>", "page", None)
    assert frame.BRIDGE_JS in doc
