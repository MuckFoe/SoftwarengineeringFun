def digit_mirror_gap(n: int) -> int:
    m = 0
    t = n
    while t:
        m = m * 10 + t % 10
        t //= 10
    return abs(n - m)
