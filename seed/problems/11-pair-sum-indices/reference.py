def pair_sum_indices(xs: list[int], target: int) -> list[int]:
    lo, hi = 0, len(xs) - 1
    while lo < hi:
        total = xs[lo] + xs[hi]
        if total == target:
            return [lo, hi]
        if total < target:
            lo += 1
        else:
            hi -= 1
    return []
