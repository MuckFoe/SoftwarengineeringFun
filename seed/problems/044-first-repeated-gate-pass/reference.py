def first_repeat(passes: list[int]) -> int:
    seen = set()
    for p in passes:
        if p in seen:
            return p
        seen.add(p)
    return -1
