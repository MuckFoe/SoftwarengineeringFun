def min_mirror_pieces(s: str) -> int:
    n = len(s)
    best = [0] + [n + 1] * n
    # best[j] = fewest pieces for the first j characters
    for c in range(n):
        for lo, hi in ((c, c), (c, c + 1)):
            while lo >= 0 and hi < n and s[lo] == s[hi]:
                if best[lo] + 1 < best[hi + 1]:
                    best[hi + 1] = best[lo] + 1
                lo -= 1
                hi += 1
        # centres are processed left to right, so best[c] is final before use
    return best[n]
