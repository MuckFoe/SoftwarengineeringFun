"""Spec 006 task 4: `render_description` with an `image_src` resolver (FR-2; AC-28, AC-29)."""

from app.problems.markdown import render_description

SHA = "a" * 64
UUID = "0b8f6a52-4c1e-4d0a-9a43-2f5d9b7e1c11"


def lesson_resolver(src: str) -> str | None:
    return {"layers.png": f"/api/learn/assets/{SHA}"}.get(src)


def test_a_lesson_asset_maps_to_its_served_url():
    html = render_description("![diagram](layers.png)", image_src=lesson_resolver)

    assert f'<img src="/api/learn/assets/{SHA}" alt="diagram" />' in html


def test_the_resolved_url_is_emitted_under_the_base_path():
    html = render_description("![d](layers.png)", base_path="/hub", image_src=lesson_resolver)

    assert f'src="/hub/api/learn/assets/{SHA}"' in html


def test_a_lesson_resolver_refuses_problem_images_and_external_urls():
    for src in (f"/api/images/{UUID}", "https://evil.example/x.png", "other.png"):
        html = render_description(f"![alt text]({src})", image_src=lesson_resolver)

        assert "<img" not in html, src
        assert "alt text" in html, src


def test_without_a_resolver_the_problem_image_rule_still_applies():
    assert f'src="/api/images/{UUID}"' in render_description(f"![x](/api/images/{UUID})")
    assert "<img" not in render_description("![x](layers.png)")


def test_ac28_raw_html_is_escaped_with_a_resolver():
    html = render_description("<b>hi</b>", image_src=lesson_resolver)

    assert "<b>" not in html
    assert "&lt;b&gt;hi&lt;/b&gt;" in html
