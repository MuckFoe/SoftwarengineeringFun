def doubled_midpoint(a: list[int], b: list[int]) -> int:
    if len(a) > len(b):
        a, b = b, a
    n, m = len(a), len(b)
    half = (n + m + 1) // 2
    inf = float("inf")
    lo, hi = 0, n
    while lo <= hi:
        i = (lo + hi) // 2
        j = half - i
        a_left = a[i - 1] if i > 0 else -inf
        a_right = a[i] if i < n else inf
        b_left = b[j - 1] if j > 0 else -inf
        b_right = b[j] if j < m else inf
        if a_left > b_right:
            hi = i - 1
        elif b_left > a_right:
            lo = i + 1
        else:
            left = max(a_left, b_left)
            if (n + m) % 2:
                return int(2 * left)
            return int(left + min(a_right, b_right))
    return 0
