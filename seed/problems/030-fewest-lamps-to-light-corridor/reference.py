def fewest_lamps(reach: list[int]) -> int:
    n = len(reach) - 1
    # best[p] = furthest right end of any lamp whose left end is <= p
    furthest = [-1] * (n + 1)
    for i, r in enumerate(reach):
        left = max(0, i - r)
        right = min(n, i + r)
        if right > furthest[left]:
            furthest[left] = right
    lamps = 0
    covered = -1  # positions 0..covered are lit
    reachable = -1
    for p in range(n + 1):
        if furthest[p] > reachable:
            reachable = furthest[p]
        if p > covered:
            # position p is dark: need a lamp whose left end <= p
            if reachable < p:
                return -1
            lamps += 1
            covered = reachable
        if covered >= n:
            break
    return lamps
