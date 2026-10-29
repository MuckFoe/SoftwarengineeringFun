"""Description images: limits and format detection (spec 002 plan, Descriptions — Images).

Pure. The format comes from the file's magic bytes only; the declared Content-Type and
file name are never trusted. SVG is never accepted, so an image can't carry script.
"""

MAX_IMAGE_BYTES = 2 * 1024 * 1024
MAX_IMAGES_PER_DESCRIPTION = 10


def sniff_media_type(data: bytes) -> str | None:
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if data.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    if data.startswith((b"GIF87a", b"GIF89a")):
        return "image/gif"
    if len(data) >= 12 and data.startswith(b"RIFF") and data[8:12] == b"WEBP":
        return "image/webp"
    return None
