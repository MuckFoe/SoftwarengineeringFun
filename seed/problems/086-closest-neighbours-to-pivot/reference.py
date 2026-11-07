def closest_to_pivot(xs: list[int], k: int, pivot: int) -> list[int]:
    k = min(k, len(xs))
    lo, hi = 0, len(xs) - k
    while lo < hi:
        mid = (lo + hi) // 2
        if pivot - xs[mid] > xs[mid + k] - pivot:
            lo = mid + 1
        else:
            hi = mid
    return xs[lo:lo + k]
