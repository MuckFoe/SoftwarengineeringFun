def fewest_fence_cuts(paint: str) -> int:
    n = len(paint)
    if n == 0:
        return 0
    cuts = list(range(-1, n))  # cuts[i] = best for the first i letters
    for centre in range(n):
        for lo, hi in ((centre, centre), (centre, centre + 1)):
            while lo >= 0 and hi < n and paint[lo] == paint[hi]:
                if cuts[lo] + 1 < cuts[hi + 1]:
                    cuts[hi + 1] = cuts[lo] + 1
                lo -= 1
                hi += 1
    return cuts[n]
