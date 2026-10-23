def kth_smallest(xs: list[int], k: int) -> int:
    return sorted(xs)[k - 1]
