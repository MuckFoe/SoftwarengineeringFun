"""Spec 002 task 3: image format sniffing and limits (FR4)."""

import base64

import pytest

from app.problems.images import MAX_IMAGE_BYTES, MAX_IMAGES_PER_DESCRIPTION, sniff_media_type

# Real minimal 1x1 files.
PNG = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGBgAAAABQABXvMqGgAAAABJRU5ErkJggg=="
)
JPEG = base64.b64decode(
    "/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////"
    "////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/a"
    "AAgBAQABPxA="
)
GIF87 = b"GIF87a\x01\x00\x01\x00\x00\x00\x00;"
GIF89 = base64.b64decode("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7")
WEBP = base64.b64decode("UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA==")
PDF = b"%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n"
SVG = b'<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>'


def test_limits_are_2_mib_and_10_images() -> None:
    assert MAX_IMAGE_BYTES == 2 * 1024 * 1024
    assert MAX_IMAGES_PER_DESCRIPTION == 10


@pytest.mark.parametrize(
    ("data", "media_type"),
    [
        (PNG, "image/png"),
        (JPEG, "image/jpeg"),
        (GIF87, "image/gif"),
        (GIF89, "image/gif"),
        (WEBP, "image/webp"),
    ],
)
def test_fr4_real_images_map_to_their_media_type(data: bytes, media_type: str) -> None:
    assert sniff_media_type(data) == media_type


@pytest.mark.parametrize(
    "data",
    [
        PDF,
        SVG,
        b"",
        PNG[:4],
        b"RIFF\x00\x00\x00\x00WAVEfmt ",  # a RIFF container that isn't WebP
        b"GIF88a\x01\x00",
        b"\xff\xd8",  # JPEG start-of-image without the next marker
    ],
)
def test_fr4_other_formats_and_truncated_headers_are_refused(data: bytes) -> None:
    assert sniff_media_type(data) is None
