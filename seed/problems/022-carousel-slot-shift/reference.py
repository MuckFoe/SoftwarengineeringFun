def rotate_carousel(slots: list[int], steps: int) -> list[int]:
    n = len(slots)
    if n == 0:
        return []
    k = steps % n
    return slots[n - k:] + slots[:n - k]
