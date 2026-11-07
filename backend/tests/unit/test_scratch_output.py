"""Spec 011 task 1: OutputBuffer and incremental decoding."""

from app.scratch.output import OUTPUT_LIMIT_B, OutputBuffer, StreamDecoder


def test_nfr3_100kb_in_pieces_is_capped_at_64kb() -> None:
    buf = OutputBuffer()
    for _ in range(100):
        buf.append("out", "x" * 1024)
    assert OUTPUT_LIMIT_B == 65536
    assert buf.size == 65536
    assert buf.truncated
    assert buf.append("out", "more") == ""
    assert buf.append("err", "more") == ""
    assert buf.size == 65536


def test_nfr3_cap_inside_multibyte_char_cuts_before_it() -> None:
    buf = OutputBuffer()
    buf.append("out", "a" * (OUTPUT_LIMIT_B - 1))
    accepted = buf.append("out", "€")  # 3 bytes, only 1 byte left
    assert accepted == ""
    assert buf.truncated
    assert buf.size == OUTPUT_LIMIT_B - 1
    text = "".join(t for _, t in buf.segments)
    text.encode("utf-8")


def test_nfr3_partial_accept_of_piece() -> None:
    buf = OutputBuffer()
    buf.append("out", "a" * (OUTPUT_LIMIT_B - 4))
    accepted = buf.append("out", "€€")
    assert accepted == "€"
    assert buf.size == OUTPUT_LIMIT_B - 1
    assert buf.truncated


def test_fr3_streams_kept_apart_and_same_stream_merged() -> None:
    buf = OutputBuffer()
    buf.append("out", "1")
    buf.append("err", "2")
    buf.append("err", "3")
    buf.append("out", "4")
    assert buf.segments == [("out", "1"), ("err", "23"), ("out", "4")]
    assert not buf.truncated


def test_decoding_chunk_boundary_never_splits_a_character() -> None:
    dec = StreamDecoder()
    out = "".join(dec.feed("out", bytes([b])) for b in "é".encode())
    assert out == "é"


def test_decoding_streams_are_independent() -> None:
    dec = StreamDecoder()
    raw = "é".encode()
    assert dec.feed("out", raw[:1]) == ""
    assert dec.feed("err", b"x") == "x"
    assert dec.feed("out", raw[1:]) == "é"
