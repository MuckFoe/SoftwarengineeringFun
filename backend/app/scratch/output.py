"""Spec 011: bounded output of a scratch run, and incremental UTF-8 decoding."""

import codecs

OUTPUT_LIMIT_B = 64 * 1024


class OutputBuffer:
    """Output of both streams, capped at OUTPUT_LIMIT_B UTF-8 bytes in total."""

    def __init__(self) -> None:
        self._segments: list[tuple[str, str]] = []
        self.size = 0
        self.truncated = False

    @property
    def segments(self) -> list[tuple[str, str]]:
        return list(self._segments)

    def append(self, stream: str, text: str) -> str:
        """Add text; return the part accepted (cut at a character boundary)."""
        if self.truncated or not text:
            return ""
        room = OUTPUT_LIMIT_B - self.size
        raw = text.encode("utf-8")
        if len(raw) > room:
            text = raw[:room].decode("utf-8", errors="ignore")
            self.truncated = True
        if text:
            self.size += len(text.encode("utf-8"))
            if self._segments and self._segments[-1][0] == stream:
                self._segments[-1] = (stream, self._segments[-1][1] + text)
            else:
                self._segments.append((stream, text))
        return text


class StreamDecoder:
    """One incremental UTF-8 decoder per stream; invalid bytes become U+FFFD."""

    def __init__(self) -> None:
        self._decoders: dict[str, codecs.IncrementalDecoder] = {}

    def feed(self, stream: str, data: bytes, final: bool = False) -> str:
        dec = self._decoders.get(stream)
        if dec is None:
            dec = codecs.getincrementaldecoder("utf-8")(errors="replace")
            self._decoders[stream] = dec
        return dec.decode(data, final)
