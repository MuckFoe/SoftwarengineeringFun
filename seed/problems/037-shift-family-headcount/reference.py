def shift_family_count(words: list[str]) -> int:
    seen = set()
    for w in words:
        base = ord(w[0])
        seen.add(tuple((ord(c) - base) % 26 for c in w))
    return len(seen)
